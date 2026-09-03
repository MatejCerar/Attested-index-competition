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
export function candidatesForPrompt(prompt, {limit = 60} = {}) {
    const list = selectableAssets();
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
    // If the prompt matched nothing, fall back to the most liquid priceable
    // names so the model still has a sensible RWA field to pick from.
    scored.sort((x, y) => y.s - x.s || y.v - x.v || x.a.name.localeCompare(y.a.name));
    const picked = (anyHit ? scored.filter((x) => x.s > 0) : scored).slice(0, limit);
    return picked.map((x) => x.a);
}
