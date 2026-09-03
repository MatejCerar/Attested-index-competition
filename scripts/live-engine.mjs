// Live competition engine. A continuous loop that turns the board into a real
// competition: a field of 5 distinct indices, each with a rebalance strategy
// from the (expanded) templates, priced every tick on LIVE market data and
// tracked as NAV/return since a t0 baseline. Per index per tick it computes
// current weights from holdings*price, asks its strategy.shouldRebalance(), and
// when true rebalances to target with the real vault math (nav, then
// holdings[i] = nav*wBps/10000/price[i]) and logs the reason. Writes
// app/public/data/live.json (NAV time-series, ranks, last reason) and
// leaderboard.json every tick so /live and /leaderboard move.
//
// Prices (RWA-only): Yahoo (tokenized equities to the bare ticker, metals to
// futures GC=F/SI=F/PL=F/PA=F). Any symbol with no live source (or a fetch
// failure) evolves off its last good price with a small bounded random walk so
// the board always moves. API calls are batched within a tick; a failed fetch
// keeps the last good price. No CoinGecko/crypto dependency.
//
// OFF-CHAIN (default, no PK): runs entirely on live prices, no chain.
// ON-CHAIN (PK + TEE_SIGN_URL set): pushes each tick's live prices into the
// per-asset MockUniswapV3Pool via setPriceE18, reads slot0 back (the real
// on-chain price), and relays a real FCC-signed rebalance for triggered
// indices, recording tx hashes in live.json. Same loop, one flag. On-chain
// address maps come from scripts/compete-setup.mjs (compete-onchain.json).
//
// Config (env): TICK_MS=15000 CAPITAL=100000 WALK_BPS=25 (max per-tick walk)
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {underlyingSymbol, fetchYahoo} from "./prices.mjs";
import {getStrategy} from "../index/strategies.mjs";
import {weightsToBps} from "../index/weights.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataDir = join(root, "app", "public", "data");
const userBasketsPath = join(dataDir, "user-baskets.json");
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
// Reference tx + vault for a submitted basket off-chain, so its explorer link
// resolves. Overridden by a real tx when the engine runs on-chain (PK+TEE).
const SAMPLE_TX =
    "0xd183edb2af8bc91cd5710afad951e8d5c0462ad87969af54d0c34aae85f5b57d";
const SAMPLE_VAULT = "0xef749278eba072799ef64d57b7126ee496262c56";

const TICK_MS = num("TICK_MS", 15000);
const CAPITAL = num("CAPITAL", 100000);
const WALK_BPS = num("WALK_BPS", 25); // max bounded random walk per tick, bps
const MAX_POINTS = num("MAX_POINTS", 240); // NAV series cap per index
const PK = process.env.PK;
const ON_CHAIN = !!(PK && process.env.TEE_SIGN_URL);

const catalog = JSON.parse(readFileSync(join(__dirname, "catalog.json"), "utf8"));
const byId = new Map(catalog.assets.map((a) => [a.id, a]));

const pctS = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -- The competing field: exactly 5 solid, distinct RWA indices, each with a
// strategy from the expanded templates. All legs price on Yahoo (tokenized
// equities to the bare underlying, metals to futures). No crypto on the board.
// Exactly ONE index (ai-semiconductors) runs the "minute" strategy so it
// visibly rebalances about once a minute. --
const FIELD = [
    {
        id: "mag-7-rwa",
        name: "Big-Tech RWA",
        prompt: "Mega-cap US tech as tokenized equities, tilted to the largest names.",
        kind: "rwa",
        strategy: "thirty-minute-or-drift-5",
        weights: {
            "NVDAx::backed-assets-je-limited": 25,
            "AAPLx::backed-assets-je-limited": 20,
            "MSFTx::backed-assets-je-limited": 20,
            "AMZNx::backed-assets-je-limited": 18,
            "GOOGLx::backed-assets-je-limited": 17,
        },
    },
    {
        // Minute strategy: visibly rebalances about once a minute.
        id: "ai-semiconductors",
        name: "AI & Semiconductors",
        prompt: "Picks-and-shovels of the AI buildout: GPU, foundry and memory names.",
        kind: "rwa",
        strategy: "minute",
        weights: {
            "NVDAx::backed-assets-je-limited": 30,
            "AVGOx::backed-assets-je-limited": 18,
            "TSMx::backed-assets-je-limited": 16,
            "ASMLx::backed-assets-je-limited": 14,
            "AMDx::backed-assets-je-limited": 14,
            "MUx::backed-assets-je-limited": 8,
        },
    },
    {
        id: "wall-street-financials",
        name: "Wall Street Financials",
        prompt: "Money-center banking and card-network rails as tokenized equities.",
        kind: "rwa",
        strategy: "ten-minute-or-drift-2",
        weights: {
            "JPMx::backed-assets-je-limited": 35,
            "Vx::backed-assets-je-limited": 25,
            "MAx::backed-assets-je-limited": 25,
            "GSx::backed-assets-je-limited": 15,
        },
    },
    {
        id: "precious-metals",
        name: "Precious Metals",
        prompt: "Tokenized precious metals as an inflation hedge: gold-heavy with silver, platinum, palladium.",
        kind: "rwa",
        strategy: "hourly-or-drift-5",
        weights: {
            "XAUT0::usdt0-network-xaut0-deployments": 50,
            "SLV::robinhood-markets-inc": 25,
            "PPLTon::ondo-global-markets-bvi-limited": 15,
            "PALLx::backed-assets-je-limited": 10,
        },
    },
    {
        id: "tokenized-index-funds",
        name: "Tokenized Index Funds",
        prompt: "A broad-market allocation using tokenized ETFs: large-cap core, Nasdaq growth tilt, small-cap kicker.",
        kind: "rwa",
        strategy: "drift-5",
        weights: {
            "SPYx::backed-assets-je-limited": 50,
            "QQQx::backed-assets-je-limited": 35,
            "IWMx::backed-assets-je-limited": 15,
        },
    },
];

// Resolve each leg's live price symbol + source. RWA -> Yahoo via
// underlyingSymbol. Anything unmapped falls to the random walk. Submissions are
// RWA-only too; a stray crypto-tagged basket is priced off its walk seed.
function buildLegs(b) {
    return Object.entries(b.weights).map(([id, weight]) => {
        const a = byId.get(id);
        if (!a) throw new Error(`unknown asset ${id} - rebuild catalog`);
        return {
            id,
            sym: a.ticker,
            symbol: underlyingSymbol(a),
            src: "yahoo",
            walkSeed: a.priceUsd ?? 1, // seed for the walk fallback
            weight,
        };
    });
}
const field = FIELD.map((b) => ({
    ...b,
    strat: getStrategy(b.strategy),
    legs: buildLegs(b),
}));

// Every distinct live symbol so one batched Yahoo fetch per tick. Submissions
// grow this set at runtime as they join, so their legs get fetched.
const ySyms = new Set();

// Last good price per symbol; the walk evolves off this when live is missing.
const lastGood = {};

// Register an index's legs into the fetch set + seed lastGood (idempotent).
function registerLegs(b) {
    for (const l of b.legs) {
        ySyms.add(l.symbol);
        if (l.walkSeed && lastGood[l.symbol] == null) lastGood[l.symbol] = l.walkSeed;
    }
}
for (const b of field) registerLegs(b);

// Ids already racing (house + joined submissions), so we never double-count.
const houseIds = new Set(FIELD.map((b) => b.id));
const raceIds = new Set(field.map((b) => b.id));

// Baseline a fresh index at CURRENT prices: size units so nav==CAPITAL (return
// starts at 0), take the per-leg chart baseline, zero its rebalance state.
function baselineIndex(b, px) {
    b.p0 = {};
    b.units = {};
    b.rebalances = 0;
    b.lastRebalanceAt = null;
    b.lastRebalanceNav = null;
    b.lastReason = null;
    b.rebalanceTx = b.rebalanceTx ?? null;
    b.series = [];
    const tgt = targetWeightsBps(b);
    for (const l of b.legs) {
        const p = px[l.symbol] > 0 ? px[l.symbol] : (l.walkSeed ?? 1);
        b.p0[l.symbol] = p;
        const wBps = tgt[l.sym] ?? 0;
        b.units[l.symbol] = (CAPITAL * wBps) / 10000 / p;
    }
}

// Re-read user-baskets.json and add any owner:"you" submission not already
// racing. New submissions are baselined at current prices (return starts at 0)
// and from then on behave exactly like a house index. Robust: dedupe by id,
// skip house-id collisions and malformed baskets.
function pickupSubmissions(px, now) {
    let list;
    try {
        list = JSON.parse(readFileSync(userBasketsPath, "utf8"));
    } catch {
        return [];
    }
    if (!Array.isArray(list)) return [];
    const added = [];
    for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        if (raw.owner !== "you" || !raw.id) continue;
        if (raceIds.has(raw.id) || houseIds.has(raw.id)) continue;
        if (!raw.weights || typeof raw.weights !== "object") continue;
        let legs;
        try {
            legs = buildLegs(raw);
        } catch {
            continue; // unknown asset -> ignore malformed submission
        }
        if (!legs.length) continue;
        let strat;
        try {
            strat = getStrategy(raw.strategy);
        } catch {
            strat = getStrategy("hourly-or-drift-5");
        }
        const b = {
            id: raw.id,
            name: raw.name || "Untitled Index",
            prompt: raw.prompt || raw.name || "",
            kind: raw.kind === "crypto" ? "crypto" : "rwa",
            strategy: strat.id,
            weights: raw.weights,
            owner: "you",
            mine: true,
            vault: ON_CHAIN ? null : SAMPLE_VAULT,
            rebalanceTx: ON_CHAIN ? null : SAMPLE_TX,
            txSample: !ON_CHAIN,
            strat,
            legs,
        };
        registerLegs(b);
        // Backfill this tick's price map for the new legs from lastGood (their
        // walk seed) so baseline + first rebalance see a price instead of 0.
        // They fetch live from the next tick on.
        for (const l of b.legs) if (!(px[l.symbol] > 0) && lastGood[l.symbol] > 0) px[l.symbol] = lastGood[l.symbol];
        baselineIndex(b, px);
        field.push(b);
        raceIds.add(b.id);
        added.push(b);
    }
    return added;
}

// Bounded random walk: nudge a price by up to +/- WALK_BPS, floored positive.
function walk(prev) {
    const d = ((Math.random() * 2 - 1) * WALK_BPS) / 10000;
    return Math.max(prev * (1 + d), prev * 0.5);
}

// One tick of prices: batched Yahoo, then random-walk fill for any symbol still
// missing (keeps the board alive off-hours / on fetch failure).
let usedWalk = false;
async function fetchTick() {
    let y = {};
    try {
        y = ySyms.size ? await fetchYahoo([...ySyms]) : {};
    } catch {
        /* keep last good */
    }
    const px = {};
    usedWalk = false;
    const wants = new Set([...ySyms]);
    for (const s of wants) {
        const live = y[s];
        if (live > 0) {
            px[s] = live;
            lastGood[s] = live;
        } else if (lastGood[s] > 0) {
            px[s] = walk(lastGood[s]); // evolve off last good so it moves
            lastGood[s] = px[s];
            usedWalk = true;
        }
    }
    return px;
}

// Current portfolio weights (bps) from holdings * price.
function currentWeightsBps(b, px) {
    const nav = navOf(b, px);
    const out = {};
    if (nav <= 0) return out;
    for (const l of b.legs)
        out[l.sym] = Math.round(((b.units[l.symbol] * px[l.symbol]) / nav) * 10000);
    return out;
}
function targetWeightsBps(b) {
    const map = weightsToBps(Object.fromEntries(b.legs.map((l) => [l.sym, l.weight])));
    return map;
}
function navOf(b, px) {
    let nav = 0;
    for (const l of b.legs) nav += b.units[l.symbol] * (px[l.symbol] ?? 0);
    return nav;
}
// Real vault math: nav then holdings[i] = nav*wBps/10000/price[i].
function rebalance(b, px, reason) {
    const nav = navOf(b, px);
    const tgt = targetWeightsBps(b);
    for (const l of b.legs) {
        const wBps = tgt[l.sym] ?? 0;
        const target = (nav * wBps) / 10000;
        b.units[l.symbol] = px[l.symbol] > 0 ? target / px[l.symbol] : 0;
    }
    b.rebalances++;
    b.lastRebalanceAt = Date.now();
    b.lastRebalanceNav = nav;
    b.lastReason = reason;
}

// Decide + apply a rebalance for one index this tick; returns the reason fired.
function stepIndex(b, px, now) {
    const cur = currentWeightsBps(b, px);
    const tgt = targetWeightsBps(b);
    const nav = navOf(b, px);
    const fire = b.strat.shouldRebalance({
        now,
        lastRebalanceAt: b.lastRebalanceAt,
        currentWeightsBps: cur,
        targetWeightsBps: tgt,
        nav,
        lastRebalanceNav: b.lastRebalanceNav,
    });
    if (!fire) return null;
    const reason = reasonFor(b, cur, tgt, nav, now);
    rebalance(b, px, reason);
    return reason;
}
function reasonFor(b, cur, tgt, nav, now) {
    if (b.lastRebalanceAt == null) return "first rebalance";
    let maxD = 0;
    for (const s of new Set([...Object.keys(cur), ...Object.keys(tgt)]))
        maxD = Math.max(maxD, Math.abs((cur[s] || 0) - (tgt[s] || 0)));
    const sinceGain =
        b.lastRebalanceNav > 0 ? nav / b.lastRebalanceNav - 1 : 0;
    if (b.strat.gainPct != null && sinceGain * 100 >= b.strat.gainPct)
        return `take-profit ${pctS(sinceGain)} >= ${b.strat.gainPct}%`;
    if (b.strat.driftBps != null && maxD >= b.strat.driftBps)
        return `drift ${maxD}bps >= ${b.strat.driftBps}bps`;
    if (b.strat.intervalMs != null) return "interval elapsed";
    return "rebalanced";
}

// -- On-chain hookup (optional). Lazily loaded so off-chain runs need no deps
// beyond ethers (already a dependency). Reads compete-onchain.json written by
// scripts/compete-setup.mjs: {rpc, stable, tee, pools:{sym:addr},
// vaults:{indexId:{addr, order:[sym...]}}}. --
let chain = null;
async function initChain() {
    const cfgPath = join(dataDir, "compete-onchain.json");
    if (!existsSync(cfgPath)) {
        console.log(
            "ON-CHAIN requested but app/public/data/compete-onchain.json is missing. Run scripts/compete-setup.mjs first. Falling back to off-chain."
        );
        return null;
    }
    const {JsonRpcProvider, Wallet, Contract, AbiCoder, getBytes, keccak256, verifyMessage} =
        await import("ethers");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const provider = new JsonRpcProvider(cfg.rpc);
    const gov = new Wallet(PK, provider);
    const abi = AbiCoder.defaultAbiCoder();
    const poolAbi = [
        "function setPriceE18(uint256 priceUsdE18)",
        "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
        "function assetIsToken0() view returns (bool)",
        "function assetDecimals() view returns (uint8)",
        "function stableDecimals() view returns (uint8)",
    ];
    const vaultAbi = [
        "function rebalance(uint16[] weightsBps,uint256[] pricesE18,bytes sig)",
        "function nonce() view returns (uint256)",
    ];
    async function teeSign(messageHex, retries = 20) {
        const b64 = Buffer.from(getBytes(messageHex)).toString("base64");
        let last;
        for (let i = 0; i < retries; i++) {
            try {
                const r = await fetch(process.env.TEE_SIGN_URL, {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({message: b64}),
                });
                if (!r.ok) throw new Error(`sign ${r.status}`);
                const j = await r.json();
                const sig = Buffer.from(j.signature, "base64");
                if (sig[64] < 27) sig[64] += 27;
                const sigHex = "0x" + sig.toString("hex");
                return {sig: sigHex, recovered: verifyMessage(getBytes(keccak256(messageHex)), sigHex)};
            } catch (e) {
                last = e;
                await sleep(1000);
            }
        }
        throw last;
    }
    console.log(`ON-CHAIN: pushing live prices into ${Object.keys(cfg.pools).length} pools, gov=${gov.address}`);
    return {cfg, provider, gov, abi, Contract, poolAbi, vaultAbi, teeSign, sqrtUsd: null};
}
// Push this tick's prices into the pools, read slot0 back to on-chain USD.
async function pushPricesOnChain(px) {
    const {sqrtPriceX96ToUsd} = await import("../index/prices.mjs");
    const {cfg, gov, Contract, poolAbi} = chain;
    const onchainPx = {};
    for (const [sym, addr] of Object.entries(cfg.pools)) {
        if (!(px[sym] > 0)) continue;
        try {
            const pool = new Contract(addr, poolAbi, gov);
            const e18 = BigInt(Math.round(px[sym] * 1e18));
            await (await pool.setPriceE18(e18)).wait();
            const [sp] = await pool.slot0();
            const [a0, ad, sd] = await Promise.all([
                pool.assetIsToken0(),
                pool.assetDecimals(),
                pool.stableDecimals(),
            ]);
            onchainPx[sym] = sqrtPriceX96ToUsd(sp, {
                assetIsToken0: a0,
                assetDecimals: Number(ad),
                stableDecimals: Number(sd),
            });
        } catch (e) {
            console.error(`pool ${sym} setPrice failed:`, e.message);
        }
    }
    return onchainPx;
}
// Relay a real FCC-signed rebalance for one index; returns the tx hash.
async function rebalanceOnChain(b, px) {
    const {cfg, gov, abi, Contract, vaultAbi, teeSign} = chain;
    const v = cfg.vaults[b.id];
    if (!v) return null;
    const vault = new Contract(v.addr, vaultAbi, gov);
    const nonce = await vault.nonce();
    const tgt = targetWeightsBps(b);
    const weightsBps = v.order.map((sym) => tgt[sym] ?? 0);
    const pricesE18 = v.order.map((sym) => {
        const symbol = b.legs.find((l) => l.sym === sym)?.symbol;
        return BigInt(Math.round((px[symbol] ?? 0) * 1e18));
    });
    const msg = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [v.addr, nonce, weightsBps, pricesE18]
    );
    const {sig} = await teeSign(msg);
    const tx = await (await vault.rebalance(weightsBps, pricesE18, sig)).wait();
    return tx.hash;
}

// -- Snapshots. Writes live.json (per-index NAV series + rank + reason) and a
// return-ranked leaderboard.json each tick. --
const t0 = Date.now();
function snapshot(px) {
    const now = Date.now();
    const scored = field
        .map((b) => {
            const nav = navOf(b, px);
            const ret = nav / CAPITAL - 1;
            b.series.push({t: now, nav, ret});
            if (b.series.length > MAX_POINTS) b.series.shift();
            return {
                id: b.id,
                name: b.name,
                prompt: b.prompt,
                kind: b.kind,
                strategy: b.strategy,
                strategyName: b.strat.name,
                coverage: 1,
                notExecutable: false,
                nav,
                ret,
                rebalances: b.rebalances,
                lastReason: b.lastReason ?? "none yet",
                lastRebalanceAt: b.lastRebalanceAt,
                onChain: ON_CHAIN,
                owner: b.owner ?? null,
                mine: b.mine === true,
                vault: b.vault ?? null,
                rebalanceTx: b.rebalanceTx ?? null,
                txSample: b.txSample === true,
                series: b.series.map((p) => ({t: p.t, nav: p.nav, ret: p.ret})),
                legs: b.legs.map((l) => ({
                    sym: l.sym,
                    symbol: l.symbol,
                    weight: l.weight,
                    dead: !(px[l.symbol] > 0),
                    price: px[l.symbol] ?? null,
                    chg: px[l.symbol] > 0 && b.p0[l.symbol] > 0 ? px[l.symbol] / b.p0[l.symbol] - 1 : null,
                })),
            };
        })
        .sort((a, b) => b.ret - a.ret);
    scored.forEach((r, i) => (r.rank = i + 1));
    const elapsed = Math.round((now - t0) / 1000);
    const live = {
        startedAt: new Date(t0).toISOString(),
        elapsedSec: elapsed,
        durationSec: 0, // continuous
        intervalSec: Math.round(TICK_MS / 1000),
        rebalanceSec: 0, // per-index strategy timing
        capital: CAPITAL,
        finished: false,
        continuous: true,
        source: ON_CHAIN ? "onchain" : "live",
        sourceLabel: ON_CHAIN
            ? "Live prices pushed on-chain (MockUniswapV3Pool slot0), FCC-signed rebalance"
            : (usedWalk ? "Live Yahoo (RWA), random-walk fallback for gaps" : "Live Yahoo (RWA)"),
        indices: scored,
    };
    writeFileSync(join(dataDir, "live.json"), JSON.stringify(live, null, 2) + "\n");
    writeLeaderboard(scored, px);
    return scored;
}
function writeLeaderboard(scored, px) {
    const rows = scored.map((r) => {
        const b = field.find((x) => x.id === r.id);
        return {
            id: r.id,
            name: r.name,
            prompt: r.prompt,
            owner: r.owner ?? undefined,
            mine: r.mine === true ? true : undefined,
            weights: Object.fromEntries(b.legs.map((l) => [l.sym, l.weight])),
            strategy: r.strategy,
            strategyName: r.strategyName,
            rebalanceReason: r.lastReason,
            vault: r.vault ?? undefined,
            rebalanceTx: r.rebalanceTx ?? undefined,
            txSample: r.txSample === true ? true : undefined,
            positions: b.legs.map((l) => ({
                sym: l.sym,
                weight: l.weight,
                units: b.units[l.symbol],
                basePx: b.p0[l.symbol] ?? px[l.symbol] ?? 0,
                drift: px[l.symbol] > 0 && b.p0[l.symbol] > 0 ? px[l.symbol] / b.p0[l.symbol] - 1 : 0,
                source: l.src,
            })),
            weekReturn: r.ret,
            rank: r.rank,
        };
    });
    const data = {
        generatedAt: new Date().toISOString(),
        network: ON_CHAIN ? "Coston2 (chain 114)" : "off-chain live competition",
        feeBps: 200,
        platformRevenueUsd: 0,
        live: true,
        attestedBy: ON_CHAIN
            ? "real Flare tee-node (FCC) - signs each on-chain rebalance"
            : "off-chain live competition (no chain)",
        indices: rows,
    };
    writeFileSync(join(dataDir, "leaderboard.json"), JSON.stringify(data, null, 2) + "\n");
}

// -- Main loop. --
let stopping = false;
async function main() {
    console.log(
        `live engine: ${field.length} indices, $${CAPITAL.toLocaleString()} each, tick ${TICK_MS}ms, ${ON_CHAIN ? "ON-CHAIN" : "off-chain"}.`
    );
    for (const b of field) console.log(`  - ${b.name} [${b.strategy}] ${JSON.stringify(b.weights)}`);

    if (ON_CHAIN) chain = await initChain();
    const onChainNow = !!chain;
    if (onChainNow) for (const b of field) b.vault = chain.cfg.vaults[b.id]?.addr ?? null;

    // Register any already-submitted baskets before the first fetch so their
    // legs are in the batched price pull from t0.
    pickupSubmissions({}, Date.now());

    // t0 baseline: fetch prices, mark availability, size holdings to equal
    // capital, take the per-leg baseline for chart change.
    let px = await fetchTick();
    if (onChainNow) {
        const oc = await pushPricesOnChain(px);
        px = {...px, ...oc}; // prefer the real on-chain price where present
    }
    for (const b of field) baselineIndex(b, px);
    const sampleSym = field[0].legs[0].symbol;
    console.log(`t0 baseline set. sample live price ${sampleSym}=${px[sampleSym]?.toFixed?.(4) ?? px[sampleSym]}`);
    snapshot(px);

    while (!stopping) {
        await sleep(TICK_MS);
        if (stopping) break;
        let tickPx = await fetchTick();
        if (onChainNow) {
            const oc = await pushPricesOnChain(tickPx);
            tickPx = {...tickPx, ...oc};
        }
        // Pick up new submissions (baselined at current prices, return 0 on join)
        // without touching the house indices' baselines.
        const joined = pickupSubmissions(tickPx, Date.now());
        if (joined.length)
            for (const b of joined)
                console.log(`  + submission joined the race: ${b.name} [${b.strategy}] owner=you`);
        for (const b of field) {
            const reason = stepIndex(b, tickPx, Date.now());
            if (reason) {
                if (onChainNow) {
                    try {
                        b.rebalanceTx = await rebalanceOnChain(b, tickPx);
                    } catch (e) {
                        console.error(`onchain rebalance ${b.id} failed:`, e.message);
                    }
                }
                console.log(`  rebalance ${b.name}: ${reason}${b.rebalanceTx ? ` tx=${b.rebalanceTx}` : ""}`);
            }
        }
        const scored = snapshot(tickPx);
        const lead = scored.slice(0, 3).map((r) => `${r.rank}.${r.name} ${pctS(r.ret)}`).join("   ");
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${lead}`);
    }
    console.log("stopped. live.json + leaderboard.json left in place.");
}

function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log("\nCtrl-C: finishing current tick and exiting.");
    setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
