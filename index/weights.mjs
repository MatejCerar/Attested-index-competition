// Weight helpers shared by indices, generator, and rebalancer.
import {ASSETS} from "./assets.mjs";

// Put any rounding remainder on the largest weight so the total lands exactly.
function fixRemainder(obj, total) {
    const syms = Object.keys(obj);
    if (syms.length === 0) return obj;
    let sum = syms.reduce((a, s) => a + obj[s], 0);
    if (sum === total) return obj;
    const largest = syms.reduce((a, s) => (obj[s] > obj[a] ? s : a), syms[0]);
    obj[largest] += total - sum;
    if (obj[largest] < 0) obj[largest] = 0;
    return obj;
}

// Raw pct map -> integer pct summing to 100 over allowed assets only.
export function normalizeWeights(raw, allowed = ASSETS) {
    const clean = {};
    for (const [s, v] of Object.entries(raw || {})) {
        const sym = String(s).toUpperCase();
        const n = Number(v);
        if (!allowed.includes(sym)) continue;
        if (!Number.isFinite(n) || n <= 0) continue;
        clean[sym] = (clean[sym] || 0) + n;
    }
    const total = Object.values(clean).reduce((a, v) => a + v, 0);
    if (total <= 0) return null;
    const out = {};
    for (const [s, v] of Object.entries(clean)) {
        out[s] = Math.round((v / total) * 100);
    }
    // drop any that rounded to 0, then fix remainder to exactly 100
    for (const s of Object.keys(out)) if (out[s] <= 0) delete out[s];
    if (Object.keys(out).length === 0) return null;
    return fixRemainder(out, 100);
}

// Integer pct map (sum 100) -> bps map (sum 10000).
export function weightsToBps(weightsPct) {
    const out = {};
    for (const [s, v] of Object.entries(weightsPct)) out[s] = Math.round(v * 100);
    return fixRemainder(out, 10000);
}
