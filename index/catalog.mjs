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
    // Rank by prompt-match score, then liquidity.
    scored.sort((x, y) => y.s - x.s || y.v - x.v || x.a.name.localeCompare(y.a.name));
    // Take the keyword hits, but ALWAYS give the model a usable field. A prompt
    // like "high dividend blue chips" may keyword-match only one odd asset (e.g.
    // HYG on "high"); handing the model a shortlist of one makes it return an
    // empty index, which forces the default fallback. So if the hits are thin,
    // pad up to MIN with the most liquid priceable names.
    const MIN = 24;
    const hits = anyHit ? scored.filter((x) => x.s > 0) : scored;
    const picked = hits.slice(0, limit);
    if (picked.length < MIN) {
        const have = new Set(picked.map((x) => x.a.id));
        for (const x of scored) {
            if (picked.length >= MIN) break;
            if (!have.has(x.a.id)) {
                picked.push(x);
                have.add(x.a.id);
            }
        }
    }
    return picked.map((x) => x.a);
}
