// AI index generation via Claude Code headless. Each index restates its
// weights from its natural-language prompt using the cheapest model. Verified
// invocation in this environment: prompt on STDIN (the variadic tool flags eat
// a prompt arg otherwise), tools disabled so the model answers from its own
// knowledge instead of trying to fetch. On any failure it falls back to the
// index's last-good weights and logs that live-gen is unavailable.
import {spawn} from "node:child_process";
import {INDICES} from "./indices.mjs";
import {STRATEGIES, coerceRebalanceSpec, DEFAULT_MAX_STEP_MOVE_BPS} from "./strategies.mjs";
import {candidatesForPrompt, assetIndex, selectableAssets} from "./catalog.mjs";

const MODEL = "claude-haiku-4-5-20251001";
// API model id (bare alias, no date suffix) used by the headless Anthropic API
// path. Same tier as the CLI model above.
const API_MODEL = "claude-haiku-4-5";
const DISALLOWED = ["WebFetch", "WebSearch", "Bash"];
const STRATEGY_IDS = Object.keys(STRATEGIES);
const DEFAULT_STRATEGY = STRATEGY_IDS.includes("hourly-or-drift")
    ? "hourly-or-drift"
    : STRATEGY_IDS[0];

// A safe default RWA index if generation fails entirely. Two large tokenized
// equities from the catalog; no crypto anywhere on the board.
const FALLBACK_INDEX = {
    name: "Big-Tech RWA (default)",
    rationale: "Default basket: two large tokenized US tech equities. Live generation was unavailable.",
    assets: ["NVDAx::backed-assets-je-limited", "AAPLx::backed-assets-je-limited"],
    weights: {
        "NVDAx::backed-assets-je-limited": 60,
        "AAPLx::backed-assets-je-limited": 40,
    },
    strategy: DEFAULT_STRATEGY,
    source: "fallback",
};

// Pull the first {...} JSON object out of possibly-fenced model output.
function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : text;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end < 0 || end < start) return null;
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch {
        return null;
    }
}

function runClaude(prompt, timeoutMs) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(
                "claude",
                ["-p", "--model", MODEL, "--disallowedTools", ...DISALLOWED],
                {stdio: ["pipe", "pipe", "pipe"]}
            );
        } catch (e) {
            return resolve({ok: false, err: String(e)});
        }
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve({ok: false, err: "timeout"});
        }, timeoutMs);
        child.on("error", (e) => {
            clearTimeout(timer);
            resolve({ok: false, err: String(e)}); // CLI missing, etc.
        });
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) return resolve({ok: false, err: err || `exit ${code}`});
            resolve({ok: true, out});
        });
        child.stdin.write(prompt);
        child.stdin.end();
    });
}

// Headless generation via the Anthropic Messages API. Used on servers/containers
// with no `claude` CLI. Enabled by setting ANTHROPIC_API_KEY. Raw fetch (Node 22
// has global fetch) keeps this file dependency-free so the server needs no extra
// install. Returns the same {ok, out|err} shape as runClaude.
async function runClaudeApi(prompt, timeoutMs, schema = null) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return {ok: false, err: "no ANTHROPIC_API_KEY"};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: process.env.ANTHROPIC_MODEL || API_MODEL,
                max_tokens: 1024,
                messages: [{role: "user", content: prompt}],
                // Schema-locked output (labeler.py style) when the caller has one.
                ...(schema
                    ? {output_config: {format: {type: "json_schema", schema}}}
                    : {}),
            }),
            signal: ctrl.signal,
        });
        if (!r.ok) {
            const body = await r.text().catch(() => "");
            return {ok: false, err: `http ${r.status} ${body.slice(0, 200)}`};
        }
        const data = await r.json();
        const out = (data.content || [])
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
        if (!out) return {ok: false, err: "empty response"};
        return {ok: true, out};
    } catch (e) {
        return {ok: false, err: e.name === "AbortError" ? "timeout" : String(e)};
    } finally {
        clearTimeout(timer);
    }
}

// Prefer the API path when a key is configured (headless/server), else fall back
// to the local `claude` CLI (dev machines with an interactive login). The schema
// only applies on the API path; the CLI path relies on the prompt + validation.
function callModel(prompt, timeoutMs, schema = null) {
    return process.env.ANTHROPIC_API_KEY
        ? runClaudeApi(prompt, timeoutMs, schema)
        : runClaude(prompt, timeoutMs);
}

// Generate fresh weights for one index from its prompt, restricted to the RWA
// catalog. Never throws; falls back to the index's last-good weights.
export async function generateWeights(index, {timeoutMs = 45000, limit = 60} = {}) {
    const cands = candidatesForPrompt(index.prompt, {limit});
    const res = await callModel(buildIndexPrompt(index.prompt, cands), timeoutMs);
    if (!res.ok) {
        console.error(
            `[gen] ${index.id}: live-gen unavailable (${res.err}), using fallback`
        );
        return {weights: index.weights, source: "fallback"};
    }
    const parsed = extractJson(res.out);
    const idx = validateWithCatalog(parsed, cands);
    if (!idx) {
        console.error(
            `[gen] ${index.id}: unparseable/empty weights, using fallback`
        );
        return {weights: index.weights, source: "fallback", raw: res.out.trim()};
    }
    return {weights: idx.weights, source: "live", raw: res.out.trim()};
}

// Build the compact candidate table string the model picks tickers from. Each
// row is `TICKER  name (class)` so the model has just enough to choose. Rows are
// RWA-only: the tokenized ticker.
function candidateTable(cands) {
    return cands
        .map((a) => {
            const px = a.priceUsd != null ? ` ~$${a.priceUsd}` : "";
            return `${a.ticker} - ${a.name} (${a.assetClass})${px}`;
        })
        .join("\n");
}

function buildIndexPrompt(prompt, cands) {
    return (
        `You are designing a tradable index from a fixed asset universe.\n` +
        `User request: ${prompt}\n\n` +
        `Pick assets ONLY from this candidate list (use the exact TICKER shown, ` +
        `left of the dash):\n${candidateTable(cands)}\n\n` +
        `Choose 2 to 8 tickers that best fit the request. If nothing is a ` +
        `perfect fit, pick the CLOSEST available names - never return an empty ` +
        `list. Return ONLY compact ` +
        `JSON, no prose, of the form ` +
        `{"name":"...","rationale":"...","assets":["T1","T2"],` +
        `"weights":{"T1":pct,"T2":pct},"strategy":"id"} where pct are integers ` +
        `summing to 100 over exactly the chosen assets, "strategy" is one of ` +
        `[${STRATEGY_IDS.join(",")}], name is short, rationale is one sentence.`
    );
}

// ---------------------------------------------------------------------------
// Prompt -> full deterministic IndexConfig (generateConfig). The config feeds
// buildFromConfig over the frozen feature matrix; only the config is AI-made.
// ---------------------------------------------------------------------------

// The 17 SCOREABLE features (11 NUMERIC + 6 SCORE in the frozen feature
// matrix): [direction, meaning]. LABEL features (sector, market_cap_tier,
// competitive_position) are filters/caps, never score weights.
const SCOREABLE = {
    market_cap_usd: [1, "market capitalization in USD (size)"],
    pe_forward: [-1, "forward P/E multiple (value: cheaper is better)"],
    ev_ebitda: [-1, "EV/EBITDA multiple (value: cheaper is better)"],
    fcf_yield: [1, "free cash flow yield (value)"],
    dividend_yield: [1, "dividend yield"],
    revenue_growth_yoy: [1, "year-over-year revenue growth"],
    gross_margin: [1, "gross margin (quality)"],
    return_on_equity: [1, "return on equity (quality)"],
    net_debt_to_ebitda: [-1, "net debt/EBITDA leverage (lower is safer)"],
    momentum_12m: [1, "12m price return excluding the latest month (momentum)"],
    volatility_90d: [-1, "90-day annualized volatility (lower is calmer)"],
    moat_strength: [1, "AI score 0..5: durable competitive advantage"],
    management_quality: [1, "AI score 0..5: management track record"],
    ai_exposure: [1, "AI score 0..5: AI relevance of the business"],
    regulatory_risk: [-1, "AI score 0..5: regulatory threat (lower is safer)"],
    esg_controversy: [-1, "AI score 0..5: ESG controversies (lower is cleaner)"],
    demand_durability: [1, "AI score 0..5: demand stability across cycles"],
};

// The 11 GICS sector labels (feature-matrix `sector` enum).
const SECTORS = [
    "energy", "materials", "industrials", "consumer_discretionary",
    "consumer_staples", "health_care", "financials", "information_technology",
    "communication_services", "utilities", "real_estate",
];

const NORMALIZATIONS = ["zscore", "rank", "minmax"];
const WEIGHTINGS = ["score_tilt", "equal"];
const DEFAULT_CONFIG_STRATEGY = STRATEGY_IDS.includes("hourly-or-drift-5")
    ? "hourly-or-drift-5"
    : DEFAULT_STRATEGY;

// House default: the v3 house weights (attested-indices.mjs BASE).
const DEFAULT_CONFIG = {
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
    weighting: "score_tilt",
    top_n: 20,
    max_weight: 0.1,
    sector_cap: 0.3,
    eligible_sectors: [],
    min_market_cap_usd: 50000000000,
    id_col: "ticker",
    sector_col: "sector",
    market_cap_col: "market_cap_usd",
};

function fallbackConfig() {
    return {
        name: "House Factor Index (default)",
        rationale:
            "House v3 multi-factor config: value, quality, growth, momentum, low volatility plus AI-scored qualitative factors. Live generation was unavailable.",
        config: {...DEFAULT_CONFIG, weights: {...DEFAULT_CONFIG.weights}, eligible_sectors: []},
        strategy: DEFAULT_CONFIG_STRATEGY,
        source: "fallback",
    };
}

// Enum/schema-locked output for the API path (labeler.py build_output_schema
// style). Every weight is required; the prompt tells the model to use 0 for
// features it does not want (zeros are dropped in validation).
function configOutputSchema() {
    const weightProps = {};
    for (const f of Object.keys(SCOREABLE)) weightProps[f] = {type: "number"};
    return {
        type: "object",
        properties: {
            name: {type: "string"},
            rationale: {type: "string"},
            config: {
                type: "object",
                properties: {
                    weights: {
                        type: "object",
                        properties: weightProps,
                        required: Object.keys(SCOREABLE),
                        additionalProperties: false,
                    },
                    normalization: {type: "string", enum: NORMALIZATIONS},
                    weighting: {type: "string", enum: WEIGHTINGS},
                    winsor: {type: "number"},
                    top_n: {type: "integer"},
                    max_weight: {type: "number"},
                    sector_cap: {type: "number"},
                    eligible_sectors: {
                        type: "array",
                        items: {type: "string", enum: SECTORS},
                    },
                    min_market_cap_usd: {type: "number"},
                },
                required: [
                    "weights", "normalization", "weighting", "winsor", "top_n",
                    "max_weight", "sector_cap", "eligible_sectors", "min_market_cap_usd",
                ],
                additionalProperties: false,
            },
            strategy: {type: "string", enum: STRATEGY_IDS},
        },
        required: ["name", "rationale", "config", "strategy"],
        additionalProperties: false,
    };
}

function buildConfigPrompt(prompt) {
    const feats = Object.entries(SCOREABLE)
        .map(([n, [dir, meaning]]) =>
            `${n} (${dir > 0 ? "positive weight, higher is better" : "NEGATIVE weight, lower is better"}) - ${meaning}`)
        .join("\n");
    return (
        `You are configuring a deterministic factor index built over a frozen ` +
        `feature matrix of large-cap equities.\n` +
        `User request: ${prompt}\n\n` +
        `Scoreable features (assign a signed weight to each; use 0 for features ` +
        `you do not want; absolute values of the nonzero weights should sum to ` +
        `about 1; features marked NEGATIVE must get weights <= 0):\n${feats}\n\n` +
        `GICS sectors for eligible_sectors ([] = allow all):\n${SECTORS.join(", ")}\n\n` +
        `Rebalance strategy ids (pick the one matching any cadence or drift the ` +
        `request mentions, e.g. "rebalance weekly" -> weekly, "5% drift" -> drift-5):\n` +
        `${STRATEGY_IDS.join(", ")}\n\n` +
        `Return ONLY compact JSON, no prose, of the form ` +
        `{"name":"...","rationale":"...","config":{"weights":{feature:signedWeight,...},` +
        `"normalization":"zscore|rank|minmax","weighting":"score_tilt|equal",` +
        `"winsor":0..0.1,"top_n":int,"max_weight":0..1,"sector_cap":0..1,` +
        `"eligible_sectors":[...],"min_market_cap_usd":number},"strategy":"id"} ` +
        `where name is short and rationale is one sentence.`
    );
}

const clampNum = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// Validate + coerce a parsed model object into a full IndexConfig result.
// Drops non-scoreable weight keys and unknown sectors, enforces the sign
// convention, renormalizes |weights| to sum 1, clamps caps to feasible ranges,
// coerces the strategy, and fills every missing field from DEFAULT_CONFIG.
// Returns null when no usable weights survive.
export function validateConfig(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    const raw = parsed.config && typeof parsed.config === "object" ? parsed.config : parsed;
    const weights = {};
    for (const [k, v] of Object.entries(raw.weights || {})) {
        const dir = SCOREABLE[k]?.[0];
        const n = Number(v);
        if (!dir || !Number.isFinite(n) || n === 0) continue;
        weights[k] = dir * Math.abs(n); // sign follows the feature direction
    }
    const sum = Object.values(weights).reduce((a, w) => a + Math.abs(w), 0);
    if (!(sum > 0)) return null;
    for (const k of Object.keys(weights))
        weights[k] = Math.round((weights[k] / sum) * 1e4) / 1e4;

    const eligible = Array.isArray(raw.eligible_sectors)
        ? [...new Set(raw.eligible_sectors.filter((s) => SECTORS.includes(s)))]
        : [];
    const top_n = Math.round(clampNum(raw.top_n, 1, 50, DEFAULT_CONFIG.top_n));
    // Feasibility floors: top_n names must be able to carry max_weight each to
    // 100%, and the allowed sectors must be able to carry sector_cap each.
    const max_weight = Math.max(
        clampNum(raw.max_weight, 0.01, 1, DEFAULT_CONFIG.max_weight),
        1 / top_n
    );
    const sector_cap = Math.max(
        clampNum(raw.sector_cap, 0.01, 1, DEFAULT_CONFIG.sector_cap),
        1 / (eligible.length || SECTORS.length)
    );
    const config = {
        ...DEFAULT_CONFIG,
        weights,
        normalization: NORMALIZATIONS.includes(raw.normalization)
            ? raw.normalization
            : DEFAULT_CONFIG.normalization,
        weighting: WEIGHTINGS.includes(raw.weighting)
            ? raw.weighting
            : DEFAULT_CONFIG.weighting,
        winsor: clampNum(raw.winsor, 0, 0.1, DEFAULT_CONFIG.winsor),
        top_n,
        max_weight,
        sector_cap,
        eligible_sectors: eligible,
        min_market_cap_usd: clampNum(
            raw.min_market_cap_usd, 0, 1e16, DEFAULT_CONFIG.min_market_cap_usd
        ),
    };
    const strategy = STRATEGY_IDS.includes(parsed.strategy)
        ? parsed.strategy
        : DEFAULT_CONFIG_STRATEGY;
    const name = String(parsed.name || "").trim().slice(0, 60) || "Untitled Index";
    const rationale = String(parsed.rationale || "").trim().slice(0, 240);
    return {name, rationale, config, strategy};
}

// Prompt -> {name, rationale, config, strategy, source:"live"|"fallback"} where
// config is a full IndexConfig over the SCOREABLE features, ready for
// buildFromConfig / POST /api/build. Never throws: any failure (no CLI or key,
// timeout, bad JSON, empty after validation) returns the house DEFAULT_CONFIG.
export async function generateConfig(prompt, {timeoutMs = 45000} = {}) {
    let res;
    try {
        res = await callModel(buildConfigPrompt(prompt), timeoutMs, configOutputSchema());
    } catch (e) {
        res = {ok: false, err: String(e)};
    }
    if (!res.ok) {
        console.error(`[gen] config: live-gen unavailable (${res.err}), using fallback`);
        return fallbackConfig();
    }
    const cfg = validateConfig(extractJson(res.out));
    if (!cfg) {
        console.error(`[gen] config: unparseable/empty config, using fallback`);
        return {...fallbackConfig(), raw: res.out.trim()};
    }
    return {...cfg, source: "live", raw: res.out.trim()};
}

// ---------------------------------------------------------------------------
// Prompt -> RebalanceSpec (generateRebalanceStrategy). Turns a free-form
// rebalance policy into the validated trigger spec strategies.mjs
// evalRebalanceSpec evaluates each tick. Same transport as generateConfig.
// ---------------------------------------------------------------------------

// Example prompts for the FE chips.
export const EXAMPLE_REBALANCE_PROMPTS = [
    "take profit at 10%, otherwise rebalance weekly, never more than once a day",
    "rebalance only when the portfolio drifts 5% from target",
    "monthly, but rebalance early if the portfolio gains 20%",
    "daily rebalancing with a 2% drift band, at most twice a day",
    "hands off: only rebalance on 10% aggregate drift, max once a week",
    "aggressive: hourly, or 3% drift, take profit at 5%",
    "rebalance monthly, or immediately if any name exceeds its cap by 3%, or on an 8% drawdown",
    "trim on a 5% sector drift, and de-risk if we lag the field by 10%, never more than daily",
    "defensive: rebalance when the trend flips below the 20-point average or realized vol tops 2%, hourly cooldown",
];

// Safe default: hourly or 5% aggregate drift, at most once an hour.
function fallbackRebalance() {
    return {
        name: "Hourly + 5% drift (default)",
        note: "Default policy: rebalance hourly or on 5% aggregate drift, at most once an hour. Live generation was unavailable.",
        spec: {
            intervalMs: 3600000,
            driftBps: 500,
            takeProfitPct: null,
            cooldownMs: 3600000,
            nameBreachBps: null,
            sectorDriftBps: null,
            drawdownPct: null,
            volBandPct: null,
            trendFlip: null,
            relativeLagPct: null,
            combine: "any",
            maxStepMoveBps: DEFAULT_MAX_STEP_MOVE_BPS,
            note: "hourly or 5% aggregate drift, 1h cooldown",
        },
        source: "fallback",
    };
}

// Schema-locked output for the API path (configOutputSchema style).
function rebalanceSpecSchema() {
    const numOrNull = {type: ["number", "null"]};
    return {
        type: "object",
        properties: {
            name: {type: "string"},
            note: {type: "string"},
            spec: {
                type: "object",
                properties: {
                    intervalMs: numOrNull,
                    driftBps: numOrNull,
                    takeProfitPct: numOrNull,
                    cooldownMs: numOrNull,
                    nameBreachBps: numOrNull,
                    sectorDriftBps: numOrNull,
                    drawdownPct: numOrNull,
                    volBandPct: numOrNull,
                    trendFlip: numOrNull,
                    relativeLagPct: numOrNull,
                    combine: {type: "string", enum: ["any", "all"]},
                    maxStepMoveBps: numOrNull,
                },
                required: [
                    "intervalMs", "driftBps", "takeProfitPct", "cooldownMs",
                    "nameBreachBps", "sectorDriftBps", "drawdownPct",
                    "volBandPct", "trendFlip", "relativeLagPct",
                    "combine", "maxStepMoveBps",
                ],
                additionalProperties: false,
            },
        },
        required: ["name", "note", "spec"],
        additionalProperties: false,
    };
}

function buildRebalancePrompt(prompt) {
    return (
        `You are turning a natural-language rebalance policy into a JSON ` +
        `trigger spec for an index vault.\n` +
        `User request: ${prompt}\n\n` +
        `Fields (use null for anything the request does not mention):\n` +
        `- intervalMs: calendar cadence in milliseconds (hourly=3600000, ` +
        `daily=86400000, weekly=604800000, monthly=2592000000, quarterly=7776000000)\n` +
        `- driftBps: AGGREGATE portfolio drift trigger in basis points (5% = 500); ` +
        `total one-way turnover vs target, not a single asset's drift\n` +
        `- takeProfitPct: rebalance when portfolio gain since the last rebalance ` +
        `reaches this FRACTION (10% = 0.1)\n` +
        `- cooldownMs: minimum milliseconds between rebalances ("never more than ` +
        `once a day" = 86400000)\n` +
        `- nameBreachBps: max SINGLE-NAME weight deviation from target in basis ` +
        `points ("any name exceeds its cap by 3%" = 300)\n` +
        `- sectorDriftBps: max SECTOR-level weight deviation from target in ` +
        `basis points, names aggregated by GICS sector (5% sector drift = 500)\n` +
        `- drawdownPct: rebalance when NAV has fallen this FRACTION from its ` +
        `running peak (8% drawdown = 0.08); uses NAV history\n` +
        `- volBandPct: rebalance when the realized volatility of recent ` +
        `per-tick returns reaches this FRACTION (2% = 0.02); uses NAV history\n` +
        `- trendFlip: rebalance when NAV crosses below its own moving average; ` +
        `value is the MA window in series points (default 20); uses NAV history\n` +
        `- relativeLagPct: rebalance when the index return lags the benchmark ` +
        `(the field-average return) by this FRACTION (10% = 0.1); uses history\n` +
        `- combine: "any" (default: any enabled trigger fires) or "all" (every ` +
        `enabled trigger must hold at once)\n` +
        `- maxStepMoveBps: refuse a rebalance if any asset price step exceeds ` +
        `this many bps (default 2500 = 25%); set only if the request asks for a ` +
        `tighter or looser guard\n\n` +
        `Return ONLY compact JSON, no prose, of the form ` +
        `{"name":"...","note":"...","spec":{"intervalMs":n|null,"driftBps":n|null,` +
        `"takeProfitPct":n|null,"cooldownMs":n|null,"nameBreachBps":n|null,` +
        `"sectorDriftBps":n|null,"drawdownPct":n|null,"volBandPct":n|null,` +
        `"trendFlip":n|null,"relativeLagPct":n|null,"combine":"any|all",` +
        `"maxStepMoveBps":n|null}} where name is short and note restates the ` +
        `policy in one sentence.`
    );
}

// Validate + coerce a parsed model object into {name, note, spec}. Returns
// null when no trigger survives coercion.
export function validateRebalanceSpec(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    const rawSpec = parsed.spec && typeof parsed.spec === "object" ? parsed.spec : parsed;
    const spec = coerceRebalanceSpec(rawSpec);
    if (!spec) return null;
    const name = String(parsed.name || "").trim().slice(0, 60) || "Custom Rebalance";
    const note = String(parsed.note || spec.note || "").trim().slice(0, 240);
    if (note) spec.note = note;
    return {name, note, spec};
}

// Prompt -> {name, note, spec, source:"live"|"fallback"}. Never throws: any
// failure (no CLI or key, timeout, bad JSON, empty after coercion) returns the
// safe default spec.
export async function generateRebalanceStrategy(prompt, {timeoutMs = 45000} = {}) {
    let res;
    try {
        res = await callModel(buildRebalancePrompt(prompt), timeoutMs, rebalanceSpecSchema());
    } catch (e) {
        res = {ok: false, err: String(e)};
    }
    if (!res.ok) {
        console.error(`[gen] rebalance: live-gen unavailable (${res.err}), using fallback`);
        return fallbackRebalance();
    }
    const v = validateRebalanceSpec(extractJson(res.out));
    if (!v) {
        console.error(`[gen] rebalance: unparseable/empty spec, using fallback`);
        return {...fallbackRebalance(), raw: res.out.trim()};
    }
    return {...v, source: "live", raw: res.out.trim()};
}

// Resolve a model-returned ticker to a catalog id, restricted to the candidate
// set. Case-insensitive on ticker; prefers an exact match.
function resolveTicker(ticker, cands) {
    const t = String(ticker).trim().toLowerCase();
    const hits = cands.filter((a) => a.ticker.toLowerCase() === t);
    if (hits.length) return hits[0].id;
    // loose: startsWith, so "AAPL" matches "AAPLx" if the model dropped the affix
    const loose = cands.filter(
        (a) => a.ticker.toLowerCase().startsWith(t) || t.startsWith(a.ticker.toLowerCase())
    );
    return loose.length ? loose[0].id : null;
}

// Renormalize a {id: rawPct} map to integers summing to 100, remainder on the
// largest. Works with arbitrary id strings (unlike normalizeWeights).
function renormalizeIds(idWeights, idOrder) {
    const total = idOrder.reduce((a, id) => a + idWeights[id], 0);
    if (total <= 0) return null;
    const out = {};
    for (const id of idOrder) out[id] = Math.round((idWeights[id] / total) * 100);
    for (const id of Object.keys(out)) if (out[id] <= 0) delete out[id];
    const ids = Object.keys(out);
    if (ids.length === 0) return null;
    let sum = ids.reduce((a, id) => a + out[id], 0);
    if (sum !== 100) {
        const largest = ids.reduce((a, id) => (out[id] > out[a] ? id : a), ids[0]);
        out[largest] += 100 - sum;
        if (out[largest] <= 0) delete out[largest];
    }
    return Object.keys(out).length ? out : null;
}

// Validate + normalize a parsed model object into a full index. Drops unknown
// tickers, renormalizes weights to sum 100 over the survivors, coerces the
// strategy, and returns null if nothing valid survives.
export function validateIndex(parsed, cands, byId = assetIndex()) {
    if (!parsed || typeof parsed !== "object") return null;
    const rawWeights = parsed.weights || {};
    // Map ticker -> id, summing duplicates.
    const idWeights = {};
    const idOrder = [];
    for (const [ticker, w] of Object.entries(rawWeights)) {
        const n = Number(w);
        if (!Number.isFinite(n) || n <= 0) continue;
        const id = resolveTicker(ticker, cands);
        if (!id || !byId.has(id)) continue;
        if (!(id in idWeights)) idOrder.push(id);
        idWeights[id] = (idWeights[id] || 0) + n;
    }
    if (idOrder.length === 0) return null;
    // Renormalize to integer pct summing to 100 over the resolved ids. (The
    // shared normalizeWeights uppercases symbols, which would break `::issuer`
    // ids, so we renormalize ids directly here.)
    const norm = renormalizeIds(idWeights, idOrder);
    if (!norm) return null;
    const assets = Object.keys(norm);
    const strategy = STRATEGY_IDS.includes(parsed.strategy)
        ? parsed.strategy
        : DEFAULT_STRATEGY;
    const name = String(parsed.name || "").trim().slice(0, 60) || "Untitled Index";
    const rationale = String(parsed.rationale || "").trim().slice(0, 240);
    return {name, rationale, assets, weights: norm, strategy};
}

// Validate against the prompt shortlist first; if nothing resolves there, retry
// against the FULL priceable catalog. Claude sometimes returns a real catalog
// ticker that just was not in the narrow shortlist for a given phrasing, and we
// do not want to discard those valid picks and fall back to the default basket.
function validateWithCatalog(parsed, cands) {
    if (!parsed) return null;
    return validateIndex(parsed, cands) || validateIndex(parsed, selectableAssets());
}

// Prompt -> a whole index object {name, rationale, assets, weights, strategy}.
// assets/weights use catalog ids; tickers are validated against the candidate
// shortlist. Never throws: on any failure returns FALLBACK_INDEX.
export async function generateIndex(prompt, {timeoutMs = 45000, limit = 60} = {}) {
    const cands = candidatesForPrompt(prompt, {limit});
    const res = await callModel(buildIndexPrompt(prompt, cands), timeoutMs);
    if (!res.ok) {
        console.error(`[gen] index: live-gen unavailable (${res.err}), using fallback`);
        return {...FALLBACK_INDEX};
    }
    const parsed = extractJson(res.out);
    const idx = validateWithCatalog(parsed, cands);
    if (!idx) {
        console.error(`[gen] index: unparseable/empty, using fallback`);
        return {...FALLBACK_INDEX, raw: res.out.trim()};
    }
    return {...idx, source: "live", raw: res.out.trim()};
}

// Refresh loop: regenerate every intervalMs, one index at a time (no parallel
// spend), calling onUpdate(indexId, weights, source) after each. Returns a
// stop() that halts before the next pass. Safe to Ctrl-C.
export function refreshLoop(
    indices,
    onUpdate,
    {intervalMs = 60000, timeoutMs = 45000} = {}
) {
    let stopped = false;
    let timer = null;
    const state = new Map(indices.map((i) => [i.id, {...i}]));

    async function pass() {
        for (const idx of indices) {
            if (stopped) return;
            const cur = state.get(idx.id);
            const {weights, source} = await generateWeights(cur, {timeoutMs});
            cur.weights = weights; // remember last-good for the next fallback
            if (onUpdate) onUpdate(idx.id, weights, source);
        }
        if (!stopped) timer = setTimeout(pass, intervalMs);
    }
    pass();
    return {
        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
        },
    };
}

// CLI: one pass over INDICES; with --loop, run the refresh loop.
async function main() {
    // Whole-index generation from a single prompt: --index "your prompt"
    const ixArg = process.argv.indexOf("--index");
    if (ixArg >= 0) {
        const prompt = process.argv.slice(ixArg + 1).join(" ").trim() ||
            "A balanced basket of the largest tokenized US tech equities.";
        const idx = await generateIndex(prompt);
        console.log(JSON.stringify(idx, (k, v) => (k === "raw" ? undefined : v), 2));
        return;
    }

    // Full IndexConfig generation from a single prompt: --config "your prompt"
    const cfgArg = process.argv.indexOf("--config");
    if (cfgArg >= 0) {
        const prompt = process.argv.slice(cfgArg + 1).join(" ").trim() ||
            "A quality-tilted large-cap index, rebalanced monthly.";
        const cfg = await generateConfig(prompt);
        console.log(JSON.stringify(cfg, (k, v) => (k === "raw" ? undefined : v), 2));
        return;
    }

    // RebalanceSpec generation from a single prompt: --rebalance "your prompt"
    const rbArg = process.argv.indexOf("--rebalance");
    if (rbArg >= 0) {
        const prompt = process.argv.slice(rbArg + 1).join(" ").trim() ||
            "rebalance weekly, or on 5% drift, never more than once a day";
        const rb = await generateRebalanceStrategy(prompt);
        console.log(JSON.stringify(rb, (k, v) => (k === "raw" ? undefined : v), 2));
        return;
    }

    const loop = process.argv.includes("--loop");
    const intervalMs = Number(process.env.INTERVAL_MS ?? 60000);
    if (loop) {
        console.log(`[gen] refresh loop every ${intervalMs}ms (Ctrl-C to stop)`);
        const handle = refreshLoop(
            INDICES,
            (id, w, source) =>
                console.log(`[gen] ${id} (${source}): ${JSON.stringify(w)}`),
            {intervalMs}
        );
        process.on("SIGINT", () => {
            console.log("\n[gen] stopping");
            handle.stop();
            process.exit(0);
        });
        return;
    }
    for (const idx of INDICES) {
        const {weights, source} = await generateWeights(idx);
        console.log(`[gen] ${idx.id} (${source}): ${JSON.stringify(weights)}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
