// The ATTESTED house indices: each one is a CONFIG over the frozen feature
// matrix (deterministic-index/example_data/feature_matrix_v1.csv), never a
// hand-picked weights map. Weights come exclusively from the deterministic
// build (index/build-index.mjs -> tee-extension/extension/build-index.ts), so
// the enclave INDEX/REBALANCE gate reproduces and signs them. The freeform
// catalog builder stays the off-chain playground; it never enters this path.
//
// Config shape mirrors deterministic-index/config.yaml field for field.
import {getStrategy} from "./strategies.mjs";

const BASE = {
    version: 3,
    normalization: "zscore",
    winsor: 0.05,
    weighting: "score_tilt",
    eligible_sectors: [],
    min_market_cap_usd: 50000000000,
    id_col: "ticker",
    sector_col: "sector",
    market_cap_col: "market_cap_usd",
};

export const ATTESTED_INDICES = [
    {
        id: "attested-quality",
        name: "Quality Large Caps",
        prompt: "Quality-tilted large caps: profitability, margins, moat, low leverage.",
        strategy: "thirty-minute-or-drift-5",
        config: {
            ...BASE,
            weights: {
                return_on_equity: 0.3,
                gross_margin: 0.2,
                net_debt_to_ebitda: -0.2,
                moat_strength: 0.2,
                management_quality: 0.1,
            },
            top_n: 8,
            max_weight: 0.2,
            sector_cap: 0.4,
        },
    },
    {
        id: "attested-ai-leaders",
        name: "AI Leaders",
        prompt: "AI exposure inside tech and communication services, growth and momentum tilted.",
        strategy: "minute",
        config: {
            ...BASE,
            weights: {
                ai_exposure: 0.4,
                revenue_growth_yoy: 0.25,
                momentum_12m: 0.2,
                moat_strength: 0.15,
            },
            eligible_sectors: ["information_technology", "communication_services"],
            top_n: 5,
            max_weight: 0.35,
            sector_cap: 1.0,
        },
    },
    {
        id: "attested-value",
        name: "Value",
        prompt: "Cheap cash flows: low multiples, high FCF and dividend yield.",
        strategy: "ten-minute-or-drift-2",
        config: {
            ...BASE,
            weights: {
                pe_forward: -0.3,
                ev_ebitda: -0.25,
                fcf_yield: 0.3,
                dividend_yield: 0.15,
            },
            top_n: 6,
            max_weight: 0.3,
            sector_cap: 0.6,
        },
    },
    {
        id: "attested-low-vol",
        name: "Low Volatility",
        prompt: "Defensive sleeve: low volatility, durable demand, clean balance sheets.",
        strategy: "hourly-or-drift-5",
        config: {
            ...BASE,
            weights: {
                volatility_90d: -0.4,
                demand_durability: 0.25,
                net_debt_to_ebitda: -0.15,
                dividend_yield: 0.1,
                esg_controversy: -0.1,
            },
            top_n: 6,
            max_weight: 0.25,
            sector_cap: 0.5,
        },
    },
    {
        id: "attested-momentum",
        name: "Momentum",
        prompt: "12-month winners with growth support, rank-normalized.",
        strategy: "drift-5",
        config: {
            ...BASE,
            weights: {
                momentum_12m: 0.5,
                revenue_growth_yoy: 0.3,
                volatility_90d: -0.2,
            },
            normalization: "rank",
            top_n: 6,
            max_weight: 0.3,
            sector_cap: 0.6,
        },
    },
];

export function getAttestedIndex(id) {
    const i = ATTESTED_INDICES.find((x) => x.id === id);
    if (!i) throw new Error(`unknown attested index: ${id}`);
    return i;
}

// Resolve the strategy object (throws on a bad reference).
export function strategyForAttested(index) {
    return getStrategy(index.strategy);
}
