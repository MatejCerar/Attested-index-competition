// Prompt -> RebalanceSpec for the /build rebalance box. POST {prompt} to
// VITE_REBALANCE_URL (scripts/server.mjs /api/rebalance-strategy, Claude Haiku
// behind a JSON schema) and get back {name, note, spec, source} where spec is
// the trigger spec the live engine evaluates each tick. With no server, or on
// any failure, gracefully return the safe default spec with source:"fallback".
// Never throws.

export interface RebalanceSpec {
  intervalMs: number | null;
  driftBps: number | null;
  takeProfitPct: number | null; // fraction, 10% = 0.1
  cooldownMs: number | null;
  combine: "any" | "all";
  maxStepMoveBps: number;
  note?: string;
}

export interface GeneratedRebalance {
  name: string;
  note: string;
  spec: RebalanceSpec;
  source: "live" | "fallback";
}

// Keep in sync with EXAMPLE_REBALANCE_PROMPTS in index/generate.mjs (the FE
// cannot import the .mjs, so the chips are duplicated here).
export const REBALANCE_PROMPT_TEMPLATES = [
  "take profit at 10%, otherwise rebalance weekly, never more than once a day",
  "rebalance only when the portfolio drifts 5% from target",
  "monthly, but rebalance early if the portfolio gains 20%",
  "daily rebalancing with a 2% drift band, at most twice a day",
  "hands off: only rebalance on 10% aggregate drift, max once a week",
  "aggressive: hourly, or 3% drift, take profit at 5%",
];

const API = import.meta.env.VITE_API_URL as string | undefined;
const REB_URL =
  (import.meta.env.VITE_REBALANCE_URL as string | undefined) ??
  (API ? `${API}/rebalance-strategy` : undefined);

// Safe default: hourly or 5% aggregate drift, at most once an hour. Matches
// the server-side fallbackRebalance in index/generate.mjs.
function fallback(): GeneratedRebalance {
  return {
    name: "Hourly + 5% drift (default)",
    note:
      "Default policy: rebalance hourly or on 5% aggregate drift, at most " +
      "once an hour. Live generation was unavailable.",
    spec: {
      intervalMs: 3600000,
      driftBps: 500,
      takeProfitPct: null,
      cooldownMs: 3600000,
      combine: "any",
      maxStepMoveBps: 2500,
      note: "hourly or 5% aggregate drift, 1h cooldown",
    },
    source: "fallback",
  };
}

const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Server spec -> client RebalanceSpec; null when no trigger survives.
function sanitizeSpec(raw: unknown): RebalanceSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const intervalMs = numOrNull(r.intervalMs);
  const driftBps = numOrNull(r.driftBps);
  const takeProfitPct = numOrNull(r.takeProfitPct);
  const cooldownMs = numOrNull(r.cooldownMs);
  if (intervalMs == null && driftBps == null && takeProfitPct == null) return null;
  return {
    intervalMs,
    driftBps,
    takeProfitPct,
    cooldownMs,
    combine: r.combine === "all" ? "all" : "any",
    maxStepMoveBps: numOrNull(r.maxStepMoveBps) ?? 2500,
    note: String(r.note ?? "").trim().slice(0, 240) || undefined,
  };
}

export async function generateRebalanceStrategy(
  prompt: string
): Promise<GeneratedRebalance> {
  if (!REB_URL) return fallback();
  try {
    const r = await fetch(REB_URL, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({prompt}),
    });
    if (!r.ok) return fallback();
    const j = await r.json();
    const spec = sanitizeSpec(j?.spec);
    if (!spec) return fallback();
    return {
      name: String(j?.name ?? "").trim().slice(0, 60) || "Custom Rebalance",
      note: String(j?.note ?? spec.note ?? "").trim().slice(0, 240),
      spec,
      source: j?.source === "fallback" ? "fallback" : "live",
    };
  } catch {
    return fallback();
  }
}
