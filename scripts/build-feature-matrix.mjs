// Regenerates index/data/feature-matrix.csv from scripts/catalog.json.
//
// Universe: every catalog asset in the equity-side classes (public equities,
// equity ETFs/indices, precious/industrial metals; NO perps, NO crypto, NO
// forex), deduped to ONE row per bareTicker - the exact key
// scripts/live-engine.mjs assetForTicker uses - and kept only when some
// priceable (priceUsd > 0) catalog asset carries that bare ticker, so every
// matrix row resolves to a live-priceable asset. Issuer affix variants the
// bareTicker regexes cannot strip (RAAPL, SAMZN, GOOGLB, ...) are therefore
// separate rows by design: each is its own resolvable, priceable key.
//
// The ORIGINAL 12 hand-curated rows are preserved verbatim (read back from the
// current csv, never re-synthesized). Every other row gets a real GICS sector
// (name-override + keyword map over the representative company name) and
// DETERMINISTIC SYNTHETIC fundamentals: tickers and sectors are real, the
// non-sector fundamentals of the expanded universe are deterministic synthetic
// demo values seeded by a stable hash of ticker|field, drawn from realistic
// sector-biased ranges (market cap additionally biased larger for higher
// catalog vol24). Rerunning this script is idempotent.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {bareTicker} from "./prices.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dirname, "catalog.json");
const MATRIX_PATH = join(__dirname, "..", "index", "data", "feature-matrix.csv");

const HEADER =
    "ticker,market_cap_usd,pe_forward,ev_ebitda,fcf_yield,dividend_yield," +
    "revenue_growth_yoy,gross_margin,return_on_equity,net_debt_to_ebitda," +
    "momentum_12m,volatility_90d,moat_strength,management_quality,ai_exposure," +
    "regulatory_risk,esg_controversy,demand_durability,sector,market_cap_tier," +
    "competitive_position";

// The 12 original hand-curated rows: preserved verbatim from the current csv.
const REAL_TICKERS = [
    "NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "LLY",
    "JPM", "V", "AVGO", "COST", "XOM", "PLTR",
];

const CLASSES = new Set([
    "public-equities", "equity", "equity-etfs", "etf",
    "equity-indices", "index", "precious-metals", "industrial-metals",
]);

// -- sector labeling (the 11 GICS labels index/generate.mjs exposes) ---------

// Name overrides (lowercased company name) for names the keyword map would
// misplace. Keyed by name, not ticker, so every issuer affix variant of the
// same company lands in the same sector.
const NAME_OVERRIDE = {
    "constellation energy corporation": "utilities",
    "vistra corp": "utilities",
    "xcel energy inc": "utilities",
    "vaneck uranium and nuclear etf": "utilities",
    "bloom energy corporation": "industrials",
    "fluence energy inc": "industrials",
    "ge vernova inc": "industrials",
    "uber technologies inc": "industrials",
    "axon enterprise inc": "industrials",
    "ondas inc": "industrials",
    "space exploration technologies corp": "industrials",
    "zoom communications inc": "information_technology",
    "applied materials inc": "information_technology",
    "mara holdings inc": "information_technology",
    "riot platforms inc": "information_technology",
    "cleanspark inc": "information_technology",
    "iren limited": "information_technology",
    "coreweave inc": "information_technology",
    "nebius group n v": "information_technology",
    "penguin solutions inc": "information_technology",
    "take two interactive software inc": "communication_services",
    "strategy inc": "financials",
    "strategy inc strc stretch preferred stock": "financials",
    "sharplink inc": "financials",
    "hyperliquid strategies inc": "financials",
    "galaxy digital inc": "financials",
    "sofi technologies inc": "financials",
    "futu holdings limited": "financials",
    "mercadolibre inc": "consumer_discretionary",
    "airbnb inc": "consumer_discretionary",
};

// Keyword map over the lowercased company name; first hit wins.
const NAME_SECTOR = [
    [/pharma|therapeutic|biotech|biosci|genetic|health|medic|surgical|lilly|pfizer|merck|abbvie|amgen|novartis|novo nordisk|moderna|regeneron|vertex/, "health_care"],
    [/gold|silver|platinum|palladium|uranium|rare earth|steel|mining|miners|metal|linde|chemical|materials/, "materials"],
    [/semiconductor|memory etf|robotics|software|cloud|cyber|data|digital|computing|computer|technolog|electronic|optoelectronic|photonics|micro device|apple inc|microsoft|business machines|intel|nvidia|broadcom|qualcomm|micron|oracle|cisco|dell|ibm|nokia|hynix|sandisk|seagate|corning|palantir|snowflake|salesforce|autodesk|synopsys|servicenow|applovin|arm holdings|asml|lam research|kla corp|teradyne|cloudflare|shopify|crowdstrike|cerebras|coherent|lumentum|ciena|credo|globalfoundries|axt inc|blackberry|rigetti|robostrategy|sharonai/, "information_technology"],
    [/internet etf|meta platforms|alphabet|netflix|disney|t mobile|snap inc|reddit|take two|interactive|telecom|communications|spacemobile|media/, "communication_services"],
    [/bank|financial|capital|insurance|jpmorgan|goldman|morgan stanley|visa|mastercard|paypal|coinbase|circle|robinhood markets|blackstone|exchange|s p 500|russell|invesco|ishares msci|spdr s p/, "financials"],
    [/oil|petroleum|gas |exxon|chevron|diamondback|energy select|energy inc|energy corp/, "energy"],
    [/walmart|costco|coca cola|procter|pepsi|staples|grocery|beverage/, "consumer_staples"],
    [/defense|aerospace|boeing|caterpillar|honeywell|lockheed|rtx corp|raytheon|rocket|airline|rail|industrial/, "industrials"],
    [/utility|utilities|electric power/, "utilities"],
    [/real estate|reit|properties/, "real_estate"],
    [/tesla|amazon|home depot|mcdonald|nike|starbucks|gamestop|alibaba|pdd holdings|rivian|retail|restaurant|apparel|automotive/, "consumer_discretionary"],
];

const UNMATCHED = [];
function sectorFor(ticker, name, assetClass) {
    const n = name.toLowerCase().trim();
    if (NAME_OVERRIDE[n]) return NAME_OVERRIDE[n];
    if (assetClass === "precious-metals" || assetClass === "industrial-metals")
        return "materials";
    for (const [re, s] of NAME_SECTOR) if (re.test(n)) return s;
    UNMATCHED.push(`${ticker} (${name})`);
    return "industrials";
}

// -- deterministic synthetic fundamentals ------------------------------------

// FNV-1a over "ticker|field" -> uniform [0,1). Stable across runs/platforms.
function rnd(ticker, field) {
    let h = 0x811c9dc5;
    const s = `${ticker}|${field}`;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 4294967296;
}
const inRange = (t, f, lo, hi) => lo + rnd(t, f) * (hi - lo);
const pick = (t, f, xs) => xs[Math.floor(rnd(t, f) * xs.length)];
const score = (t, f, lo, hi) => Math.round(inRange(t, f, lo, hi));

// Per-sector [lo, hi] biases; anything unlisted uses base.
const BASE = {
    pe: [12, 32], ev: [8, 20], fcf: [0.02, 0.07], div: [0.005, 0.025],
    growth: [0.0, 0.18], margin: [0.3, 0.6], roe: [0.08, 0.3],
    debt: [0.2, 2.5], mom: [-0.2, 0.45], vol: [0.2, 0.45],
    ai: [0, 3], reg: [1, 3], esg: [0, 3], durable: [2, 4],
};
const SECTOR_BIAS = {
    information_technology: {pe: [22, 55], ev: [15, 40], fcf: [0.01, 0.05], div: [0, 0.008], growth: [0.08, 0.45], margin: [0.45, 0.85], roe: [0.1, 0.45], debt: [-0.5, 1.2], mom: [-0.1, 0.6], vol: [0.28, 0.6], ai: [3, 5], durable: [3, 5]},
    communication_services: {pe: [16, 35], growth: [0.05, 0.3], margin: [0.4, 0.75], ai: [2, 5]},
    health_care: {pe: [15, 40], ev: [12, 30], growth: [0.03, 0.28], margin: [0.5, 0.85], reg: [2, 5], durable: [3, 5]},
    financials: {pe: [9, 20], ev: [8, 14], fcf: [0.04, 0.09], div: [0.015, 0.035], growth: [0.0, 0.12], margin: [0.4, 0.7], debt: [0.8, 2.5], reg: [3, 5]},
    energy: {pe: [8, 16], ev: [4, 8], fcf: [0.05, 0.1], div: [0.025, 0.05], growth: [-0.1, 0.1], margin: [0.2, 0.4], debt: [0.4, 2.0], reg: [2, 5], esg: [2, 5], durable: [1, 3], vol: [0.2, 0.35]},
    consumer_staples: {pe: [14, 26], div: [0.02, 0.04], growth: [0.01, 0.08], margin: [0.1, 0.35], vol: [0.12, 0.25], durable: [4, 5], reg: [0, 2]},
    consumer_discretionary: {pe: [15, 40], growth: [0.02, 0.25], margin: [0.25, 0.5], vol: [0.25, 0.5]},
    industrials: {pe: [14, 28], div: [0.01, 0.03], growth: [0.02, 0.15], margin: [0.2, 0.4]},
    materials: {pe: [10, 22], ev: [6, 12], div: [0.01, 0.035], growth: [-0.05, 0.12], margin: [0.2, 0.45], vol: [0.18, 0.4], esg: [1, 4], ai: [0, 2]},
    utilities: {pe: [13, 20], div: [0.03, 0.05], growth: [0.0, 0.06], margin: [0.3, 0.5], debt: [2.0, 4.5], vol: [0.12, 0.22], durable: [4, 5], reg: [2, 4], ai: [0, 2]},
    real_estate: {pe: [12, 24], div: [0.03, 0.055], growth: [0.0, 0.08], debt: [3.0, 5.5], durable: [3, 5]},
};

const fx = (n, d) => Number(n.toFixed(d)).toString();

function synthRow(ticker, sector, vol24) {
    const b = {...BASE, ...(SECTOR_BIAS[sector] || {})};
    const r = (f, [lo, hi]) => inRange(ticker, f, lo, hi);
    // Log-uniform market cap ~3B..2.5T; a higher catalog vol24 lifts the floor
    // so heavily traded names skew large/mega. Deterministic given the catalog.
    const boost = vol24 > 0 ? Math.min(1, Math.log10(vol24) / 9) : 0;
    const loCap = Math.log(3e9) + boost * (Math.log(2e11) - Math.log(3e9));
    const cap = Math.round(Math.exp(r("cap", [loCap, Math.log(2.5e12)])) / 1e9) * 1e9;
    const tier = cap >= 2e11 ? "mega" : cap >= 1e10 ? "large" : cap >= 2e9 ? "mid" : "small";
    return [
        ticker,
        String(cap),
        fx(r("pe", b.pe), 1),
        fx(r("ev", b.ev), 1),
        fx(r("fcf", b.fcf), 3),
        fx(r("div", b.div), 3),
        fx(r("growth", b.growth), 2),
        fx(r("margin", b.margin), 2),
        fx(r("roe", b.roe), 2),
        fx(r("debt", b.debt), 2),
        fx(r("mom", b.mom), 2),
        fx(r("vol", b.vol), 2),
        String(score(ticker, "moat", 2, 5)),
        String(score(ticker, "mgmt", 2, 5)),
        String(score(ticker, "ai", ...b.ai)),
        String(score(ticker, "reg", ...b.reg)),
        String(score(ticker, "esg", ...b.esg)),
        String(score(ticker, "durable", ...b.durable)),
        sector,
        tier,
        pick(ticker, "pos", ["leader", "challenger", "follower", "niche"]),
    ].join(",");
}

// -- universe selection -------------------------------------------------------

function main() {
    const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
    // Resolvable = bare tickers assetForTicker can price (any priceable asset).
    const resolvable = new Set(
        catalog.assets.filter((a) => a.priceUsd > 0).map(bareTicker)
    );
    // One representative asset per bare ticker over the equity universe:
    // prefer priceable, then the highest catalog vol24, then id (determinism).
    const better = (a, b) =>
        (a.priceUsd > 0) - (b.priceUsd > 0) ||
        (a.vol24 || 0) - (b.vol24 || 0) ||
        b.id.localeCompare(a.id);
    const rep = new Map();
    for (const a of catalog.assets) {
        if (!CLASSES.has(a.assetClass)) continue;
        const t = bareTicker(a);
        if (!resolvable.has(t)) continue;
        // csv/bytes32-safe symbols only (parseCsv has no quoting; ids <= 31 B).
        if (!/^[A-Z0-9.\-]{1,31}$/.test(t)) continue;
        const cur = rep.get(t);
        if (!cur || better(a, cur) > 0) rep.set(t, a);
    }
    const synthTickers = [...rep.keys()]
        .filter((t) => !REAL_TICKERS.includes(t))
        .sort();

    // Preserve the 12 original rows verbatim from the current csv.
    const current = readFileSync(MATRIX_PATH, "utf8").split(/\r?\n/).filter(Boolean);
    const byTicker = new Map(current.slice(1).map((l) => [l.split(",")[0], l]));
    const realRows = REAL_TICKERS.map((t) => {
        const row = byTicker.get(t);
        if (!row) throw new Error(`preserved row ${t} missing from current matrix`);
        return row;
    });

    const synthRows = synthTickers.map((t) => {
        const a = rep.get(t);
        return synthRow(t, sectorFor(t, a.name, a.assetClass), a.vol24);
    });
    const lines = [HEADER, ...realRows, ...synthRows];
    writeFileSync(MATRIX_PATH, lines.join("\n") + "\n");

    const dist = {};
    for (const l of lines.slice(1)) {
        const s = l.split(",")[18];
        dist[s] = (dist[s] || 0) + 1;
    }
    console.log(`wrote ${lines.length - 1} rows (${realRows.length} preserved, ${synthRows.length} synthetic) to ${MATRIX_PATH}`);
    console.log("sector distribution:", JSON.stringify(dist, null, 0));
    if (UNMATCHED.length)
        console.log(`unmatched -> industrials default (${UNMATCHED.length}):`, UNMATCHED.join(", "));
}

main();
