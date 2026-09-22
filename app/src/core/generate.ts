import {
  GICS_SECTORS,
  HOUSE_CONFIG,
  SCORING_FEATURES,
  type IndexConfig,
} from "@/core/index-config.ts";
import {DEFAULT_STRATEGY, STRATEGY_TEMPLATES} from "@/core/strategies.ts";

// Prompt -> full index config for the /build Prompt mode. POST {prompt} to
// VITE_GENERATE_URL (scripts/server.mjs /api/generate, Claude Haiku behind a
// JSON schema) and get back {name, rationale, config, strategy, source} where
// config is a complete IndexConfig the Rule editor can load verbatim. With no
// server, or on any failure, gracefully return the house default config with
// source:"fallback". Never throws.

export interface GeneratedIndex {
  name: string;
  rationale: string;
  config: IndexConfig;
  strategy: string;
  source: "live" | "fallback";
}

const GEN_URL = import.meta.env.VITE_GENERATE_URL as string | undefined;

function fallback(): GeneratedIndex {
  return {
    name: "House Factor Index (default)",
    rationale:
      "House v3 multi-factor config: value, quality, growth, momentum, low " +
      "volatility plus AI-scored qualitative factors. Live generation was " +
      "unavailable.",
    config: structuredClone(HOUSE_CONFIG),
    strategy: DEFAULT_STRATEGY,
    source: "fallback",
  };
}

export async function generateIndex(prompt: string): Promise<GeneratedIndex> {
  if (!GEN_URL) return fallback();
  try {
    const r = await fetch(GEN_URL, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({prompt}),
    });
    if (!r.ok) return fallback();
    const j = await r.json();
    const config = sanitizeConfig(j?.config);
    if (!config) return fallback();
    const strategy = STRATEGY_TEMPLATES.some((s) => s.id === j?.strategy)
      ? (j.strategy as string)
      : DEFAULT_STRATEGY;
    return {
      name: String(j?.name ?? "").trim().slice(0, 60) || "Generated Index",
      rationale: String(j?.rationale ?? "").trim().slice(0, 240),
      config,
      strategy,
      source: j?.source === "fallback" ? "fallback" : "live",
    };
  } catch {
    return fallback();
  }
}

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Server config -> client IndexConfig: keep only known scoring features and
// GICS sectors, coerce enums, fill anything missing from the house config.
function sanitizeConfig(raw: unknown): IndexConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawW = (r.weights && typeof r.weights === "object" ? r.weights : {}) as Record<
    string,
    unknown
  >;
  const weights: Record<string, number> = {};
  for (const f of SCORING_FEATURES) {
    const v = Number(rawW[f.name]);
    if (Number.isFinite(v) && v !== 0) weights[f.name] = v;
  }
  if (Object.keys(weights).length === 0) return null;
  const h = HOUSE_CONFIG;
  return {
    version: Math.round(num(r.version, h.version)),
    weights,
    normalization:
      r.normalization === "rank" || r.normalization === "minmax"
        ? r.normalization
        : "zscore",
    winsor: num(r.winsor, h.winsor),
    top_n: Math.max(1, Math.round(num(r.top_n, h.top_n))),
    max_weight: num(r.max_weight, h.max_weight),
    sector_cap: num(r.sector_cap, h.sector_cap),
    weighting: r.weighting === "equal" ? "equal" : "score_tilt",
    eligible_sectors: Array.isArray(r.eligible_sectors)
      ? r.eligible_sectors.filter(
          (s): s is string =>
            typeof s === "string" && (GICS_SECTORS as readonly string[]).includes(s)
        )
      : [],
    min_market_cap_usd: num(r.min_market_cap_usd, h.min_market_cap_usd),
    competitive_position: [],
  };
}
