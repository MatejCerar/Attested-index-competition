// The rebalancer, attested end to end. Per attested index, per tick: weights
// come from the deterministic build of the index CONFIG over the frozen
// feature matrix (index/build-index.mjs, the exact module the enclave runs),
// prices come from the pluggable oracle (pipeline/oracle), and the signature
// request is the FULL envelope {vault, nonce, weightsBps, pricesE18, ids,
// config, matrixCsv} sent to the enclave INDEX/REBALANCE op, which refuses to
// sign weights it cannot reproduce. DRY mode (default, no key) runs the same
// decisioning and logs the would-be envelope, no chain, no signer.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {AbiCoder, JsonRpcProvider, Wallet, Contract, keccak256} from "ethers";
import {ATTESTED_INDICES, strategyForAttested} from "../index/attested-indices.mjs";
import {buildFromConfig, loadMatrixCsv, matrixHash} from "../index/build-index.mjs";
import {createOracle} from "../pipeline/oracle/oracle.mjs";
import {selectableAssets} from "../index/catalog.mjs";
import {bareTicker, fetchYahoo} from "../scripts/prices.mjs";
import {teeSignEnvelope} from "../enclave/teesign.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();

const RPC = process.env.RPC ?? "https://coston2-api.flare.network/ext/C/rpc";
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const PK = process.env.PK;
const DRY = process.env.DRY === "1" || !PK;

// Yahoo live prices with the catalog snapshot as the offline fallback, so DRY
// runs with zero keys and zero network. Matrix ids are bare large-cap tickers
// (NVDA, MSFT, ...) so they price directly.
function catalogPriceMap() {
    const out = {};
    for (const a of selectableAssets()) {
        const t = bareTicker(a);
        if (a.priceUsd > 0 && out[t] == null) out[t] = a.priceUsd;
    }
    return out;
}
async function fetchPrices(symbols) {
    let live = {};
    try {
        live = await fetchYahoo(symbols);
    } catch {
        /* offline: catalog fallback below */
    }
    const snap = catalogPriceMap();
    const out = {};
    for (const s of symbols) out[s] = live[s] > 0 ? live[s] : snap[s];
    return out;
}

// The full envelope the enclave INDEX/REBALANCE handler validates, plus the
// abi preimage/digest StableIndexVault.rebalance re-hashes on-chain.
export function buildRebalanceEnvelope({vault, nonce, ids, weightsBps, prices, config, matrixCsv}) {
    const pricesE18 = ids.map((id) => BigInt(Math.round(prices[id] * 1e18)));
    const message = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [vault, BigInt(nonce), weightsBps, pricesE18]
    );
    const envelope = {
        vault,
        nonce: Number(nonce),
        weightsBps,
        pricesE18: pricesE18.map(String),
        ids,
        config,
        matrixCsv,
    };
    return {envelope, weightsBps, pricesE18, message, digest: keccak256(message)};
}

// bps map -> current weights from holdings * price. holdings: {SYM: units}.
export function currentWeightsBps(symbols, holdings, prices) {
    const vals = symbols.map((s) => (holdings[s] || 0) * (prices[s] || 0));
    const total = vals.reduce((a, v) => a + v, 0);
    const out = {};
    if (total <= 0) return out;
    symbols.forEach((s, i) => (out[s] = Math.round((vals[i] / total) * 10000)));
    return out;
}

// Reason string surfaced for the frontend / logs.
export function reasonFor(strategy, ctx) {
    const {now, lastRebalanceAt, currentWeightsBps: cur, targetWeightsBps: tgt} = ctx;
    if (strategy.driftBps != null) {
        let max = 0;
        for (const s of new Set([...Object.keys(cur), ...Object.keys(tgt)])) {
            max = Math.max(max, Math.abs((cur[s] || 0) - (tgt[s] || 0)));
        }
        if (max >= strategy.driftBps) return `drift ${max}bps >= ${strategy.driftBps}bps`;
    }
    if (strategy.intervalMs != null) {
        if (lastRebalanceAt == null) return "first rebalance";
        return `interval elapsed (${now - lastRebalanceAt}ms >= ${strategy.intervalMs}ms)`;
    }
    return "strategy triggered";
}

// Envelope printable in a log line: matrixCsv summarized to size + hash.
function loggableEnvelope(envelope) {
    return {
        ...envelope,
        matrixCsv: `<${Buffer.byteLength(envelope.matrixCsv)}B keccak256=${matrixHash(envelope.matrixCsv)}>`,
    };
}

// One decision + optional execution for a single attested index. built is the
// deterministic build {ids, weightsBps}; live is {vault, vaultAddr} or null.
export async function tickIndex(index, built, ctx, prices, live) {
    const {ids, weightsBps} = built;
    const strategy = strategyForAttested(index);
    const targetWeightsBps = Object.fromEntries(ids.map((id, i) => [id, weightsBps[i]]));
    const curBps = currentWeightsBps(ids, ctx.holdings, prices);

    const decisionCtx = {
        now: ctx.now,
        lastRebalanceAt: ctx.lastRebalanceAt,
        currentWeightsBps: curBps,
        targetWeightsBps,
    };
    if (!strategy.shouldRebalance(decisionCtx)) {
        return {rebalanced: false, reason: "within band / interval not elapsed"};
    }
    const reason = reasonFor(strategy, decisionCtx);
    const {envelope, pricesE18, digest} = buildRebalanceEnvelope({
        vault: live?.vaultAddr ?? "0x0000000000000000000000000000000000000000",
        nonce: ctx.nonce,
        ids,
        weightsBps,
        prices,
        config: index.config,
        matrixCsv: loadMatrixCsv(),
    });

    if (!live) {
        // DRY: move simulated holdings to target and log the exact envelope
        // that a LIVE run would send to the enclave INDEX/REBALANCE op.
        const nav = ids.reduce((a, s) => a + (ctx.holdings[s] || 0) * prices[s], ctx.cashUsd || 0);
        ids.forEach((s, i) => {
            ctx.holdings[s] = (nav * weightsBps[i]) / 10000 / prices[s];
        });
        ctx.cashUsd = 0;
        ctx.nonce++;
        ctx.lastRebalanceAt = ctx.now;
        console.log(
            `[rebalancer] would-be INDEX/REBALANCE envelope for ${index.id} (digest ${digest}):\n` +
                JSON.stringify(loggableEnvelope(envelope), null, 2)
        );
        return {rebalanced: true, reason, envelope, dry: true};
    }

    // LIVE: the enclave recomputes buildIndexBps(matrixCsv, config) and signs
    // only if our weightsBps match; then relay the real on-chain rebalance.
    const {sig, recovered} = await teeSignEnvelope(TEE_SIGN_URL, envelope, digest);
    console.log(`[rebalancer] enclave signed ${index.id} digest=${digest} signer=${recovered}`);
    const tx = await (await live.vault.rebalance(weightsBps, pricesE18, sig)).wait();
    ctx.nonce++;
    ctx.lastRebalanceAt = ctx.now;
    return {rebalanced: true, reason, envelope, txHash: tx.hash};
}

// DRY run: a few ticks over the attested indices, logging decisions and the
// would-be envelopes. Seeds holdings at target, then applies a deterministic
// drift so the drift strategies trip. Zero keys, zero chain.
async function runDry({ticks = 3} = {}) {
    const oracle = createOracle({mode: "raw", fetchPrices});
    console.log(
        `[rebalancer] DRY mode, ${ATTESTED_INDICES.length} attested indices, ${ticks} ticks, oracle=${oracle.mode}`
    );
    const state = new Map();
    const builds = new Map();
    const allIds = new Set();
    for (const index of ATTESTED_INDICES) {
        const built = buildFromConfig(index.config);
        builds.set(index.id, built);
        built.ids.forEach((s) => allIds.add(s));
    }
    const prices = await oracle.getPrices([...allIds]);
    for (const index of ATTESTED_INDICES) {
        const {ids, weightsBps} = builds.get(index.id);
        const nav = 1000;
        const holdings = {};
        ids.forEach((s, i) => {
            holdings[s] = (nav * weightsBps[i]) / 10000 / prices[s];
        });
        state.set(index.id, {holdings, cashUsd: 0, nonce: 0, lastRebalanceAt: null});
    }

    let now = Date.now();
    for (let t = 0; t < ticks; t++) {
        now += 2000000; // past every interval so time-based strats trip
        for (const index of ATTESTED_INDICES) {
            const ctx = state.get(index.id);
            const built = builds.get(index.id);
            if (t === 0) ctx.holdings[built.ids[0]] *= 1.4; // 40% price-move drift
            ctx.now = now;
            const r = await tickIndex(index, built, ctx, prices, null);
            const tag = r.rebalanced ? "REBALANCE" : "hold";
            console.log(`[tick ${t}] ${index.id} [${index.strategy}] -> ${tag}: ${r.reason}`);
        }
    }
    console.log("[rebalancer] DRY run complete");
}

// LIVE run: vault addresses per attested index in a JSON file (VAULTS env
// path) mapping {indexId: vaultAddr}. Attested oracle prices, envelope-gated
// enclave signature, one on-chain rebalance per triggered index.
async function runLive() {
    if (!PK) throw new Error("LIVE mode needs PK");
    const vaultsPath = process.env.VAULTS;
    if (!vaultsPath) throw new Error("LIVE mode needs VAULTS=<path to {id:addr}>");
    const vaults = JSON.parse(readFileSync(vaultsPath, "utf8"));
    const art = JSON.parse(
        readFileSync(join(__dirname, "..", "scripts", "abi", "StableIndexVault.json"), "utf8")
    );
    const provider = new JsonRpcProvider(RPC);
    const signer = new Wallet(PK, provider);
    // Attested prices: the same TEE signs the price payload the vault-side
    // SignedPriceOracle would verify. PRICE_SIGN_URL splits the endpoints when
    // the rebalance signer sits behind the extension gateway.
    const oracle = createOracle({
        mode: process.env.PRICE_ORACLE_MODE ?? "enclave-signed",
        signUrl: process.env.PRICE_SIGN_URL ?? TEE_SIGN_URL,
    });

    for (const index of ATTESTED_INDICES) {
        const addr = vaults[index.id];
        if (!addr) {
            console.log(`[rebalancer] no vault for ${index.id}, skip`);
            continue;
        }
        const built = buildFromConfig(index.config);
        const {prices, attestation} = await oracle.getAttestedPrices(built.ids);
        const vault = new Contract(addr, art.abi, signer);
        const nonce = Number(await vault.nonce());
        const holdingsRaw = await vault.getHoldings();
        const holdings = {};
        built.ids.forEach((s, i) => (holdings[s] = Number(holdingsRaw[i]) / 1e18));
        const ctx = {
            holdings,
            cashUsd: Number(await vault.cash()) / 1e6,
            nonce,
            lastRebalanceAt: null,
            now: Date.now(),
        };
        const r = await tickIndex(index, built, ctx, prices, {vault, vaultAddr: addr});
        console.log(
            `[rebalancer] ${index.id}: ${r.rebalanced ? "rebalanced " + r.txHash : "held"} ` +
                `(${r.reason}; prices ${attestation.mode}, attested=${attestation.mode !== "raw"})`
        );
    }
}

async function main() {
    if (DRY) return runDry();
    return runLive();
}

// Exported for reuse by the orchestrator and tests.
export {tickIndex as tickAttestedIndex, fetchPrices};

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
