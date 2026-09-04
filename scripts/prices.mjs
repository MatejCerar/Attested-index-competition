// Live price sources for the real competition. RWA legs (tokenized equities,
// ETFs, metals) are mapped to their underlying real-world symbol and priced on
// Yahoo Finance; crypto legs price on Binance. Only relative moves matter for
// the competition, so a live baseline is taken at t0 and NAV tracked per tick.

// Strip tokenization affixes to the bare underlying ticker: AAPLx -> AAPL,
// COSTon -> COST, bTSLA -> TSLA.
const OVERRIDE_BARE = {XAUT0: "GOLD", PAXG: "GOLD"};
export function bareTicker(asset) {
    if (OVERRIDE_BARE[asset.ticker]) return OVERRIDE_BARE[asset.ticker];
    let t = asset.ticker;
    t = t.replace(/on$/, "");             // Ondo suffix
    t = t.replace(/x$/, "");              // Backed/xStocks suffix
    t = t.replace(/^b(?=[A-Z]{2,})/, ""); // Backed prefix
    t = t.replace(/^wt/, "");             // wrapped prefix
    return t.toUpperCase();
}

// Yahoo symbol: metals route to futures (they trade ~24/5, unlike cash
// equities); everything else is the bare ticker.
const Y_METAL = {XAU: "GC=F", XAG: "SI=F", XPT: "PL=F", XPD: "PA=F"};
export function underlyingSymbol(asset) {
    if (asset.ftso && Y_METAL[asset.ftso]) return Y_METAL[asset.ftso];
    return bareTicker(asset);
}

// Hyperliquid HIP-3 market name for a catalog asset. Metals are named in full
// on the xyz dex; everything else is the bare ticker.
const HL_METAL = {XAU: "GOLD", XAG: "SILVER", XPT: "PLATINUM", XPD: "PALLADIUM"};
export function hlSymbol(asset) {
    if (asset.ftso && HL_METAL[asset.ftso]) return HL_METAL[asset.ftso];
    return bareTicker(asset);
}

// Live oracle prices from Hyperliquid mainnet: the core perp dex (crypto) plus
// every HIP-3 builder dex (stocks, commodities, metals). Returns {SYMBOL:
// price} keyed by bare market name (dex prefix like "xyz:" stripped). This is
// the exact venue oracle an index would trade against. The dex list is fetched
// once and cached; oracle prices are re-read each call.
const HL_API = "https://api.hyperliquid.xyz/info";
const hlPost = (body) =>
    fetch(HL_API, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).then((r) => r.json());
let hlDexes = null;
export async function fetchHyperliquid() {
    if (!hlDexes) {
        const dexs = await hlPost({type: "perpDexs"});
        hlDexes = [undefined, ...dexs.filter(Boolean).map((d) => d.name)]; // undefined = core crypto dex
    }
    const out = {};
    await Promise.all(hlDexes.map(async (dex) => {
        try {
            const [meta, ctxs] = await hlPost(dex ? {type: "metaAndAssetCtxs", dex} : {type: "metaAndAssetCtxs"});
            meta.universe.forEach((u, i) => {
                const name = u.name.replace(/^[^:]+:/, "");
                const p = ctxs[i] && Number(ctxs[i].oraclePx ?? ctxs[i].markPx);
                if (p > 0 && !(name in out)) out[name] = p;
            });
        } catch { /* skip dex on error */ }
    }));
    return out;
}

// Batch-fetch spot prices from Yahoo v8 chart (no key). Returns {symbol: price}.
// Tolerant: a symbol that fails is simply omitted.
export async function fetchYahoo(symbols) {
    const uniq = [...new Set(symbols)];
    const out = {};
    await Promise.all(uniq.map(async (sym) => {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`;
            const r = await fetch(url, {headers: {"User-Agent": "Mozilla/5.0"}});
            if (!r.ok) return;
            const j = await r.json();
            const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (typeof p === "number" && p > 0) out[sym] = p;
        } catch { /* omit */ }
    }));
    return out;
}

// Crypto spot from Binance (USDT pairs). Returns {SYM: price}. FLR is not on
// Binance; callers fall back to CoinGecko for it.
export async function fetchBinance(symbols) {
    const out = {};
    await Promise.all(symbols.map(async (s) => {
        try {
            const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}USDT`);
            if (!r.ok) return;
            const j = await r.json();
            const p = Number(j.price);
            if (p > 0) out[s] = p;
        } catch { /* omit */ }
    }));
    return out;
}

// Crypto spot from CoinGecko (one batched call, no key). Covers FLR.
const CG_ID = {
    BTC: "bitcoin", ETH: "ethereum", XRP: "ripple", SOL: "solana",
    AVAX: "avalanche-2", DOGE: "dogecoin", FLR: "flare-networks",
};
export async function fetchCoingecko(symbols) {
    const ids = symbols.map((s) => CG_ID[s]).filter(Boolean);
    const out = {};
    if (!ids.length) return out;
    try {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`);
        if (!r.ok) return out;
        const j = await r.json();
        for (const s of symbols) { const p = j[CG_ID[s]]?.usd; if (p > 0) out[s] = p; }
    } catch { /* omit */ }
    return out;
}
