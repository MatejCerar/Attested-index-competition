// Real competition. Each index starts with equal capital; holdings are priced
// on live data and NAV/return tracked each tick. Every REBALANCE_SEC the
// rebalancer resets each index to its target weights at current prices (a
// constant-mix strategy) - the same action the FCC enclave signs on-chain.
// Results stream to frontend/live.js, shown by frontend/live.html.
//
// PRICE_SOURCE=hl (default): Hyperliquid mainnet oracle - the target venue.
//   Prices the exact HIP-3 stock/commodity/metal perps + crypto you would
//   trade against; read-only and free (no capital, no tokens). Assets not
//   listed on HL are dropped and the index's remaining weights renormalized,
//   with coverage reported; an index with nothing on HL is marked not
//   executable. This is the live competition minus capital-at-risk execution.
// PRICE_SOURCE=yahoo: Yahoo Finance (RWA) + CoinGecko (crypto), venue-agnostic.
//
// Config (env): DURATION_SEC=3600 INTERVAL_SEC=60 REBALANCE_SEC=900
//               CAPITAL=100000 INCLUDE_CRYPTO=1 PRICE_SOURCE=hl|yahoo
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {underlyingSymbol, hlSymbol, fetchYahoo, fetchCoingecko, fetchHyperliquid} from "./prices.mjs";
import {BASKETS} from "./baskets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const DURATION = num("DURATION_SEC", 3600);
const INTERVAL = num("INTERVAL_SEC", 60);
const REBALANCE = num("REBALANCE_SEC", 900);
const CAPITAL = num("CAPITAL", 100000);
const WITH_CRYPTO = !!process.env.INCLUDE_CRYPTO;
const SOURCE = (process.env.PRICE_SOURCE || "hl").toLowerCase(); // hl | yahoo
const SRC_LABEL = SOURCE === "hl"
    ? "Hyperliquid mainnet oracle (HIP-3 perps), live"
    : "Yahoo Finance (RWA) + CoinGecko (crypto), live";
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const pctS = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";

const catalog = JSON.parse(readFileSync(join(__dirname, "catalog.json"), "utf8"));
const byId = new Map(catalog.assets.map((a) => [a.id, a]));
const rwa = JSON.parse(readFileSync(join(__dirname, "user-baskets.json"), "utf8"));

// Each leg carries the market symbol it prices on for the chosen source.
function buildLegs(b) {
    return Object.entries(b.weights).map(([id, weight]) => {
        if (b.kind === "crypto") return {id, sym: id, symbol: id, weight};
        const a = byId.get(id);
        if (!a) throw new Error(`unknown asset ${id} - rebuild catalog`);
        return {id, sym: a.ticker, symbol: SOURCE === "hl" ? hlSymbol(a) : underlyingSymbol(a), weight};
    });
}
const field = [
    ...rwa.map((b) => ({...b, kind: "rwa"})),
    ...(WITH_CRYPTO ? BASKETS.map((b) => ({...b, kind: "crypto"})) : []),
].map((b) => ({...b, legs: buildLegs(b)}));

// One price fetch across whatever sources the field needs.
async function fetchAll() {
    if (SOURCE === "hl") return await fetchHyperliquid(); // full HL market map
    const ySyms = [], cSyms = [];
    for (const b of field) for (const l of b.legs) (b.kind === "crypto" ? cSyms : ySyms).push(l.symbol);
    const [y, c] = await Promise.all([fetchYahoo(ySyms), WITH_CRYPTO ? fetchCoingecko(cSyms) : {}]);
    return {...y, ...c};
}

const start = Date.now();
let px = await fetchAll();

// t0 baseline: mark each leg available/dead by price coverage, renormalize the
// available weights to 100, size holdings to equal capital at live prices.
for (const b of field) {
    b.p0 = {}; b.units = {}; b.rebalances = 0;
    b.legs.forEach((l) => (l.dead = !(px[l.symbol] > 0)));
    const effSum = b.legs.filter((l) => !l.dead).reduce((a, l) => a + l.weight, 0);
    b.coverage = effSum / 100; // fraction of target weight that is executable
    b.notExecutable = effSum === 0;
    for (const l of b.legs) {
        if (l.dead) continue;
        l.eff = (l.weight / effSum) * 100;   // renormalized to the covered legs
        b.p0[l.symbol] = px[l.symbol];
        b.units[l.symbol] = (CAPITAL * (l.eff / 100)) / px[l.symbol];
    }
}
const covMsg = SOURCE === "hl"
    ? ` | HL coverage: ${field.filter((b) => !b.notExecutable).length}/${field.length} indices executable`
    : "";
console.log(
    `real competition [${SOURCE}]: ${field.length} indices, $${CAPITAL.toLocaleString()} each, ` +
    `rebalance every ${REBALANCE}s, for ${DURATION}s (tick ${INTERVAL}s).${covMsg}`
);
for (const b of field.filter((b) => b.notExecutable))
    console.log(`  note: "${b.name}" has no legs on ${SOURCE} - not executable, excluded from ranking.`);

function navOf(b) {
    let nav = 0;
    for (const l of b.legs) if (!l.dead) nav += b.units[l.symbol] * px[l.symbol];
    return nav;
}
function rebalance(b) { // reset holdings to renormalized target weights at live prices
    if (b.notExecutable) return;
    const nav = navOf(b);
    for (const l of b.legs) if (!l.dead) b.units[l.symbol] = (nav * (l.eff / 100)) / px[l.symbol];
    b.rebalances++;
}

function snapshot(finished) {
    const scored = field.filter((b) => !b.notExecutable).map((b) => {
        const nav = navOf(b);
        return {
            id: b.id, name: b.name, prompt: b.prompt, kind: b.kind, rebalances: b.rebalances,
            coverage: b.coverage, notExecutable: false, nav, ret: nav / CAPITAL - 1,
            legs: b.legs.map((l) => ({
                sym: l.sym, symbol: l.symbol, weight: l.weight, dead: l.dead,
                price: l.dead ? null : px[l.symbol], chg: l.dead ? null : px[l.symbol] / b.p0[l.symbol] - 1,
            })),
        };
    }).sort((a, b) => b.ret - a.ret);
    scored.forEach((r, i) => (r.rank = i + 1));
    const skipped = field.filter((b) => b.notExecutable).map((b) => ({
        id: b.id, name: b.name, prompt: b.prompt, kind: b.kind, coverage: 0, notExecutable: true,
        legs: b.legs.map((l) => ({sym: l.sym, symbol: l.symbol, weight: l.weight, dead: true, price: null, chg: null})),
    }));
    const elapsed = Math.round((Date.now() - start) / 1000);
    const data = {
        startedAt: new Date(start).toISOString(), elapsedSec: elapsed, durationSec: DURATION,
        intervalSec: INTERVAL, rebalanceSec: REBALANCE, capital: CAPITAL, finished: !!finished,
        source: SOURCE, sourceLabel: SRC_LABEL, indices: [...scored, ...skipped],
    };
    writeFileSync(join(__dirname, "frontend", "live.js"), "window.LIVE = " + JSON.stringify(data, null, 2) + ";\n");
    const lead = scored.slice(0, 3).map((r) => `${r.rank}.${r.name} ${pctS(r.ret)}`).join("   ");
    console.log(`[${String(elapsed).padStart(4)}s] ${lead}`);
}

snapshot(false);
let lastReb = Date.now();
while ((Date.now() - start) / 1000 < DURATION) {
    await sleep(INTERVAL);
    const fresh = await fetchAll();
    px = {...px, ...fresh}; // keep last-known price for any symbol that failed this tick
    if ((Date.now() - lastReb) / 1000 >= REBALANCE) {
        for (const b of field) rebalance(b);
        lastReb = Date.now();
        console.log(`  -- rebalanced to target weights on live ${SOURCE} prices --`);
    }
    snapshot(false);
}
snapshot(true);
const top = JSON.parse(readFileSync(join(__dirname, "frontend", "live.js"), "utf8")
    .replace(/^window.LIVE = /, "").replace(/;\n$/, "")).indices.filter((i) => !i.notExecutable)[0];
console.log(top ? `\nWINNER: ${top.name} at ${pctS(top.ret)} over ${DURATION}s. wrote frontend/live.js`
                : "\nno executable indices on this source. wrote frontend/live.js");
