// Index config vocabulary shared by the /build editor and the prompt
// generator, plus the server-backed preview. The deterministic build itself
// runs only on the server (scripts/server.mjs /api/build, the same module the
// enclave gate runs); there is no in-browser builder.

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
// an eligibility filter) of the frozen feature matrix.
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

// The 11 GICS sectors (feature-matrix `sector` label enum).
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

// House config, mirrored from index/attested-indices.mjs BASE (version 3).
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

export interface IndexEntry {
  id: string; // matrix ticker
  sector: string;
  score: number;
  weight: number; // fraction, sums to 1
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

// Largest-remainder (Hamilton) quantizer, ties broken by id ascending. Same
// rule as the server-side to_bps; total=100 gives integer percentages.
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
// Preview: server build only (VITE_BUILD_URL -> scripts/server.mjs /api/build).
// --------------------------------------------------------------------------
const BUILD_URL = import.meta.env.VITE_BUILD_URL as string | undefined;

export interface PreviewResult {
  ok: boolean;
  entries: IndexEntry[];
  error?: string;
}

const NO_SERVER =
  "Preview needs the build server. Start it (npm run compete) and set VITE_BUILD_URL.";

export async function previewIndex(cfg: IndexConfig): Promise<PreviewResult> {
  if (!BUILD_URL) return {ok: false, entries: [], error: NO_SERVER};
  try {
    const r = await fetch(BUILD_URL, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({config: cfg}),
    });
    if (!r.ok) return {ok: false, entries: [], error: `build server error (${r.status})`};
    const j = await r.json();
    if (!Array.isArray(j?.entries)) return {ok: false, entries: [], error: "bad build response"};
    return {ok: true, entries: j.entries};
  } catch {
    return {ok: false, entries: [], error: NO_SERVER};
  }
}
