// Client-side deterministic index construction for the /build config editor.
// Port of deterministic-index/index_builder.py, same math as the enclave copy
// in tee-extension/extension/build-index.ts: pure function of (matrix, config).
// previewIndex() prefers a server build (VITE_BUILD_URL) and falls back to
// running this port in the browser against public/data/feature-matrix.csv.

export interface IndexConfig {
  version: number;
  weights: Record<string, number>; // scoring feature -> SIGNED weight
  normalization: "zscore" | "rank" | "minmax";
  winsor: number;
  top_n: number;
  max_weight: number; // per-name cap, fraction
  sector_cap: number; // per-sector cap, fraction
  weighting: "equal" | "score_tilt";
  eligible_sectors: string[]; // empty = all
  min_market_cap_usd: number;
  competitive_position: string[]; // empty = all (client-side extension)
}

export interface ScoringFeature {
  name: string;
  label: string;
  group: string;
  kind: "numeric" | "score";
  lowerIsBetter: boolean; // conventional sign: true -> weight is negative
}

// The 16 scoring features (11 NUMERIC + 6 SCORE minus market_cap_usd, which is
// an eligibility filter) mirrored from deterministic-index/features.py.
export const SCORING_FEATURES: ScoringFeature[] = [
  {name: "pe_forward", label: "Forward P/E", group: "Value", kind: "numeric", lowerIsBetter: true},
  {name: "ev_ebitda", label: "EV / EBITDA", group: "Value", kind: "numeric", lowerIsBetter: true},
  {name: "fcf_yield", label: "FCF yield", group: "Value", kind: "numeric", lowerIsBetter: false},
  {name: "dividend_yield", label: "Dividend yield", group: "Yield", kind: "numeric", lowerIsBetter: false},
  {name: "revenue_growth_yoy", label: "Revenue growth YoY", group: "Growth", kind: "numeric", lowerIsBetter: false},
  {name: "gross_margin", label: "Gross margin", group: "Quality", kind: "numeric", lowerIsBetter: false},
  {name: "return_on_equity", label: "Return on equity", group: "Quality", kind: "numeric", lowerIsBetter: false},
  {name: "net_debt_to_ebitda", label: "Net debt / EBITDA", group: "Quality", kind: "numeric", lowerIsBetter: true},
  {name: "momentum_12m", label: "Momentum 12m", group: "Momentum", kind: "numeric", lowerIsBetter: false},
  {name: "volatility_90d", label: "Volatility 90d", group: "Momentum", kind: "numeric", lowerIsBetter: true},
  {name: "moat_strength", label: "Moat strength", group: "AI-scored", kind: "score", lowerIsBetter: false},
  {name: "management_quality", label: "Management quality", group: "AI-scored", kind: "score", lowerIsBetter: false},
  {name: "ai_exposure", label: "AI exposure", group: "AI-scored", kind: "score", lowerIsBetter: false},
  {name: "demand_durability", label: "Demand durability", group: "AI-scored", kind: "score", lowerIsBetter: false},
  {name: "regulatory_risk", label: "Regulatory risk", group: "AI-scored", kind: "score", lowerIsBetter: true},
  {name: "esg_controversy", label: "ESG controversy", group: "AI-scored", kind: "score", lowerIsBetter: true},
];

// The 11 GICS sectors (features.py `sector` label enum).
export const GICS_SECTORS = [
  "energy",
  "materials",
  "industrials",
  "consumer_discretionary",
  "consumer_staples",
  "health_care",
  "financials",
  "information_technology",
  "communication_services",
  "utilities",
  "real_estate",
] as const;

export const COMPETITIVE_POSITIONS = ["leader", "challenger", "follower", "niche"] as const;

// House config, mirrored from deterministic-index/config.yaml (version 3).
export const HOUSE_CONFIG: IndexConfig = {
  version: 3,
  weights: {
    pe_forward: -0.04,
    ev_ebitda: -0.04,
    fcf_yield: 0.08,
    dividend_yield: 0.02,
    revenue_growth_yoy: 0.1,
    gross_margin: 0.04,
    return_on_equity: 0.1,
    net_debt_to_ebitda: -0.08,
    momentum_12m: 0.1,
    volatility_90d: -0.06,
    moat_strength: 0.1,
    management_quality: 0.05,
    ai_exposure: 0.06,
    demand_durability: 0.05,
    regulatory_risk: -0.05,
    esg_controversy: -0.03,
  },
  normalization: "zscore",
  winsor: 0.05,
  top_n: 20,
  max_weight: 0.1,
  sector_cap: 0.3,
  weighting: "score_tilt",
  eligible_sectors: [],
  min_market_cap_usd: 50_000_000_000,
  competitive_position: [],
};

const ID_COL = "ticker";
const SECTOR_COL = "sector";
const MCAP_COL = "market_cap_usd";
const POSITION_COL = "competitive_position";

export type Row = Record<string, string>;

// Minimal CSV parser (no quoted fields; blank cells stay "").
export function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

const toNum = (v: string | undefined) => (v === undefined || v === "" ? NaN : Number(v));
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

// pandas-compatible linear-interpolation quantile.
function quantile(xs: number[], q: number): number {
  const v = [...xs].sort((a, b) => a - b);
  const h = (v.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, v.length - 1);
  const t = h - lo;
  const d = v[hi] - v[lo];
  return t >= 0.5 ? v[hi] - d * (1 - t) : v[lo] + d * t;
}

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// pandas rank(method="average"), 1-based.
function rankAverage(xs: number[]): number[] {
  const n = xs.length;
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) out[idx[k]] = avg;
    i = j + 1;
  }
  return out;
}

// Deterministic; returns all zeros for a constant column.
function normalize(xs: number[], method: string): number[] {
  if (method === "zscore") {
    const m = sum(xs) / xs.length;
    const sd = Math.sqrt(sum(xs.map((x) => (x - m) * (x - m))) / xs.length);
    return sd > 0 ? xs.map((x) => (x - m) / sd) : xs.map(() => 0);
  }
  if (method === "minmax") {
    const lo = Math.min(...xs);
    const rng = Math.max(...xs) - lo;
    return rng > 0 ? xs.map((x) => (x - lo) / rng) : xs.map(() => 0);
  }
  if (method === "rank") {
    const r = rankAverage(xs);
    const lo = Math.min(...r);
    const rng = Math.max(...r) - lo;
    return rng > 0 ? r.map((x) => (x - lo) / rng) : r.map(() => 0);
  }
  throw new Error(`unknown normalization method: ${method}`);
}

// Median-fill gaps, then optional winsorize.
function prep(xs: number[], cfg: IndexConfig): number[] {
  let x = xs;
  if (x.some(Number.isNaN)) {
    const med = median(x.filter((v) => !Number.isNaN(v)));
    x = x.map((v) => (Number.isNaN(v) ? med : v));
  }
  if (cfg.winsor > 0) {
    const lo = quantile(x, cfg.winsor);
    const hi = quantile(x, 1 - cfg.winsor);
    x = x.map((v) => Math.min(Math.max(v, lo), hi));
  }
  return x;
}

function eligible(rows: Row[], cfg: IndexConfig): Row[] {
  return rows.filter((r) => {
    if (cfg.eligible_sectors.length > 0 && !cfg.eligible_sectors.includes(r[SECTOR_COL])) return false;
    if (cfg.competitive_position.length > 0 && !cfg.competitive_position.includes(r[POSITION_COL])) return false;
    if (cfg.min_market_cap_usd > 0 && !(toNum(r[MCAP_COL]) >= cfg.min_market_cap_usd)) return false;
    return true;
  });
}

function compositeScore(rows: Row[], cfg: IndexConfig): number[] {
  const score = rows.map(() => 0);
  for (const [feat, w] of Object.entries(cfg.weights)) {
    if (w === 0) continue;
    if (!(feat in (rows[0] ?? {}))) throw new Error(`scoring feature ${feat} missing from feature matrix`);
    const norm = normalize(prep(rows.map((r) => toNum(r[feat])), cfg), cfg.normalization);
    for (let i = 0; i < rows.length; i++) score[i] += w * norm[i];
  }
  return score;
}

// Iterative water-filling caps (per-name max_weight, per-sector sector_cap).
function applyCaps(raw: number[], sectors: string[], cfg: IndexConfig, iters = 500): number[] {
  const n = raw.length;
  const rawSum = sum(raw);
  let w = raw.map((x) => x / rawSum);
  const uniq: string[] = [];
  for (const s of sectors) if (!uniq.includes(s)) uniq.push(s);
  for (let it = 0; it < iters; it++) {
    const prev = [...w];
    w = w.map((x) => Math.min(x, cfg.max_weight));
    for (const sec of uniq) {
      let sw = 0;
      for (let i = 0; i < n; i++) if (sectors[i] === sec) sw += w[i];
      if (sw > cfg.sector_cap && sw > 0) {
        const scale = cfg.sector_cap / sw;
        for (let i = 0; i < n; i++) if (sectors[i] === sec) w[i] *= scale;
      }
    }
    const deficit = 1 - sum(w);
    const headroom = w.map((x) => Math.max(cfg.max_weight - x, 0));
    const hs = sum(headroom);
    if (deficit > 1e-12 && hs > 0) {
      w = w.map((x, i) => x + (deficit * headroom[i]) / hs);
    } else if (Math.abs(deficit) > 1e-12) {
      const s = sum(w);
      w = w.map((x) => x / s);
    }
    let diff = 0;
    for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(w[i] - prev[i]));
    if (diff < 1e-12) break;
  }
  const s = sum(w);
  return w.map((x) => x / s);
}

export interface IndexEntry {
  id: string; // matrix ticker
  sector: string;
  score: number;
  weight: number; // fraction, sums to 1
}

// (matrix rows, cfg) -> selected names + float weights, score desc, id asc.
export function buildIndex(rows: Row[], cfg: IndexConfig): IndexEntry[] {
  const ids = rows.map((r) => r[ID_COL]);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate ids in feature matrix");
  const elig = eligible(rows, cfg);
  if (elig.length === 0) throw new Error("no companies pass the eligibility filter");
  const score = compositeScore(elig, cfg);
  const order = elig
    .map((_, i) => i)
    .sort((a, b) => {
      if (score[a] !== score[b]) return score[b] - score[a];
      return elig[a][ID_COL] < elig[b][ID_COL] ? -1 : 1;
    })
    .slice(0, cfg.top_n);
  const sel = order.map((i) => ({id: elig[i][ID_COL], sector: elig[i][SECTOR_COL], score: score[i]}));
  let raw: number[];
  if (cfg.weighting === "equal") {
    raw = sel.map(() => 1);
  } else if (cfg.weighting === "score_tilt") {
    const min = Math.min(...sel.map((s) => s.score));
    raw = sel.map((s) => s.score - min + 1e-9);
  } else {
    throw new Error(`unknown weighting: ${cfg.weighting}`);
  }
  const w = applyCaps(raw, sel.map((s) => s.sector), cfg);
  return sel.map((s, i) => ({...s, weight: w[i]}));
}

// Largest-remainder (Hamilton) quantizer, ties broken by id ascending. Same
// rule as to_bps() in index_builder.py; total=100 gives integer percentages.
export function weightsToUnits(ids: string[], weights: number[], total = 10000): number[] {
  const s = sum(weights);
  const exact = weights.map((w) => (w / s) * total);
  const floors = exact.map(Math.floor);
  const leftover = total - sum(floors);
  const order = ids
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = exact[a] - floors[a];
      const rb = exact[b] - floors[b];
      if (ra !== rb) return rb - ra;
      return ids[a] < ids[b] ? -1 : 1;
    });
  for (let k = 0; k < leftover; k++) floors[order[k]] += 1;
  return floors;
}

// --------------------------------------------------------------------------
// Preview: server build if VITE_BUILD_URL is set, else in-browser fallback.
// --------------------------------------------------------------------------
const BUILD_URL = import.meta.env.VITE_BUILD_URL as string | undefined;
const base = import.meta.env.BASE_URL;

export interface PreviewResult {
  ok: boolean;
  entries: IndexEntry[];
  source: "server" | "browser";
  error?: string;
}

let matrixCache: Promise<Row[]> | null = null;
function loadMatrix(): Promise<Row[]> {
  matrixCache ??= fetch(`${base}data/feature-matrix.csv`).then(async (r) => {
    if (!r.ok) throw new Error(`feature matrix unavailable (${r.status})`);
    return parseCsv(await r.text());
  });
  return matrixCache;
}

export async function previewIndex(cfg: IndexConfig): Promise<PreviewResult> {
  if (BUILD_URL) {
    try {
      const r = await fetch(BUILD_URL, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({config: cfg}),
      });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j?.entries)) return {ok: true, entries: j.entries, source: "server"};
      }
    } catch {
      // fall through to the in-browser build
    }
  }
  try {
    const rows = await loadMatrix();
    return {ok: true, entries: buildIndex(rows, cfg), source: "browser"};
  } catch (e) {
    return {ok: false, entries: [], source: "browser", error: String(e instanceof Error ? e.message : e)};
  }
}
