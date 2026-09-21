// Live competition engine. A continuous loop that turns the board into a real
// competition: the house field is the 5 ATTESTED indices (configs over the
// frozen feature matrix, weights from the deterministic build so the enclave
// rebalance gate reproduces them), racing alongside user submissions. Each is
// priced every tick on LIVE market data and tracked as NAV/return since a t0
// baseline. Per index per tick it computes current weights from
// holdings*price, asks its strategy.shouldRebalance(), and when true
// rebalances to target with the real vault math (nav, then holdings[i] =
// nav*wBps/10000/price[i]) and logs the reason. Writes
// app/public/data/live.json (NAV time-series, ranks, last reason, provenance)
// and leaderboard.json every tick so /live and /leaderboard move.
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
import {keccak256} from "ethers";
import {underlyingSymbol, bareTicker, fetchYahoo} from "./prices.mjs";
import {getStrategy} from "../index/strategies.mjs";
import {weightsToBps} from "../index/weights.mjs";
import {ATTESTED_INDICES} from "../index/attested-indices.mjs";
import {buildFromConfig, loadMatrixCsv, matrixHash} from "../index/build-index.mjs";
import {createOracle} from "../pipeline/oracle/oracle.mjs";
import {teeSignEnvelope} from "../enclave/teesign.mjs";

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

// The pluggable price oracle (pipeline/oracle). Off-chain the mode only labels
// provenance; on-chain (mode enclave-signed) rebalances use attested prices.
const oracle = createOracle({
    mode: process.env.PRICE_ORACLE_MODE ?? (process.env.TEE_SIGN_URL ? "enclave-signed" : "raw"),
});
const MATRIX_HASH = matrixHash();

// -- The house field: the ATTESTED indices. Each is a CONFIG over the frozen
// feature matrix; its weights are the deterministic build output, so the
// enclave INDEX/REBALANCE gate reproduces and signs them. Matrix ids are
// large-cap tickers (NVDA, MSFT, ...) so every leg prices live on Yahoo. --

// Resolve a matrix ticker to a priceable catalog asset (recognizable tokenized
// issuers first) so legs reuse the existing pool syms and walk seeds.
const ISSUER_PREF = ["backed", "ondo", "robinhood"];
function assetForTicker(t) {
    const hits = catalog.assets.filter((a) => a.priceUsd > 0 && bareTicker(a) === t);
    const rank = (a) => {
        const i = ISSUER_PREF.findIndex((p) => String(a.issuer || "").toLowerCase().includes(p));
        return i < 0 ? ISSUER_PREF.length : i;
    };
    hits.sort((a, b) => rank(a) - rank(b));
    return hits[0] ?? null;
}

function attestedEntry(ix) {
    const built = buildFromConfig(ix.config);
    const legs = built.ids.map((t, i) => {
        const a = assetForTicker(t);
        return {
            id: a?.id ?? t,
            sym: a?.ticker ?? t,
            symbol: a ? underlyingSymbol(a) : t,
            src: "yahoo",
            walkSeed: a?.priceUsd ?? null,
            weight: built.weightsBps[i] / 100,
            matrixId: t,
        };
    });
    return {
        id: ix.id,
        name: ix.name,
        prompt: ix.prompt,
        kind: "rwa",
        strategy: ix.strategy,
        attested: true,
        config: ix.config,
        outputRoot: built.outputRoot,
        weights: Object.fromEntries(legs.map((l) => [l.sym, l.weight])),
        weightsBpsBySym: Object.fromEntries(legs.map((l, i) => [l.sym, built.weightsBps[i]])),
        matrixIdBySym: Object.fromEntries(legs.map((l) => [l.sym, l.matrixId])),
        strat: getStrategy(ix.strategy),
        legs,
    };
}

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
const field = ATTESTED_INDICES.map(attestedEntry);

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
const houseIds = new Set(ATTESTED_INDICES.map((b) => b.id));
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
async function pickupSubmissions(px, now) {
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
        field.push(b);
        raceIds.add(b.id);
        added.push(b);
    }
    if (added.length) {
        // Baseline new submissions against a FRESH LIVE price for their legs, not
        // the stale catalog snapshot. The mid-run fetchTick() ran before these
        // legs existed, so px has no live price for them yet. Without this, the
        // next tick's live price makes each leg read (livePrice / catalogPrice -
        // 1) as a fake move on join - this is what made GME/bGME show -14%.
        const need = new Set();
        for (const b of added)
            for (const l of b.legs) if (!(px[l.symbol] > 0)) need.add(l.symbol);
        if (need.size) {
            let y = {};
            try {
                y = await fetchYahoo([...need]);
            } catch {
                /* fall back to last good / walk seed below */
            }
            for (const s of need) {
                if (y[s] > 0) {
                    px[s] = y[s];
                    lastGood[s] = y[s];
                } else if (lastGood[s] > 0) {
                    px[s] = lastGood[s]; // no live source (e.g. OPENAI): seed price
                }
            }
        }
        for (const b of added) baselineIndex(b, px);
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
        y = ySyms.size ? await oracle.getPrices([...ySyms]) : {};
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
    // Attested indices carry exact bps from the deterministic build; freeform
    // submissions still quantize their integer-pct weights.
    if (b.weightsBpsBySym) return b.weightsBpsBySym;
    return weightsToBps(Object.fromEntries(b.legs.map((l) => [l.sym, l.weight])));
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
        "function navUsdE18() view returns (uint256)",
        "function totalSupply() view returns (uint256)",
        "function totalDeposited() view returns (uint256)",
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
// True while the server is deploying a user-index vault. Both processes send txs
// from the same key, so the engine PAUSES its on-chain writes (price pushes,
// rebalances) while the lock is held to avoid nonce collisions. Reads (NAV) are
// unaffected. The lock is a file with a timestamp; it goes stale after 2 min.
function deployLockHeld() {
    try {
        const ts = Number(readFileSync(join(dataDir, "deploy.lock"), "utf8"));
        return Number.isFinite(ts) && Date.now() - ts < 120000;
    } catch {
        return false;
    }
}

// Re-read compete-onchain.json so the engine picks up pools + vaults the server
// adds at runtime when a user submits an index (Phase 2). Cheap file read each
// tick; a partial/short read is caught and the previous cfg is kept.
function refreshChainCfg() {
    if (!chain) return;
    try {
        const fresh = JSON.parse(
            readFileSync(join(dataDir, "compete-onchain.json"), "utf8")
        );
        if (fresh.pools) chain.cfg.pools = fresh.pools;
        if (fresh.vaults) chain.cfg.vaults = fresh.vaults;
    } catch {
        /* keep the current cfg on a transient read/parse error */
    }
}

// Push this tick's live prices into each asset's pool via setPriceE18 so the
// vault's on-chain navUsdE18() tracks the market. Pools are keyed by TICKER
// (NVDAx) while prices are keyed by underlying symbol (NVDA), so map through the
// field legs. The vault reads pool.priceUsdE18() directly for NAV.
async function pushPricesOnChain(px) {
    if (deployLockHeld()) return {}; // server is deploying: skip our tx writes
    const {cfg, gov, provider, Contract, poolAbi} = chain;
    const priceByPoolSym = {};
    for (const b of field)
        for (const l of b.legs)
            if (px[l.symbol] > 0) priceByPoolSym[l.sym] = px[l.symbol];
    const targets = Object.entries(cfg.pools).filter(
        ([sym]) => priceByPoolSym[sym] > 0
    );
    if (!targets.length) return {};
    // Send all price updates in PARALLEL with explicit sequential nonces (one
    // process, so they don't collide), then await confirmations together - one
    // block instead of ~21 serial txs. Keeps the tick fast so the NAV series
    // (and the chart) fills in quickly.
    const base = await provider.getTransactionCount(gov.address, "pending");
    await Promise.all(
        targets.map(([sym, addr], i) => {
            const pool = new Contract(addr, poolAbi, gov);
            const e18 = BigInt(Math.round(priceByPoolSym[sym] * 1e18));
            return pool
                .setPriceE18(e18, {nonce: base + i})
                .then((tx) => tx.wait())
                .catch((e) => console.error(`pool ${sym} setPrice failed:`, e.message));
        })
    );
    return {};
}
// Relay a real FCC-signed rebalance for one index; returns the tx hash.
// Attested indices send the FULL envelope {vault, nonce, weightsBps, pricesE18,
// ids, config, matrixCsv} to the enclave INDEX/REBALANCE op (which recomputes
// the deterministic build and refuses non-matching weights) and price with the
// oracle's ATTESTED prices. Freeform submissions keep the legacy raw-preimage
// sign so nothing existing breaks.
async function rebalanceOnChain(b, px) {
    const {cfg, gov, abi, Contract, vaultAbi, teeSign} = chain;
    const v = cfg.vaults[b.id];
    if (!v) return null;
    const vault = new Contract(v.addr, vaultAbi, gov);
    const nonce = await vault.nonce();
    const tgt = targetWeightsBps(b);
    const weightsBps = v.order.map((sym) => tgt[sym] ?? 0);
    const symbolOf = (sym) => b.legs.find((l) => l.sym === sym)?.symbol;

    if (b.attested) {
        const symbols = v.order.map(symbolOf);
        const {prices, attestation} = await oracle.getAttestedPrices(symbols);
        b.lastPriceRound = attestation.timestamp;
        const pricesE18 = symbols.map((s) => BigInt(Math.round(prices[s] * 1e18)));
        const msg = abi.encode(
            ["address", "uint256", "uint16[]", "uint256[]"],
            [v.addr, nonce, weightsBps, pricesE18]
        );
        const envelope = {
            vault: v.addr,
            nonce: Number(nonce),
            weightsBps,
            pricesE18: pricesE18.map(String),
            ids: v.order.map((sym) => b.matrixIdBySym[sym]),
            config: b.config,
            matrixCsv: loadMatrixCsv(),
        };
        const {sig} = await teeSignEnvelope(process.env.TEE_SIGN_URL, envelope, keccak256(msg));
        const tx = await (await vault.rebalance(weightsBps, pricesE18, sig)).wait();
        return tx.hash;
    }

    const pricesE18 = v.order.map((sym) => BigInt(Math.round((px[symbolOf(sym)] ?? 0) * 1e18)));
    const msg = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [v.addr, nonce, weightsBps, pricesE18]
    );
    const {sig} = await teeSign(msg);
    const tx = await (await vault.rebalance(weightsBps, pricesE18, sig)).wait();
    return tx.hash;
}

// Read each index's REAL on-chain NAV from its vault and stash it on the field
// entry. NAV (USD) = cash + sum(holdings*price) read on-chain, so it moves with
// both live prices AND user deposits. Return is share-based (navUsdE18 /
// totalSupply), which starts at 1.0 and is deposit-neutral, so deposits grow TVL
// without faking performance. Vaults with no shares yet fall back to the sim.
async function readChainNav() {
    if (!ON_CHAIN || !chain) return;
    const {cfg, gov, Contract, vaultAbi} = chain;
    await Promise.all(field.map(async (b) => {
        const v = cfg.vaults[b.id];
        if (!v) return;
        try {
            const vault = new Contract(v.addr, vaultAbi, gov);
            const [navE18, shares, deposited] = await Promise.all([
                vault.navUsdE18(),
                vault.totalSupply(),
                vault.totalDeposited(),
            ]);
            if (shares > 0n) {
                b.chainNav = Number(navE18 / 10n ** 16n) / 100; // USD, 2dp
                b.chainRet = Number((navE18 * 1000000n) / shares) / 1e6 - 1;
                b.chainTvl = Number(deposited) / 1e6; // gross deposited, USD
            } else {
                // Vault exists but nobody has deposited yet: show the real (zero)
                // on-chain value, never the $100k simulation.
                b.chainNav = Number(navE18 / 10n ** 16n) / 100;
                b.chainRet = 0;
                b.chainTvl = Number(deposited) / 1e6;
            }
        } catch (e) {
            console.error(`navUsdE18 ${b.id} read failed:`, e.message);
        }
    }));
}

// Provenance block per index (Phase 6 badges). Attested indices carry the
// config/matrix pins (plus outputRoot: a pure function of the build); epochId
// and attestedByCount stay absent until an on-chain epoch submits them. Price
// fields mirror the oracle: mode + whether rebalance prices are attested.
function provenanceOf(b) {
    const p = {
        priceOracleMode: oracle.mode,
        priceAttested: oracle.mode !== "raw",
    };
    if (b.attested) {
        p.configVersion = b.config.version;
        p.matrixHash = MATRIX_HASH;
        p.outputRoot = b.outputRoot;
        if (b.epochId != null) p.epochId = b.epochId;
        if (b.attestedByCount != null) p.attestedByCount = b.attestedByCount;
    }
    if (b.lastPriceRound != null) p.lastPriceRound = b.lastPriceRound;
    return p;
}

// -- Snapshots. Writes live.json (per-index NAV series + rank + reason) and a
// return-ranked leaderboard.json each tick. --
const t0 = Date.now();
function snapshot(px) {
    const now = Date.now();
    const scored = field
        .map((b) => {
            // Real on-chain NAV/return when the vault is live; else the sim.
            const nav = b.chainNav != null ? b.chainNav : navOf(b, px);
            const ret = b.chainRet != null ? b.chainRet : nav / CAPITAL - 1;
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
                tvl: b.chainTvl ?? null, // real deposited stablecoin, USD (on-chain)
                rebalances: b.rebalances,
                lastReason: b.lastReason ?? "none yet",
                lastRebalanceAt: b.lastRebalanceAt,
                onChain: ON_CHAIN,
                attested: b.attested === true,
                provenance: provenanceOf(b),
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
            attested: r.attested === true ? true : undefined,
            provenance: r.provenance,
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
            nav: r.nav, // real NAV (on-chain vault value), same as the Live board
            tvl: r.tvl ?? undefined,
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
    await pickupSubmissions({}, Date.now());

    // t0 baseline: fetch prices, mark availability, size holdings to equal
    // capital, take the per-leg baseline for chart change.
    let px = await fetchTick();
    if (onChainNow) {
        try {
            refreshChainCfg();
            const oc = await pushPricesOnChain(px);
            px = {...px, ...oc};
        } catch (e) {
            console.error(`t0 on-chain push failed, continuing off-chain:`, e?.message ?? e);
        }
    }
    for (const b of field) baselineIndex(b, px);
    const sampleSym = field[0].legs[0].symbol;
    console.log(`t0 baseline set. sample live price ${sampleSym}=${px[sampleSym]?.toFixed?.(4) ?? px[sampleSym]}`);
    await readChainNav();
    snapshot(px);

    while (!stopping) {
        await sleep(TICK_MS);
        if (stopping) break;
        try {
        let tickPx = await fetchTick();
        if (onChainNow) {
            refreshChainCfg();
            const oc = await pushPricesOnChain(tickPx);
            tickPx = {...tickPx, ...oc};
        }
        // Pick up new submissions (baselined at current prices, return 0 on join)
        // without touching the house indices' baselines.
        const joined = await pickupSubmissions(tickPx, Date.now());
        if (joined.length)
            for (const b of joined)
                console.log(`  + submission joined the race: ${b.name} [${b.strategy}] owner=you`);
        for (const b of field) {
            const reason = stepIndex(b, tickPx, Date.now());
            if (reason) {
                // Skip the on-chain rebalance for a vault with nothing deposited
                // yet (nav==0 would revert): wait until its owner funds it.
                if (onChainNow && !deployLockHeld() && b.chainTvl !== 0) {
                    try {
                        b.rebalanceTx = await rebalanceOnChain(b, tickPx);
                    } catch (e) {
                        console.error(`onchain rebalance ${b.id} failed:`, e.message);
                    }
                }
                console.log(`  rebalance ${b.name}: ${reason}${b.rebalanceTx ? ` tx=${b.rebalanceTx}` : ""}`);
            }
        }
        await readChainNav();
        const scored = snapshot(tickPx);
        const lead = scored.slice(0, 3).map((r) => `${r.rank}.${r.name} ${pctS(r.ret)}`).join("   ");
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${lead}`);
        } catch (e) {
            console.error(`tick failed, continuing next tick:`, e?.message ?? e);
        }
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
// A transient RPC 503 or a stray async rejection must never kill the engine:
// log and keep ticking so the board stays live.
process.on("unhandledRejection", (e) =>
    console.error("unhandledRejection (continuing):", e?.message ?? e)
);

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
