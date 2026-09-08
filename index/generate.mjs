// AI index generation via Claude Code headless. Each index restates its
// weights from its natural-language prompt using the cheapest model. Verified
// invocation in this environment: prompt on STDIN (the variadic tool flags eat
// a prompt arg otherwise), tools disabled so the model answers from its own
// knowledge instead of trying to fetch. On any failure it falls back to the
// index's last-good weights and logs that live-gen is unavailable.
import {spawn} from "node:child_process";
import {INDICES} from "./indices.mjs";
import {STRATEGIES} from "./strategies.mjs";
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
async function runClaudeApi(prompt, timeoutMs) {
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
// to the local `claude` CLI (dev machines with an interactive login).
function callModel(prompt, timeoutMs) {
    return process.env.ANTHROPIC_API_KEY
        ? runClaudeApi(prompt, timeoutMs)
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
