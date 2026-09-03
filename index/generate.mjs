// AI index generation via Claude Code headless. Each index restates its
// weights from its natural-language prompt using the cheapest model. Verified
// invocation in this environment: prompt on STDIN (the variadic tool flags eat
// a prompt arg otherwise), tools disabled so the model answers from its own
// knowledge instead of trying to fetch. On any failure it falls back to the
// index's last-good weights and logs that live-gen is unavailable.
import {spawn} from "node:child_process";
import {ASSETS} from "./assets.mjs";
import {INDICES} from "./indices.mjs";
import {normalizeWeights} from "./weights.mjs";

const MODEL = "claude-haiku-4-5-20251001";
const DISALLOWED = ["WebFetch", "WebSearch", "Bash"];

function buildPrompt(indexPrompt) {
    return (
        `${indexPrompt} Based only on your own knowledge, return ONLY compact ` +
        `JSON {"weights":{SYM:pct,...}} with pct integers summing to 100 over ` +
        `exactly these allowed assets: [${ASSETS.join(",")}]. No prose.`
    );
}

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

// Generate fresh weights for one index. Never throws.
export async function generateWeights(index, {timeoutMs = 45000} = {}) {
    const res = await runClaude(buildPrompt(index.prompt), timeoutMs);
    if (!res.ok) {
        console.error(
            `[gen] ${index.id}: live-gen unavailable (${res.err}), using fallback`
        );
        return {weights: index.weights, source: "fallback"};
    }
    const parsed = extractJson(res.out);
    const norm = parsed && normalizeWeights(parsed.weights, ASSETS);
    if (!norm) {
        console.error(
            `[gen] ${index.id}: unparseable/empty weights, using fallback`
        );
        return {weights: index.weights, source: "fallback", raw: res.out.trim()};
    }
    return {weights: norm, source: "live", raw: res.out.trim()};
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
