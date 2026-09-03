// Static index definitions. An index is the headline primitive: what goes
// where (weights), how (a rebalance strategy), and the natural-language prompt
// that produced it. Weights are integer percentages summing to 100 over valid
// RWA catalog ids (`Ticker::issuer`). `strategy` references a template id from
// strategies.mjs. Weights can be regenerated from the prompt via generate.mjs.
// RWA-only: no crypto anywhere.
import {getStrategy} from "./strategies.mjs";

export const INDICES = [
    {
        id: "mag-7-rwa",
        name: "Big-Tech RWA",
        prompt:
            "Mega-cap US tech as tokenized equities, tilted to the largest names.",
        rationale:
            "The seven mega-cap tech leaders as tokenized equities, cap-tilted to the largest.",
        weights: {
            "NVDAx::backed-assets-je-limited": 25,
            "AAPLx::backed-assets-je-limited": 20,
            "MSFTx::backed-assets-je-limited": 20,
            "AMZNx::backed-assets-je-limited": 18,
            "GOOGLx::backed-assets-je-limited": 17,
        },
        strategy: "drift-5pct",
    },
    {
        id: "ai-semis",
        name: "AI & Semiconductors",
        prompt: "Picks-and-shovels of the AI buildout: GPU, foundry and memory names.",
        rationale:
            "GPU, foundry and memory names, overweight the compute leader.",
        weights: {
            "NVDAx::backed-assets-je-limited": 30,
            "AVGOx::backed-assets-je-limited": 18,
            "TSMx::backed-assets-je-limited": 16,
            "ASMLx::backed-assets-je-limited": 14,
            "AMDx::backed-assets-je-limited": 14,
            "MUx::backed-assets-je-limited": 8,
        },
        strategy: "hourly",
    },
    {
        id: "wall-street",
        name: "Wall Street Financials",
        prompt: "Money-center banking and card-network rails as tokenized equities.",
        rationale:
            "A money-center bank, the two card networks, and an investment bank.",
        weights: {
            "JPMx::backed-assets-je-limited": 35,
            "Vx::backed-assets-je-limited": 25,
            "MAx::backed-assets-je-limited": 25,
            "GSx::backed-assets-je-limited": 15,
        },
        strategy: "ten-minute",
    },
    {
        id: "precious-metals",
        name: "Precious Metals",
        prompt: "Tokenized precious metals as an inflation hedge, gold-heavy.",
        rationale:
            "Gold-heavy, with silver, platinum and palladium.",
        weights: {
            "XAUT0::usdt0-network-xaut0-deployments": 50,
            "SLV::robinhood-markets-inc": 25,
            "PPLTon::ondo-global-markets-bvi-limited": 15,
            "PALLx::backed-assets-je-limited": 10,
        },
        strategy: "hourly-or-drift",
    },
    {
        id: "index-funds",
        name: "Tokenized Index Funds",
        prompt: "A broad-market allocation using tokenized ETFs.",
        rationale:
            "Large-cap core, Nasdaq growth tilt, small-cap kicker.",
        weights: {
            "SPYx::backed-assets-je-limited": 50,
            "QQQx::backed-assets-je-limited": 35,
            "IWMx::backed-assets-je-limited": 15,
        },
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
