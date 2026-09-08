// Tiny local API server (Node http, no framework). Makes the /build flow real:
//   POST /api/generate {prompt} -> generateIndex() (real Claude Haiku, catalog
//     validated); returns {name,rationale,assets,weights,strategy,source}.
//   POST /api/add {basket} -> validate against catalog + strategies, append to
//     user-baskets.json (dedup by id), score with the real rebalance math on
//     the Uniswap price source (mock pools seeded from the catalog), upsert into
//     leaderboard.json and re-rank. With PK + TEE_SIGN_URL set it does the real
//     Coston2 deposit + FCC-signed rebalance and records tx hashes.
//   GET /api/leaderboard -> current leaderboard.json.
// Runnable offline (seeded prices); real chain optional via env.
import {createServer} from "node:http";
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {keccak256, toUtf8Bytes} from "ethers";
import {generateIndex} from "../index/generate.mjs";
import {STRATEGIES, getStrategy} from "../index/strategies.mjs";
import {weightsToBps} from "../index/weights.mjs";
import {assetIndex} from "../index/catalog.mjs";
import {scoreBasketOnChain} from "./orchestrate-add.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataDir = join(root, "app", "public", "data");
const userBasketsPath = join(dataDir, "user-baskets.json");
const leaderboardPath = join(dataDir, "leaderboard.json");
const livePath = join(dataDir, "live.json");
const catalogPath = join(dataDir, "catalog.json");
const onchainPath = join(dataDir, "compete-onchain.json");

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.CORS_ORIGIN ?? "*";
const PK = process.env.PK;
const CHAIN = !!(PK && process.env.TEE_SIGN_URL);
const DEPOSIT_USD = 1000;
const FEE_BPS = 200;
// A real, tee-signed StableIndexVault.rebalance() on Coston2 (the mag-7-rwa
// vault) plus that vault address. Used as an honest, resolvable reference when
// running off-chain (no PK); marked txSample so the FE labels it "tx (sample)".
const SAMPLE_TX =
    "0xead0b309340590881850254da16f2c584e5553b325cf3562c5961b744300cba9";
const SAMPLE_VAULT = "0x89267d063D079058811569fA311ed4320885996c";

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
const slug = (s) =>
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) ||
    "index";

// Same deterministic 7-day drift the on-chain orchestrator uses, per id+symbol.
const drift = (b, s) =>
    -0.15 +
    (Number(BigInt(keccak256(toUtf8Bytes(`${b}:${s}:week1`))) % 10000n) / 10000) * 0.43;

// Price a leg from the RWA catalog snapshot (the seeded Uniswap-pool price):
// the same USD number a mock pool would read back. RWA-only board.
function priceFor(id, byId) {
    const a = byId.get(id);
    if (!a) return null;
    return a.priceUsd ?? null;
}

// Validate a submitted basket against the RWA catalog + strategies. Returns a
// clean {id,name,prompt,kind,strategy,weights} or {error}. Crypto ids do not
// exist in the catalog so they are dropped here.
function validateBasket(raw, byId) {
    if (!raw || typeof raw !== "object") return {error: "no basket"};
    const rawW = raw.weights || {};
    const idW = {};
    for (const [id, v] of Object.entries(rawW)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) continue;
        const a = byId.get(id);
        if (!a) continue;
        idW[id] = (idW[id] || 0) + n;
    }
    const ids = Object.keys(idW);
    if (!ids.length) return {error: "no valid assets in weights"};
    // Renormalize to integer pct summing to 100, remainder on the largest.
    const total = ids.reduce((a, id) => a + idW[id], 0);
    const norm = {};
    for (const id of ids) norm[id] = Math.round((idW[id] / total) * 100);
    for (const id of Object.keys(norm)) if (norm[id] <= 0) delete norm[id];
    let sum = Object.values(norm).reduce((a, v) => a + v, 0);
    if (sum !== 100) {
        const largest = Object.keys(norm).reduce((a, id) => (norm[id] > norm[a] ? id : a));
        norm[largest] += 100 - sum;
    }
    const strategy = STRATEGIES[raw.strategy] ? raw.strategy : "hourly-or-drift";
    const kind = "rwa";
    const name = String(raw.name || "").trim().slice(0, 60) || "Untitled Index";
    return {
        id: raw.id ? slug(raw.id) : slug(name),
        name,
        prompt: String(raw.prompt || name).trim().slice(0, 240),
        kind,
        strategy,
        weights: norm,
    };
}

// Score a basket off-chain with the real vault rebalance math: NAV in USD, then
// holdings[i] = (nav * weightBps/10000) / price[i], exactly what the vault sets.
function scoreOffChain(basket, byId) {
    const syms = Object.keys(basket.weights);
    const bps = weightsToBps(basket.weights);
    const prices = {};
    for (const id of syms) {
        const p = priceFor(id, byId);
        if (!(p > 0)) return {error: `no price for ${id}`};
        prices[id] = p;
    }
    const nav = DEPOSIT_USD; // full deposit deployed at rebalance
    const positions = syms.map((id) => {
        const targetUsd = (nav * bps[id]) / 10000;
        const units = targetUsd / prices[id];
        const a = byId.get(id);
        return {
            sym: a?.ticker ?? id,
            weight: basket.weights[id],
            units,
            basePx: prices[id],
            drift: drift(basket.id, id),
            source: "uniswap",
        };
    });
    const startUsd = positions.reduce((a, p) => a + p.units * p.basePx, 0);
    const endUsd = positions.reduce((a, p) => a + p.units * p.basePx * (1 + p.drift), 0);
    const weekReturn = startUsd > 0 ? endUsd / startUsd - 1 : 0;
    return {positions, weekReturn};
}

// Build the leaderboard row for a scored basket. Real tx/vault when on-chain;
// otherwise a resolvable sample tx (txSample flag) so the explorer link works.
function toRow(basket, scored, onchain) {
    const strat = getStrategy(basket.strategy);
    const fee = (DEPOSIT_USD * FEE_BPS) / 10000;
    const txSample = !onchain;
    return {
        id: basket.id,
        name: basket.name,
        prompt: basket.prompt,
        rationale: basket.rationale,
        owner: basket.owner,
        mine: basket.owner === "you",
        weights: basket.weights,
        strategy: basket.strategy,
        strategyName: strat.name,
        rebalanceReason: "initial allocation",
        vault: onchain?.vault ?? SAMPLE_VAULT,
        depositUsd: DEPOSIT_USD,
        feeUsd: fee,
        depositTx: onchain?.depositTx ?? SAMPLE_TX,
        rebalanceTx: onchain?.rebalanceTx ?? SAMPLE_TX,
        txSample,
        positions: scored.positions,
        weekReturn: scored.weekReturn,
    };
}

// Upsert a row into the leaderboard, re-rank by weekReturn, write it back.
function upsertLeaderboard(row) {
    const lb = readJson(leaderboardPath, {
        generatedAt: new Date().toISOString(),
        network: CHAIN ? "Coston2 (chain 114)" : "Coston2 (chain 114, off-chain score)",
        feeBps: FEE_BPS,
        platformRevenueUsd: 0,
        indices: [],
    });
    const idx = lb.indices.findIndex((r) => r.id === row.id);
    const isNew = idx < 0;
    if (isNew) lb.indices.push(row);
    else lb.indices[idx] = row;
    lb.indices.sort((a, b) => b.weekReturn - a.weekReturn);
    lb.indices.forEach((r, i) => (r.rank = i + 1));
    lb.generatedAt = new Date().toISOString();
    lb.platformRevenueUsd = (lb.platformRevenueUsd || 0) + (isNew ? (DEPOSIT_USD * FEE_BPS) / 10000 : 0);
    lb.feeBps = FEE_BPS;
    if (!CHAIN) lb.sample = lb.indices.every((r) => r.txSample || /^0x0+$/.test(r.rebalanceTx));
    else delete lb.sample;
    writeJson(leaderboardPath, lb);
    return lb.indices.find((r) => r.id === row.id);
}

// Append a basket to user-baskets.json (dedup by id). Tagged owner:"you" +
// submittedAt so the live engine can pick it up and race it as the user's.
function appendUserBasket(basket) {
    const list = readJson(userBasketsPath, []);
    const existing = list.findIndex((b) => b.id === basket.id);
    const rec = {
        id: basket.id, name: basket.name, prompt: basket.prompt,
        kind: basket.kind, strategy: basket.strategy, weights: basket.weights,
        owner: "you", submittedAt: Date.now(),
    };
    if (existing < 0) list.push(rec);
    else list[existing] = {...rec, submittedAt: list[existing].submittedAt ?? rec.submittedAt};
    writeJson(userBasketsPath, list);
    return list[existing < 0 ? list.length - 1 : existing];
}

// --- request helpers ---
function cors(res) {
    res.setHeader("access-control-allow-origin", ORIGIN);
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
}
function send(res, code, obj) {
    cors(res);
    res.setHeader("content-type", "application/json");
    res.writeHead(code);
    res.end(JSON.stringify(obj));
}
function readBody(req) {
    return new Promise((resolve) => {
        let b = "";
        req.on("data", (d) => (b += d));
        req.on("end", () => {
            try {
                resolve(b ? JSON.parse(b) : {});
            } catch {
                resolve(null);
            }
        });
    });
}

async function handleGenerate(req, res) {
    const body = await readBody(req);
    if (!body || !body.prompt) return send(res, 400, {error: "prompt required"});
    const idx = await generateIndex(String(body.prompt));
    send(res, 200, idx); // idx.source is "live" or FALLBACK_INDEX has source "fallback"
}

async function handleAdd(req, res) {
    const body = await readBody(req);
    const byId = assetIndex();
    const basket = validateBasket(body && body.basket, byId);
    if (basket.error) return send(res, 400, {error: basket.error});
    const stored = appendUserBasket(basket);
    basket.owner = stored.owner; // carry owner:"you" into scoring + row

    let onchain = null;
    if (CHAIN) {
        try {
            onchain = await scoreBasketOnChain(basket, {
                depositUsd: DEPOSIT_USD,
                feeBps: FEE_BPS,
                priceFor: (id) => priceFor(id, byId),
                symFor: (id) => byId.get(id)?.ticker,
            });
        } catch (e) {
            console.error("[add] on-chain scoring failed, off-chain fallback:", String(e));
        }
    }
    const scored = scoreOffChain(basket, byId);
    if (scored.error) return send(res, 400, {error: scored.error});
    // Do NOT write leaderboard.json here. The live engine is the SOLE writer of
    // that file - it picks this basket up from user-baskets.json and ranks it
    // every tick. A second writer here just clobbers the engine's view (that is
    // what made the leaderboard look broken). We only return the vault + score
    // so the FE can deposit and show a confirmation.
    const entry = {
        id: basket.id,
        name: basket.name,
        weekReturn: scored.weekReturn,
        vault: onchain?.vault ?? null,
    };
    send(res, 200, {entry, mode: onchain ? "chain" : "off-chain"});
}

const server = createServer(async (req, res) => {
    try {
        if (req.method === "OPTIONS") {
            cors(res);
            res.writeHead(204);
            return res.end();
        }
        const url = new URL(req.url, `http://localhost:${PORT}`);
        if (req.method === "POST" && url.pathname === "/api/generate")
            return handleGenerate(req, res);
        if (req.method === "POST" && url.pathname === "/api/add")
            return handleAdd(req, res);
        if (req.method === "GET" && url.pathname === "/api/leaderboard")
            return send(res, 200, readJson(leaderboardPath, {indices: []}));
        if (req.method === "GET" && url.pathname === "/api/live")
            return send(res, 200, readJson(livePath, {indices: []}));
        if (req.method === "GET" && url.pathname === "/api/catalog")
            return send(res, 200, readJson(catalogPath, {assets: []}));
        if (req.method === "GET" && url.pathname === "/api/onchain")
            return send(res, 200, readJson(onchainPath, {stable: null, vaults: {}, pools: {}}));
        send(res, 404, {error: "not found"});
    } catch (e) {
        console.error(e);
        send(res, 500, {error: String(e)});
    }
});

server.listen(PORT, () => {
    console.log(
        `[server] http://localhost:${PORT}  mode=${CHAIN ? "chain (PK+TEE)" : "off-chain scoring"}`
    );
});
