import type {Catalog, CatalogAsset} from "@/core/types.ts";
import {DEFAULT_STRATEGY, STRATEGY_TEMPLATES} from "@/core/strategies.ts";

// Whole-index generation for the /build "Generate from prompt" box. The real
// generator is index/generate.mjs (Claude Haiku, validated against the
// catalog). The static app cannot spawn the CLI, so it uses two paths:
//  1. If VITE_GENERATE_URL is set, POST {prompt} to that endpoint (a thin
//     server wrapping generateIndex) and use its {name,rationale,assets,
//     weights,strategy} response verbatim.
//  2. Otherwise fall back to an in-browser heuristic that mirrors
//     candidatesForPrompt: rank the priceable universe by keyword overlap, take
//     the top few, and weight them. Produces the same object shape so the
//     builder pre-fills identically.
// Either way the result is validated against the catalog before it is returned.

export interface GeneratedIndex {
  name: string;
  rationale: string;
  assets: string[]; // catalog ids
  weights: Record<string, number>;
  strategy: string;
  source: "server" | "heuristic";
}

const GEN_URL = import.meta.env.VITE_GENERATE_URL as string | undefined;

export async function generateIndex(
  prompt: string,
  catalog: Catalog
): Promise<GeneratedIndex> {
  if (GEN_URL) {
    try {
      const r = await fetch(GEN_URL, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({prompt}),
      });
      if (r.ok) {
        const j = await r.json();
        const validated = validateAgainstCatalog(j, catalog);
        if (validated) return {...validated, source: "server"};
      }
    } catch {
      // fall through to heuristic
    }
  }
  return heuristicGenerate(prompt, catalog);
}

// Validate a server/model result against the catalog: keep only known ids,
// renormalize weights to sum 100, coerce the strategy.
function validateAgainstCatalog(
  j: any,
  catalog: Catalog
): Omit<GeneratedIndex, "source"> | null {
  const byId = new Map(catalog.assets.map((a) => [a.id, a]));
  const byTicker = new Map<string, string>();
  for (const a of catalog.assets) {
    if (a.priceSource) byTicker.set(a.ticker.toLowerCase(), a.id);
  }
  const raw = j?.weights ?? {};
  const idW: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    const id = byId.has(k) ? k : byTicker.get(String(k).toLowerCase());
    if (!id) continue;
    idW[id] = (idW[id] ?? 0) + n;
  }
  const norm = renormalize(idW);
  if (!norm) return null;
  const strategy = STRATEGY_TEMPLATES.some((s) => s.id === j?.strategy)
    ? j.strategy
    : DEFAULT_STRATEGY;
  return {
    name: String(j?.name ?? "").slice(0, 60) || "Generated Index",
    rationale: String(j?.rationale ?? "").slice(0, 240),
    assets: Object.keys(norm),
    weights: norm,
    strategy,
  };
}

function heuristicGenerate(prompt: string, catalog: Catalog): GeneratedIndex {
  const priceable = catalog.assets.filter((a) => a.priceSource);
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  const score = (a: CatalogAsset) => {
    const hay = `${a.ticker} ${a.name} ${a.issuerName} ${a.assetClass}`.toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s += 1;
    return s;
  };
  const ranked = priceable
    .map((a) => ({a, s: score(a), v: a.vol24 ?? 0}))
    .sort((x, y) => y.s - x.s || y.v - x.v);
  const hit = ranked.filter((x) => x.s > 0);
  const chosen = (hit.length >= 2 ? hit : ranked).slice(0, Math.min(5, Math.max(2, hit.length || 3)));
  // Volume-tilted weights, renormalized to 100.
  const totalV = chosen.reduce((a, x) => a + (x.v || 1), 0);
  const rawW: Record<string, number> = {};
  for (const x of chosen) rawW[x.a.id] = ((x.v || 1) / totalV) * 100;
  const weights = renormalize(rawW)!;
  const first = chosen[0]?.a;
  return {
    name: first ? `${first.name.split(" ")[0]} & peers` : "Generated Index",
    rationale: `Heuristic pick from the catalog for: "${prompt.slice(0, 120)}". Edit before submitting.`,
    assets: Object.keys(weights),
    weights,
    strategy: DEFAULT_STRATEGY,
    source: "heuristic",
  };
}

function renormalize(idW: Record<string, number>): Record<string, number> | null {
  const total = Object.values(idW).reduce((a, v) => a + v, 0);
  if (total <= 0) return null;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(idW)) out[id] = Math.round((v / total) * 100);
  for (const id of Object.keys(out)) if (out[id] <= 0) delete out[id];
  const ids = Object.keys(out);
  if (!ids.length) return null;
  const sum = ids.reduce((a, id) => a + out[id], 0);
  if (sum !== 100) {
    const largest = ids.reduce((a, id) => (out[id] > out[a] ? id : a), ids[0]);
    out[largest] += 100 - sum;
    if (out[largest] <= 0) delete out[largest];
  }
  return Object.keys(out).length ? out : null;
}
