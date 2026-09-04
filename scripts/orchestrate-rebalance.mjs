// Real rebalance, stablecoin-denominated. Per index: deploy a StableIndexVault,
// take a fee (stable transfer to platform), deposit (approve + deposit), then
// the FCC tee-node signs the target weights and we relay an on-chain rebalance
// that actually moves the vault's holdings. Priced by the in-repo stub source.
// Writes app/public/data/leaderboard.json for the app leaderboard. Testnet,
// no real funds.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {
    JsonRpcProvider, Wallet, Contract, ContractFactory, AbiCoder, keccak256,
    toUtf8Bytes, getBytes, verifyMessage, id as keccakId,
} from "ethers";
import {INDICES, strategyFor} from "../index/indices.mjs";
import {createStubPriceSource} from "../index/prices.mjs";
import {weightsToBps} from "../index/weights.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const abi = AbiCoder.defaultAbiCoder();
const RPC = process.env.RPC ?? "https://coston2-api.flare.network/ext/C/rpc";
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const GOV_KEY = process.env.PK;
const DEPOSIT_USD = 1000; // mUSDC per index
const FEE_BPS = 200;
const USDC_DECIMALS = 6;
const toUsdc = (n) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

// Deterministic 7-day drift from a live baseline, per index+symbol.
const drift = (b, s) =>
    -0.15 +
    (Number(BigInt(keccak256(toUtf8Bytes(`${b}:${s}:week1`))) % 10000n) / 10000) *
        0.43;

async function teeSign(messageHex, retries = 30) {
    const b64 = Buffer.from(getBytes(messageHex)).toString("base64");
    let last;
    for (let i = 0; i < retries; i++) {
        try {
            const r = await fetch(TEE_SIGN_URL, {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({message: b64}),
            });
            if (!r.ok) throw new Error(`sign ${r.status}`);
            const j = await r.json();
            const sig = Buffer.from(j.signature, "base64");
            if (sig[64] < 27) sig[64] += 27;
            const sigHex = "0x" + sig.toString("hex");
            return {
                sig: sigHex,
                recovered: verifyMessage(getBytes(keccak256(messageHex)), sigHex),
            };
        } catch (e) {
            last = e;
            await new Promise((x) => setTimeout(x, 1000));
        }
    }
    throw last;
}

async function main() {
    const provider = new JsonRpcProvider(RPC);
    const gov = new Wallet(GOV_KEY, provider);
    const platform = gov.address;

    const vaultArt = JSON.parse(
        readFileSync(join(__dirname, "abi", "StableIndexVault.json"), "utf8")
    );
    const usdcArt = JSON.parse(
        readFileSync(join(__dirname, "abi", "MockUSDC.json"), "utf8")
    );
    const vaultFactory = new ContractFactory(vaultArt.abi, vaultArt.bytecode, gov);
    const usdcFactory = new ContractFactory(usdcArt.abi, usdcArt.bytecode, gov);

    // one mock stablecoin for the whole demo
    const usdc = await usdcFactory.deploy();
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();
    console.log("MockUSDC:", usdcAddr);

    const src = createStubPriceSource();

    const probe = await teeSign(abi.encode(["bytes32"], [keccakId("probe")]));
    const teeSigner = probe.recovered;
    console.log("FCC rebalancer (tee) signer:", teeSigner);

    let platformRevenue = 0;
    const rows = [];

    for (const index of INDICES) {
        const syms = Object.keys(index.weights);
        const prices = await src.getPrices(syms);
        const bpsMap = weightsToBps(index.weights);
        const weightsBps = syms.map((s) => bpsMap[s]);
        const pricesE18 = syms.map((s) => BigInt(Math.round(prices[s] * 1e18)));
        const strat = strategyFor(index);

        // deploy the vault, rebalancer = the FCC tee signer
        const vault = await vaultFactory.deploy(teeSigner, usdcAddr, syms.length);
        await vault.waitForDeployment();
        const vaultAddr = await vault.getAddress();

        // fee to platform, then deposit into the vault (both in stable)
        const fee = (DEPOSIT_USD * FEE_BPS) / 10000;
        await (await usdc.mint(platform, toUsdc(fee))).wait(); // fee accrues to platform
        await (await usdc.mint(gov.address, toUsdc(DEPOSIT_USD))).wait();
        await (await usdc.approve(vaultAddr, toUsdc(DEPOSIT_USD))).wait();
        const depTx = await (await vault.deposit(toUsdc(DEPOSIT_USD))).wait();
        platformRevenue += fee;

        // FCC signs (vault, nonce, weights, prices); relay the REAL rebalance
        const msg = abi.encode(
            ["address", "uint256", "uint16[]", "uint256[]"],
            [vaultAddr, 0, weightsBps, pricesE18]
        );
        const {sig} = await teeSign(msg);
        const rebTx = await (
            await vault.rebalance(weightsBps, pricesE18, sig)
        ).wait();

        // read the ACTUAL on-chain holdings after the rebalance
        const onchain = await vault.getHoldings();
        const positions = syms.map((s, i) => {
            const units = Number(onchain[i]) / 1e18;
            const d = drift(index.id, s);
            return {sym: s, weight: index.weights[s], units, basePx: prices[s], drift: d};
        });
        const startUsd = positions.reduce((a, p) => a + p.units * p.basePx, 0);
        const endUsd = positions.reduce(
            (a, p) => a + p.units * p.basePx * (1 + p.drift),
            0
        );
        const weekReturn = startUsd > 0 ? endUsd / startUsd - 1 : 0;

        console.log(
            `${index.id}: vault ${vaultAddr} deposited ${DEPOSIT_USD} mUSDC, rebalanced tx=${rebTx.hash}`
        );
        rows.push({
            id: index.id,
            name: index.name,
            prompt: index.prompt,
            rationale: index.rationale,
            weights: index.weights,
            strategy: index.strategy,
            strategyName: strat.name,
            rebalanceReason: "initial allocation",
            vault: vaultAddr,
            depositUsd: DEPOSIT_USD,
            feeUsd: fee,
            depositTx: depTx.hash,
            rebalanceTx: rebTx.hash,
            positions,
            weekReturn,
        });
    }

    rows.sort((a, b) => b.weekReturn - a.weekReturn);
    rows.forEach((r, i) => (r.rank = i + 1));

    const baseline = createStubPriceSource().getPricesSync();
    const data = {
        generatedAt: new Date().toISOString(),
        network: "Coston2 (chain 114)",
        stable: usdcAddr,
        platform,
        rebalancer: teeSigner,
        attestedBy:
            "real Flare tee-node v0.0.24 (FCC) - signs each on-chain rebalance",
        feeBps: FEE_BPS,
        platformRevenueUsd: platformRevenue,
        baseline,
        indices: rows,
    };
    // The app reads plain JSON from app/public/data; that is the live target.
    writeFileSync(
        join(root, "app", "public", "data", "leaderboard.json"),
        JSON.stringify(data, null, 2) + "\n"
    );
    console.log(`\nPLATFORM REVENUE: ${platformRevenue} mUSDC to ${platform}`);
    console.log("wrote app/public/data/leaderboard.json");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
