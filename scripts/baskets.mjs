// Five competing indices, each an "AI recipe": a natural-language prompt plus
// the weights the model produced for it. Weights are percentages summing to
// 100 over the asset symbols below. FTSO provides live USD prices for scoring.

export const ASSETS = ["FLR", "BTC", "ETH", "XRP", "SOL", "AVAX", "DOGE"];

export const BASKETS = [
    {
        id: "blue-chip",
        name: "Blue-Chip Store of Value",
        prompt:
            "Weight the two most liquid, institutionally-held crypto assets by market dominance.",
        rationale:
            "BTC leads on dominance and custody depth; ETH adds settlement and yield. Two names, minimal noise.",
        weights: {BTC: 60, ETH: 40},
    },
    {
        id: "l1-index",
        name: "Smart-Contract L1 Index",
        prompt: "Build a basket of leading smart-contract layer-1s, tilted to liquidity.",
        rationale:
            "ETH as the base layer, SOL for throughput/retail flow, AVAX for subnet optionality.",
        weights: {ETH: 45, SOL: 35, AVAX: 20},
    },
    {
        id: "payments",
        name: "Payments & Settlement",
        prompt: "Assets used primarily for cross-border value transfer and settlement.",
        rationale:
            "XRP is the payments primitive; FLR adds FAssets/data connectivity to the same thesis.",
        weights: {XRP: 70, FLR: 30},
    },
    {
        id: "high-beta",
        name: "High-Beta Momentum",
        prompt: "Maximize exposure to high-volatility momentum names for a risk-on week.",
        rationale:
            "SOL and DOGE carry the most retail beta; AVAX amplifies on up-moves. High risk, high spread.",
        weights: {SOL: 40, DOGE: 40, AVAX: 20},
    },
    {
        id: "flare-native",
        name: "Flare Ecosystem",
        prompt: "Overweight Flare and its flagship FAssets collateral asset.",
        rationale:
            "FLR as the native gas/stake asset, XRP as the first FAsset (FXRP) collateral. Ecosystem-aligned.",
        weights: {FLR: 60, XRP: 40},
    },
];
