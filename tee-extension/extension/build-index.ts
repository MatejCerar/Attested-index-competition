/**
 * Deterministic index construction - TypeScript port of
 * deterministic-index/index_builder.py so the enclave can re-run the exact
 * build. Pure function of (matrix, config): no I/O, no randomness, no Date.
 *
 * Pipeline: eligibility filter -> per-feature clean (median-fill + winsor) ->
 * normalize (zscore | rank | minmax, 0 for constant columns) -> signed-weighted
 * composite score -> deterministic top-N (ties by id ascending, stable sort) ->
 * iterative water-filling caps (per-name max_weight, per-sector sector_cap).
 *
 * Cross-language parity: float intermediates may differ from numpy in the low
 * bits; the canonical boundary is weightsToBps() (largest-remainder / Hamilton
 * to integer bps summing to 10000), mirrored by to_bps() in
 * deterministic-index/index_builder.py. Pinned orderings that both sides share:
 * feature iteration = config.weights insertion order, sector iteration = first
 * appearance in the selected (score-sorted) set, sums left to right, canonical
 * output order = (bps desc, id asc).
 */

/** Mirrors IndexConfig in index_builder.py, field for field (snake_case kept
 *  so a config serialized from the Python side is consumed verbatim). */
export interface IndexConfig {
  version: number;
  weights: Record<string, number>;
  normalization: "zscore" | "rank" | "minmax";
  winsor: number;
  top_n: number;
  max_weight: number;
  sector_cap: number;
  weighting: "equal" | "score_tilt";
  eligible_sectors: string[];
  min_market_cap_usd: number;
  id_col: string;
  sector_col: string;
  market_cap_col: string;
}

export type Row = Record<string, string>;

/** Minimal CSV parser (no quoted fields; blank cells stay ""). */
export function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function toNum(v: string | undefined): number {
  return v === undefined || v === "" ? NaN : Number(v);
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** numpy's _lerp (with the t >= 0.5 rewrite), used by pandas quantile. */
function lerp(a: number, b: number, t: number): number {
  const d = b - a;
  return t >= 0.5 ? b - d * (1 - t) : a + d * t;
}

/** Linear-interpolation quantile, identical to pandas Series.quantile. */
function quantile(xs: number[], q: number): number {
  const v = [...xs].sort((a, b) => a - b);
  const h = (v.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, v.length - 1);
  return lerp(v[lo]!, v[hi]!, h - lo);
}

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** rank(method="average"), 1-based, like pandas. */
function rankAverage(xs: number[]): number[] {
  const n = xs.length;
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const out = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]!] === xs[idx[i]!]) j++;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) out[idx[k]!] = avg;
    i = j + 1;
  }
  return out;
}

/** Deterministic, returns all zeros for a constant column (as Python). */
export function normalize(xs: number[], method: string): number[] {
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

/** Median-fill gaps, then optional winsorize - mirrors _prep(). */
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
    if (
      cfg.eligible_sectors.length > 0 &&
      !cfg.eligible_sectors.includes(r[cfg.sector_col]!)
    )
      return false;
    if (
      cfg.min_market_cap_usd > 0 &&
      r[cfg.market_cap_col] !== undefined &&
      !(toNum(r[cfg.market_cap_col]) >= cfg.min_market_cap_usd)
    )
      return false;
    return true;
  });
}

function compositeScore(rows: Row[], cfg: IndexConfig): number[] {
  const score = rows.map(() => 0);
  for (const [feat, w] of Object.entries(cfg.weights)) {
    if (!(feat in (rows[0] ?? {})))
      throw new Error(`scoring feature ${feat} missing from feature matrix`);
    const norm = normalize(
      prep(
        rows.map((r) => toNum(r[feat])),
        cfg,
      ),
      cfg.normalization,
    );
    for (let i = 0; i < rows.length; i++) score[i]! += w * norm[i]!;
  }
  return score;
}

/** Water-filling caps, always sums to 1 - mirrors _apply_caps(). */
function applyCaps(
  raw: number[],
  sectors: string[],
  cfg: IndexConfig,
  iters = 500,
): number[] {
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
      for (let i = 0; i < n; i++) if (sectors[i] === sec) sw += w[i]!;
      if (sw > cfg.sector_cap && sw > 0) {
        const scale = cfg.sector_cap / sw;
        for (let i = 0; i < n; i++) if (sectors[i] === sec) w[i]! *= scale;
      }
    }
    const deficit = 1 - sum(w);
    const headroom = w.map((x) => Math.max(cfg.max_weight - x, 0));
    const hs = sum(headroom);
    if (deficit > 1e-12 && hs > 0) {
      w = w.map((x, i) => x + (deficit * headroom[i]!) / hs);
    } else if (Math.abs(deficit) > 1e-12) {
      const s = sum(w);
      w = w.map((x) => x / s);
    }
    let diff = 0;
    for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(w[i]! - prev[i]!));
    if (diff < 1e-12) break;
  }
  const s = sum(w);
  return w.map((x) => x / s);
}

export interface IndexEntry {
  id: string;
  sector: string;
  score: number;
  weight: number;
}

/** Port of build_index(): (matrix rows, cfg) -> selected names + float weights
 *  in selection order (score desc, id asc). */
export function buildIndex(rows: Row[], cfg: IndexConfig): IndexEntry[] {
  const ids = rows.map((r) => r[cfg.id_col]!);
  if (new Set(ids).size !== ids.length)
    throw new Error("duplicate ids in feature matrix");
  const elig = eligible(rows, cfg);
  if (elig.length === 0)
    throw new Error("no companies pass the eligibility filter");
  const score = compositeScore(elig, cfg);
  const order = elig
    .map((_, i) => i)
    .sort((a, b) => {
      if (score[a]! !== score[b]!) return score[b]! - score[a]!;
      return elig[a]![cfg.id_col]! < elig[b]![cfg.id_col]! ? -1 : 1;
    })
    .slice(0, cfg.top_n);
  const sel = order.map((i) => ({
    id: elig[i]![cfg.id_col]!,
    sector: elig[i]![cfg.sector_col]!,
    score: score[i]!,
  }));
  let raw: number[];
  if (cfg.weighting === "equal") {
    raw = sel.map(() => 1);
  } else if (cfg.weighting === "score_tilt") {
    const min = Math.min(...sel.map((s) => s.score));
    raw = sel.map((s) => s.score - min + 1e-9);
  } else {
    throw new Error(`unknown weighting: ${cfg.weighting}`);
  }
  const w = applyCaps(
    raw,
    sel.map((s) => s.sector),
    cfg,
  );
  return sel.map((s, i) => ({ ...s, weight: w[i]! }));
}

/**
 * Canonical bps quantizer - the cross-language boundary. Largest-remainder
 * (Hamilton): floor every weight*total, then hand the leftover units to the
 * largest fractional remainders, ties broken by id ascending. Identical rule
 * as to_bps() in deterministic-index/index_builder.py.
 */
export function weightsToBps(
  ids: string[],
  weights: number[],
  total = 10000,
): number[] {
  const s = sum(weights);
  const exact = weights.map((w) => (w / s) * total);
  const floors = exact.map(Math.floor);
  const leftover = total - sum(floors);
  const order = ids
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = exact[a]! - floors[a]!;
      const rb = exact[b]! - floors[b]!;
      if (ra !== rb) return rb - ra;
      return ids[a]! < ids[b]! ? -1 : 1;
    });
  for (let k = 0; k < leftover; k++) floors[order[k]!]! += 1;
  return floors;
}

/** Full canonical build: csv rows + config -> integer bps summing to 10000,
 *  in canonical order (bps desc, id asc). */
export function buildIndexBps(
  rows: Row[],
  cfg: IndexConfig,
): { tickers: string[]; weightsBps: number[] } {
  const entries = buildIndex(rows, cfg);
  const bps = weightsToBps(
    entries.map((e) => e.id),
    entries.map((e) => e.weight),
  );
  const order = entries
    .map((_, i) => i)
    .sort((a, b) => {
      if (bps[a]! !== bps[b]!) return bps[b]! - bps[a]!;
      return entries[a]!.id < entries[b]!.id ? -1 : 1;
    });
  return {
    tickers: order.map((i) => entries[i]!.id),
    weightsBps: order.map((i) => bps[i]!),
  };
}
