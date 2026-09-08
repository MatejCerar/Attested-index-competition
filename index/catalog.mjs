// Loads the derived RWA catalog (scripts/catalog.json) and exposes the
// selectable universe used by the whole-index generator and the app. This board
// is RWA-only: an index may only pick ids that exist in the RWA catalog. Ids are
// `Ticker::issuer`. No crypto is ever part of the universe.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(__dirname, "..", "scripts", "catalog.json");

let _catalog = null;
export function loadCatalog() {
    if (_catalog) return _catalog;
    _catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    return _catalog;
}

// Every selectable instrument: priceable RWA catalog rows only.
export function selectableAssets() {
    const cat = loadCatalog();
    const rwa = cat.assets.filter((a) => a.priceSource); // priceable only
    return rwa.map((a) => ({...a, kind: "rwa"}));
}

// Fast lookups by id.
export function assetIndex() {
    const list = selectableAssets();
    return new Map(list.map((a) => [a.id, a]));
}

// A compact candidate shortlist for a prompt: rank selectable RWA assets by a
// keyword overlap with the prompt (ticker, name, issuer, class), then by 24h
// volume, and take the top `limit`. Keeps the model prompt small instead of
// dumping ~1,300 rows.
// A real exchange-style ticker (NVDAx, LLY, XAUT0) vs a name-as-ticker perp row
// ("S&P 500 Index", "SK hynix Inc."): no spaces, short, alphanumeric.
const cleanTicker = (t) => typeof t === "string" && /^[A-Za-z0-9.\-]{1,12}$/.test(t);

// Reputable tokenized-RWA issuers whose listings are the recognizable ones the
// demo is about (the house indices draw from these). Used to bias the liquidity
// filler toward real tokenized equities/ETFs/metals instead of raw-volume noise.
const CORE_ISSUERS = ["backed", "ondo", "robinhood", "anchored", "reality", "usdt0"];
const coreIssuer = (a) =>
    CORE_ISSUERS.some((p) => String(a.issuer || "").toLowerCase().includes(p));

export function candidatesForPrompt(prompt, {limit = 60} = {}) {
    // Generation candidates are clean-ticker only: the catalog carries
    // name-as-ticker perp/fund rows ("S&P 500 Index", "State Street SPDR...")
    // that produce ugly ids and often-unpriceable legs. Exclude them from every
    // path (keyword hits, padding, and the no-match fallback) so generated
    // baskets always use real tickers like the house indices do.
    const list = selectableAssets().filter((a) => cleanTicker(a.ticker));
    const words = String(prompt || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);
    const scoreOf = (a) => {
        const hay = `${a.ticker} ${a.name} ${a.issuerName} ${a.assetClass}`.toLowerCase();
        let s = 0;
        for (const w of words) if (hay.includes(w)) s += 1;
        return s;
    };
    const scored = list.map((a) => ({a, s: scoreOf(a), v: a.vol24 || 0}));
    const anyHit = scored.some((x) => x.s > 0);
    // Rank by prompt-match score, then liquidity.
    scored.sort((x, y) => y.s - x.s || y.v - x.v || x.a.name.localeCompare(y.a.name));

    // Keyword hits first. Always give the model a usable field: a thin match
    // ("high dividend blue chips" hits little) would otherwise starve it into an
    // empty index and force the default fallback.
    const MIN = 24;
    const picked = anyHit ? scored.filter((x) => x.s > 0).slice(0, limit) : [];

    // Fill up to a target, preferring recognizable core tokenized RWA (reputable
    // issuers) over raw-volume noise (the catalog is heavy with duplicate gold
    // tokens). When nothing matched at all, build a fuller default field so an
    // abstract prompt still gets a diversified, sensible basket to pick from.
    const target = anyHit ? MIN : limit;
    if (picked.length < target) {
        const have = new Set(picked.map((x) => x.a.id));
        const fill = (pred) => {
            for (const x of scored) {
                if (picked.length >= target) break;
                if (have.has(x.a.id)) continue;
                if (!pred(x.a)) continue;
                picked.push(x);
                have.add(x.a.id);
            }
        };
        fill(coreIssuer); // recognizable tokenized equities/ETFs/metals first
        fill(() => true); // then any clean-ticker name to reach the target
    }
    return picked.map((x) => x.a);
}
