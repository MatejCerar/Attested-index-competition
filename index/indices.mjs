// Static index definitions. An index is the headline primitive: what goes
// where (weights), how (a rebalance strategy), and the natural-language prompt
// that produced it. Weights are integer percentages summing to 100 over the
// allowed ASSETS. `strategy` references a template id from strategies.mjs.
// Weights can be regenerated each minute from the prompt via generate.mjs.
import {getStrategy} from "./strategies.mjs";

export const INDICES = [
    {
        id: "blue-chip",
        name: "Blue-Chip Store of Value",
        prompt:
            "Weight the two most liquid, institutionally-held crypto assets by market dominance.",
        rationale:
            "BTC leads on dominance and custody depth; ETH adds settlement and yield. Two names, minimal noise.",
        weights: {BTC: 60, ETH: 40},
        strategy: "drift-5pct",
    },
    {
        id: "l1-index",
        name: "Smart-Contract L1 Index",
        prompt: "Build a basket of leading smart-contract layer-1s, tilted to liquidity.",
        rationale:
            "ETH as the base layer, SOL for throughput/retail flow, AVAX for subnet optionality.",
        weights: {ETH: 45, SOL: 35, AVAX: 20},
        strategy: "hourly",
    },
    {
        id: "payments",
        name: "Payments & Settlement",
        prompt: "Assets used primarily for cross-border value transfer and settlement.",
        rationale:
            "XRP is the payments primitive; FLR adds FAssets/data connectivity to the same thesis.",
        weights: {XRP: 70, FLR: 30},
        strategy: "ten-minute",
    },
    {
        id: "high-beta",
        name: "High-Beta Momentum",
        prompt: "Maximize exposure to high-volatility momentum names for a risk-on week.",
        rationale:
            "SOL and DOGE carry the most retail beta; AVAX amplifies on up-moves. High risk, high spread.",
        weights: {SOL: 40, DOGE: 40, AVAX: 20},
        strategy: "hourly-or-drift",
    },
    {
        id: "flare-native",
        name: "Flare Ecosystem",
        prompt: "Overweight Flare and its flagship FAssets collateral asset.",
        rationale:
            "FLR as the native gas/stake asset, XRP as the first FAsset (FXRP) collateral. Ecosystem-aligned.",
        weights: {FLR: 60, XRP: 40},
        strategy: "five-minute",
    },
];

export function getIndex(id) {
    const i = INDICES.find((x) => x.id === id);
    if (!i) throw new Error(`unknown index: ${id}`);
    return i;
}

// Resolve the strategy object for an index (throws on a bad reference).
export function strategyFor(index) {
    return getStrategy(index.strategy);
}
