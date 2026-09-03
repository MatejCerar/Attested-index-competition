// Price source abstraction. The only contract callers depend on is
// getPrices(symbols) -> {SYM: usdNumber}. For now this is a deterministic,
// offline-friendly stub seeded from a static map. A Uniswap V3 pool TWAP reader
// drops in during phase 2 (see the seam at the bottom) without touching callers.
import {ASSETS} from "./assets.mjs";

// Static USD seed. Deterministic so DRY runs and tests are reproducible.
export const STUB_PRICES = {
    BTC: 76769.05,
    ETH: 2384.558,
    XRP: 1.330262,
    SOL: 99.0116,
    AVAX: 7.14331,
    DOGE: 0.081039,
    FLR: 0.00657099,
};

export function getPricesSync(symbols = ASSETS) {
    const out = {};
    for (const s of symbols) {
        if (STUB_PRICES[s] == null) throw new Error(`no stub price for ${s}`);
        out[s] = STUB_PRICES[s];
    }
    return out;
}

// Async to match the future pool reader shape. The stub resolves the seed.
export async function getPrices(symbols = ASSETS) {
    return getPricesSync(symbols);
}

// The default source used across the repo. Swap this factory for the Uniswap
// one below in phase 2 and every caller keeps working.
export function createStubPriceSource() {
    return {getPrices, getPricesSync};
}

// ---------------------------------------------------------------------------
// PHASE 2 SEAM (deferred, do not build now): Uniswap V3 TWAP price source.
// A pool reader would return the SAME {getPrices(symbols)} interface by reading
// each asset's V3 pool via slot0/observe, converting the TWAP tick to a USD
// price (quote token = the same stablecoin the vault holds). Callers depend
// only on getPrices(symbols) -> {SYM: number}, so this drops in unchanged.
//
// export function createUniswapPriceSource({provider, pools}) {
//   // pools: { SYM: {address, quoteIsToken0, secondsAgo} }
//   return {
//     async getPrices(symbols) {
//       throw new Error("uniswap price source not implemented (phase 2)");
//     },
//   };
// }
// ---------------------------------------------------------------------------
