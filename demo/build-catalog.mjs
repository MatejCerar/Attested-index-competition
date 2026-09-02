// Turn rwa-database.txt into the selectable asset universe for the builder.
// Identity rule (user's): an instrument is unique by (Ticker, Issuer). Same
// ticker + same issuer across many chains/venues collapses to one asset; a
// different issuer for the same ticker is a different, separately-selectable
// asset. Price is underlying-level in the DB, so an instrument with no own
// price inherits any price found on the same Canonical Underlying.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "rwa-database.txt");
const OUT = join(__dirname, "frontend", "catalog.js");

const money = (s) => {
    if (!s) return null;
    const n = Number(s.replace(/[$,]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
};
const pretty = (s) =>
    (s || "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bInc\b/, "Inc")
        .trim();

// FTSO feed symbols the enclave can try to read live. orchestrate.mjs probes
// each one and silently falls back to the CSV snapshot if the feed is not on
// FTSO, so this list can be optimistic. Mostly metals + forex here, since the
// RWA universe is equities/ETFs/metals/perps.
// USD/oz snapshot fallback for the metals we tag as FTSO feeds, so an FTSO
// asset is still scorable if the live feed is not on the target chain. Values
// are the modal spot cluster from the DB itself.
const METAL_SPOT = {XAU: 4439, XAG: 66.9, XPT: 1803, XPD: 1385};
const ftsoFor = (underlying, assetClass) => {
    const u = underlying.toLowerCase();
    if (assetClass === "precious-metals") {
        if (u.includes("gold")) return "XAU";
        if (u.includes("silver")) return "XAG";
        if (u.includes("platinum")) return "XPT";
        if (u.includes("palladium")) return "XPD";
    }
    return null;
};

const txt = readFileSync(SRC, "utf8").replace(/\r/g, "");
const lines = txt.split("\n").filter((l) => l.length);
const hdr = lines[0].split("\t").map((s) => s.trim());
const col = Object.fromEntries(hdr.map((h, i) => [h, i]));
const get = (c, name) => (c[col[name]] || "").trim();

// Pass 1: underlying -> any known price (price is quoted per underlying). Key
// on a normalized underlying so title-case perp rows ("Apple Inc.") and
// kebab-case spot rows ("apple-inc") share one price.
const normUL = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const ulPrice = new Map();
const parsed = lines.slice(1).map((l) => l.split("\t"));
for (const c of parsed) {
    const ul = normUL(get(c, "Canonical Underlying"));
    const p = money(get(c, "Price (USD)"));
    if (p && !ulPrice.has(ul)) ulPrice.set(ul, p);
}

// Pass 2: collapse rows to unique (Ticker, Issuer).
const byId = new Map();
for (const c of parsed) {
    if (get(c, "Status") !== "Live") continue; // only live instruments
    const ticker = get(c, "Ticker");
    const issuer = get(c, "Issuer");
    if (!ticker || !issuer) continue;
    const id = `${ticker}::${issuer}`;
    const underlying = get(c, "Canonical Underlying");
    const assetClass = get(c, "Asset Class");
    let e = byId.get(id);
    if (!e) {
        e = {
            id,
            ticker,
            issuer,
            issuerName: pretty(issuer),
            underlying,
            name: pretty(underlying),
            assetClass,
            spotPerp: get(c, "Spot/Perp"),
            access: get(c, "Access Model"),
            marketSymbol: get(c, "Market Symbol"),
            marketUrl: get(c, "Market URL"),
            venues: new Set(),
            chains: new Set(),
            priceUsd: null,
            priceExact: false,
            vol24: 0,
            ftso: ftsoFor(underlying, assetClass),
        };
        byId.set(id, e);
    }
    const v = get(c, "Venue");
    const ch = get(c, "Chain");
    if (v) e.venues.add(v);
    if (ch) e.chains.add(ch);
    const own = money(get(c, "Price (USD)"));
    if (own) {
        e.priceUsd = own;
        e.priceExact = true;
    }
    const vol = money(get(c, "24h Volume (USD)"));
    if (vol && vol > e.vol24) e.vol24 = vol;
}

// Fill price from the underlying-level fallback; mark whether it is priceable.
const assets = [...byId.values()].map((e) => {
    if (!e.priceUsd && ulPrice.has(normUL(e.underlying))) {
        e.priceUsd = ulPrice.get(normUL(e.underlying));
        e.priceExact = false;
    }
    if (!e.priceUsd && e.ftso && METAL_SPOT[e.ftso]) {
        e.priceUsd = METAL_SPOT[e.ftso];
        e.priceExact = false;
    }
    return {
        id: e.id,
        ticker: e.ticker,
        issuer: e.issuer,
        issuerName: e.issuerName,
        name: e.name,
        assetClass: e.assetClass,
        spotPerp: e.spotPerp,
        access: e.access,
        venues: [...e.venues],
        chains: [...e.chains].length,
        chainList: [...e.chains],
        marketUrl: e.marketUrl,
        priceUsd: e.priceUsd,
        priceExact: e.priceExact,
        ftso: e.ftso,
        // an asset is scorable if we can price it live (ftso) or from the CSV
        priceSource: e.ftso ? "ftso" : e.priceUsd ? "csv" : null,
        vol24: e.vol24 || null,
    };
});

// Sort: priceable first, then by 24h volume, then name.
assets.sort(
    (a, b) =>
        Number(!!b.priceSource) - Number(!!a.priceSource) ||
        (b.vol24 || 0) - (a.vol24 || 0) ||
        a.name.localeCompare(b.name)
);

const classes = [...new Set(assets.map((a) => a.assetClass))].sort();
const priceable = assets.filter((a) => a.priceSource).length;
const out = {
    generatedAt: new Date().toISOString(),
    source: "rwa-database.txt",
    total: assets.length,
    priceable,
    ftsoCount: assets.filter((a) => a.priceSource === "ftso").length,
    classes,
    assets,
};
const json = JSON.stringify(out);
writeFileSync(OUT, "window.CATALOG = " + json + ";\n"); // browser (script include)
writeFileSync(join(__dirname, "catalog.json"), json); // node (orchestrate)
console.log(
    `catalog: ${assets.length} unique (ticker,issuer) instruments, ` +
        `${priceable} priceable (${out.ftsoCount} via FTSO, ${priceable - out.ftsoCount} via CSV), ` +
        `${classes.length} asset classes -> ${OUT}`
);
