// The rebalancer. Per index, per tick: read prices (stub source), compute
// current portfolio weights from holdings * price, ask the index's strategy
// shouldRebalance(), and if true compute target holdings, obtain the FCC
// signature from the tee-node /sign endpoint, and relay the on-chain
// rebalance(). DRY mode (default, no key) simulates holdings and just logs
// decisions so it runs without a funded key or a chain.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {AbiCoder, JsonRpcProvider, Wallet, Contract} from "ethers";
import {INDICES, strategyFor} from "../index/indices.mjs";
import {createStubPriceSource, createUniswapPriceSource} from "../index/prices.mjs";
import {weightsToBps} from "../index/weights.mjs";
import {teeSign} from "../enclave/teesign.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();

const RPC = process.env.RPC ?? "https://coston2-api.flare.network/ext/C/rpc";
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const PK = process.env.PK;
const DRY = process.env.DRY === "1" || !PK;
// Optional Uniswap V3 pool pricing: POOLS=<path to {SYM: poolAddr}>. When set,
// prices come from the pools (with the stub as the no-pool fallback), matching
// how a mainnet deploy prices on real DEX pools with no code change.
const POOLS = process.env.POOLS;

// The active price source: Uniswap pools if POOLS is set, else the stub.
function priceSource(provider, Contract) {
    if (POOLS && provider && Contract) {
        const pools = JSON.parse(readFileSync(POOLS, "utf8"));
        return createUniswapPriceSource({
            provider,
            pools,
            fallbackSource: createStubPriceSource(),
            Contract,
        });
    }
    return createStubPriceSource();
}

// bps map -> current weights from holdings * price. holdings: {SYM: units1e18}.
function currentWeightsBps(symbols, holdings, prices) {
    const vals = symbols.map((s) => (holdings[s] || 0) * (prices[s] || 0));
    const total = vals.reduce((a, v) => a + v, 0);
    const out = {};
    if (total <= 0) return out;
    symbols.forEach((s, i) => (out[s] = Math.round((vals[i] / total) * 10000)));
    return out;
}

// Reason string surfaced for the frontend / logs.
function reasonFor(strategy, ctx) {
    const {now, lastRebalanceAt, currentWeightsBps: cur, targetWeightsBps: tgt} =
        ctx;
    if (strategy.driftBps != null) {
        let max = 0;
        for (const s of new Set([...Object.keys(cur), ...Object.keys(tgt)])) {
            max = Math.max(max, Math.abs((cur[s] || 0) - (tgt[s] || 0)));
        }
        if (max >= strategy.driftBps) {
            return `drift ${max}bps >= ${strategy.driftBps}bps`;
        }
    }
    if (strategy.intervalMs != null) {
        if (lastRebalanceAt == null) return "first rebalance";
        return `interval elapsed (${now - lastRebalanceAt}ms >= ${strategy.intervalMs}ms)`;
    }
    return "strategy triggered";
}

function buildRebalanceCall(vaultAddr, nonce, symbols, index, prices) {
    const bpsMap = weightsToBps(index.weights);
    const weightsBps = symbols.map((s) => bpsMap[s]);
    const pricesE18 = symbols.map((s) => BigInt(Math.round(prices[s] * 1e18)));
    const message = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [vaultAddr, nonce, weightsBps, pricesE18]
    );
    return {weightsBps, pricesE18, message};
}

// One decision + optional execution for a single index.
async function tickIndex(index, ctx, prices, live) {
    const symbols = Object.keys(index.weights);
    const strategy = strategyFor(index);
    const targetWeightsBps = weightsToBps(index.weights);
    const curBps = currentWeightsBps(symbols, ctx.holdings, prices);

    const decisionCtx = {
        now: ctx.now,
        lastRebalanceAt: ctx.lastRebalanceAt,
        currentWeightsBps: curBps,
        targetWeightsBps,
    };
    const should = strategy.shouldRebalance(decisionCtx);
    if (!should) {
        return {rebalanced: false, reason: "within band / interval not elapsed"};
    }
    const reason = reasonFor(strategy, decisionCtx);
    const {weightsBps, pricesE18, message} = buildRebalanceCall(
        live?.vaultAddr ?? "0x0000000000000000000000000000000000000000",
        ctx.nonce,
        symbols,
        index,
        prices
    );

    if (!live) {
        // DRY: move simulated holdings to target, no chain, no key.
        const nav = symbols.reduce(
            (a, s) => a + (ctx.holdings[s] || 0) * prices[s],
            ctx.cashUsd || 0
        );
        symbols.forEach((s, i) => {
            const targetUsd = (nav * weightsBps[i]) / 10000;
            ctx.holdings[s] = targetUsd / prices[s];
        });
        ctx.cashUsd = 0;
        ctx.nonce++;
        ctx.lastRebalanceAt = ctx.now;
        return {rebalanced: true, reason, weightsBps, dry: true};
    }

    // LIVE: sign via the FCC tee-node and relay the real rebalance.
    const {sig} = await teeSign(TEE_SIGN_URL, message);
    const tx = await (
        await live.vault.rebalance(weightsBps, pricesE18, sig)
    ).wait();
    ctx.nonce++;
    ctx.lastRebalanceAt = ctx.now;
    return {rebalanced: true, reason, weightsBps, txHash: tx.hash};
}

// DRY run: a few ticks over INDICES, logging decisions. Seeds holdings off
// target, then applies a deterministic drift so the drift strategies trip.
async function runDry({ticks = 3} = {}) {
    const src = createStubPriceSource();
    const prices = await src.getPrices();
    console.log(`[rebalancer] DRY mode, ${INDICES.length} indices, ${ticks} ticks`);

    const state = new Map();
    for (const index of INDICES) {
        const symbols = Object.keys(index.weights);
        const bps = weightsToBps(index.weights);
        // seed holdings at target for a 1000 USD notional
        const nav = 1000;
        const holdings = {};
        symbols.forEach((s) => {
            holdings[s] = ((nav * bps[s]) / 10000) / prices[s];
        });
        state.set(index.id, {
            holdings,
            cashUsd: 0,
            nonce: 0,
            lastRebalanceAt: null,
        });
    }

    let now = Date.now();
    for (let t = 0; t < ticks; t++) {
        // advance the clock past the smallest interval so time-based strats trip
        now += 700000;
        // nudge one asset per index to force drift on the drift strategies
        for (const index of INDICES) {
            const ctx = state.get(index.id);
            const symbols = Object.keys(index.weights);
            if (t === 0) ctx.holdings[symbols[0]] *= 1.4; // 40% price-move drift
            ctx.now = now;
            const r = await tickIndex(index, ctx, prices, null);
            const tag = r.rebalanced ? "REBALANCE" : "hold";
            console.log(
                `[tick ${t}] ${index.id} [${index.strategy}] -> ${tag}: ${r.reason}`
            );
        }
    }
    console.log("[rebalancer] DRY run complete");
}

// LIVE run: expects vault addresses per index in a JSON file (VAULTS env path)
// mapping {indexId: vaultAddr}. Relays one rebalance per index.
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
    const src = priceSource(provider, Contract);
    const prices = await src.getPrices();

    for (const index of INDICES) {
        const addr = vaults[index.id];
        if (!addr) {
            console.log(`[rebalancer] no vault for ${index.id}, skip`);
            continue;
        }
        const vault = new Contract(addr, art.abi, signer);
        const nonce = Number(await vault.nonce());
        const holdingsRaw = await vault.getHoldings();
        const symbols = Object.keys(index.weights);
        const holdings = {};
        symbols.forEach((s, i) => (holdings[s] = Number(holdingsRaw[i]) / 1e18));
        const ctx = {
            holdings,
            cashUsd: Number(await vault.cash()) / 1e6, // stub: 6-dec stable
            nonce,
            lastRebalanceAt: null,
            now: Date.now(),
        };
        const r = await tickIndex(index, ctx, prices, {vault, vaultAddr: addr});
        console.log(
            `[rebalancer] ${index.id}: ${r.rebalanced ? "rebalanced " + r.txHash : "held"} (${r.reason})`
        );
    }
}

async function main() {
    if (DRY) return runDry();
    return runLive();
}

// Exported for reuse by the orchestrator and tests.
export {tickIndex, currentWeightsBps, buildRebalanceCall, reasonFor};

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
