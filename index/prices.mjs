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
// Uniswap V3 pool price source. Reads each asset's pool slot0 sqrtPriceX96 and
// converts it to a USD price, returning the SAME {getPrices(symbols)} interface
// so the rebalancer, generator and orchestrator drop it in unchanged. On
// Coston2 the pools are the deployed MockUniswapV3Pool contracts (seeded from
// the catalog); on mainnet the same reader points at real SparkDEX pools (config
// only, no code change). Assets with no pool fall back to `fallbackSource` so
// they stay buildable; each leg reports which source priced it.
//
// Uniswap V3: price(token1 per token0) = (sqrtPriceX96 / 2**96)**2 in raw token
// units. We invert to USD using the pair ordering and decimals, mirroring
// MockUniswapV3Pool.sqrtPriceX96For exactly.

const SLOT0_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
    "function assetIsToken0() view returns (bool)",
    "function assetDecimals() view returns (uint8)",
    "function stableDecimals() view returns (uint8)",
];

// sqrtPriceX96 -> USD price (number). Uses BigInt to avoid float loss, then
// converts to a JS number at the end.
export function sqrtPriceX96ToUsd(sqrtPriceX96, {assetIsToken0, assetDecimals, stableDecimals}) {
    const sp = BigInt(sqrtPriceX96);
    const ratioX192 = sp * sp; // price(token1/token0) * 2**192
    const ad = 10n ** BigInt(assetDecimals);
    const sd = 10n ** BigInt(stableDecimals);
    const E = 1_000_000_000_000_000_000n; // 1e18 for fixed-point USD
    const Q96 = 1n << 96n;
    let usdE18;
    if (assetIsToken0) {
        // usdE18 = ratioX192/2**192 * 10^ad/10^sd * 1e18
        usdE18 = ((((ratioX192 >> 96n) * ad * E) / sd) >> 96n);
    } else {
        // usdE18 = 1e18 * 10^ad/10^sd / (ratioX192/2**192)
        const lhs = (E * ad) << 96n;
        usdE18 = ((lhs / sd) << 96n) / ratioX192;
    }
    return Number(usdE18) / 1e18;
}

// Build a {SYM: poolAddress} map from an array of {sym, address} or an object.
export function poolsFor(pools) {
    if (!pools) return {};
    if (Array.isArray(pools)) {
        const out = {};
        for (const p of pools) out[p.sym] = p.address;
        return out;
    }
    return {...pools};
}

// provider: an ethers v6 provider. pools: {SYM: poolAddress}. fallbackSource:
// an object exposing getPrices(symbols) for assets without a pool (e.g. the
// stub source, or the live demo source). meta caches per-pool decimals/order.
export function createUniswapPriceSource({provider, pools, fallbackSource, Contract}) {
    const poolMap = poolsFor(pools);
    const metaCache = new Map();
    // Last known per-symbol source, so callers can report the price path.
    const lastSource = {};

    async function readMeta(addr) {
        if (metaCache.has(addr)) return metaCache.get(addr);
        const c = new Contract(addr, SLOT0_ABI, provider);
        const [assetIsToken0, assetDecimals, stableDecimals] = await Promise.all([
            c.assetIsToken0(),
            c.assetDecimals(),
            c.stableDecimals(),
        ]);
        const m = {
            contract: c,
            assetIsToken0: Boolean(assetIsToken0),
            assetDecimals: Number(assetDecimals),
            stableDecimals: Number(stableDecimals),
        };
        metaCache.set(addr, m);
        return m;
    }

    async function getPrices(symbols = ASSETS) {
        const out = {};
        const missing = [];
        for (const s of symbols) {
            const addr = poolMap[s];
            if (!addr) {
                missing.push(s);
                continue;
            }
            try {
                const m = await readMeta(addr);
                const slot0 = await m.contract.slot0();
                const sp = slot0[0] ?? slot0.sqrtPriceX96;
                out[s] = sqrtPriceX96ToUsd(sp, m);
                lastSource[s] = "uniswap";
            } catch (e) {
                missing.push(s);
            }
        }
        if (missing.length && fallbackSource) {
            const fb = await fallbackSource.getPrices(missing);
            for (const s of missing) {
                if (fb[s] != null) {
                    out[s] = fb[s];
                    lastSource[s] = "fallback";
                }
            }
        }
        return out;
    }

    return {getPrices, sources: lastSource, poolMap};
}
// ---------------------------------------------------------------------------
