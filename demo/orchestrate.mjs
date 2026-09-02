// Real rebalance: per index, deploy a SyntheticIndexVault, take a fee, deposit,
// then the FCC tee-node signs the target weights and we relay an on-chain
// rebalance that actually moves the vault's holdings. Priced on live FTSO.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {
    JsonRpcProvider, Wallet, Contract, ContractFactory, AbiCoder, keccak256,
    toUtf8Bytes, getBytes, verifyMessage, id as keccakId, parseEther,
} from "ethers";
import {ASSETS, BASKETS} from "./baskets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const CR = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const GOV_KEY = process.env.PK;
const DEPOSIT_FLR = 50;
const FEE_BPS = 200;

const CR_ABI = ["function getContractAddressByName(string) view returns (address)"];
const FTSO_ABI = ["function getFeedsById(bytes21[]) payable returns (uint256[], int8[], uint64)"];
const feedId = (s) => "0x01" + Buffer.from(`${s}/USD`, "utf8").toString("hex").padEnd(40, "0");
const drift = (b, s) => (-0.15 + (Number(BigInt(keccak256(toUtf8Bytes(`${b}:${s}:week1`))) % 10000n) / 10000) * 0.43);

async function teeSign(messageHex, retries = 30) {
    const b64 = Buffer.from(getBytes(messageHex)).toString("base64");
    let last;
    for (let i = 0; i < retries; i++) {
        try {
            const r = await fetch(TEE_SIGN_URL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({message: b64})});
            if (!r.ok) throw new Error(`sign ${r.status}`);
            const j = await r.json();
            const sig = Buffer.from(j.signature, "base64");
            if (sig[64] < 27) sig[64] += 27;
            const sigHex = "0x" + sig.toString("hex");
            return {sig: sigHex, recovered: verifyMessage(getBytes(keccak256(messageHex)), sigHex)};
        } catch (e) { last = e; await new Promise((x) => setTimeout(x, 1000)); }
    }
    throw last;
}

async function main() {
    const provider = new JsonRpcProvider(RPC);
    const gov = new Wallet(GOV_KEY, provider);
    const platform = gov.address;
    const art = JSON.parse(readFileSync(join(__dirname, "abi", "SyntheticIndexVault.json"), "utf8"));
    const factory = new ContractFactory(art.abi, art.bytecode, gov);

    const cr = new Contract(CR, CR_ABI, provider);
    const ftsoAddr = await cr.getContractAddressByName("FtsoV2");
    const ftso = new Contract(ftsoAddr, FTSO_ABI, provider);
    const [values, decimals] = await ftso.getFeedsById.staticCall(ASSETS.map(feedId));
    const px = {};
    ASSETS.forEach((s, i) => (px[s] = Number(values[i]) / 10 ** Number(decimals[i])));
    const flrUsd = px.FLR;
    console.log("FTSO baseline. FLR/USD =", flrUsd);

    const probe = await teeSign(abi.encode(["bytes32"], [keccakId("probe")]));
    const teeSigner = probe.recovered;
    console.log("FCC rebalancer (tee) signer:", teeSigner);

    let platformRevenue = 0;
    const rows = [];

    for (const b of BASKETS) {
        const syms = Object.keys(b.weights);
        const feeds = syms.map(feedId);
        const weightsBps = syms.map((s) => b.weights[s] * 100);

        // deploy the vault, rebalancer = the FCC tee signer
        const vault = await factory.deploy(teeSigner, syms.length);
        await vault.waitForDeployment();
        const vaultAddr = await vault.getAddress();
        const pricesE18 = syms.map((s) => BigInt(Math.round(px[s] * 1e18)));
        const flrUsdE18 = BigInt(Math.round(flrUsd * 1e18));

        // depositor funded -> pays fee to platform -> deposits into the vault
        const depositor = Wallet.createRandom().connect(provider);
        const fee = (DEPOSIT_FLR * FEE_BPS) / 10000;
        await (await gov.sendTransaction({to: depositor.address, value: parseEther(String(DEPOSIT_FLR + fee + 0.5))})).wait();
        const feeTx = await (await depositor.sendTransaction({to: platform, value: parseEther(String(fee))})).wait();
        const vaultD = new Contract(vaultAddr, art.abi, depositor);
        const depTx = await (await vaultD.deposit({value: parseEther(String(DEPOSIT_FLR))})).wait();
        platformRevenue += fee;

        // FCC signs (vault, nonce, weights, prices); relay the REAL rebalance
        const msg = abi.encode(
            ["address", "uint256", "uint16[]", "uint256[]", "uint256"],
            [vaultAddr, 0, weightsBps, pricesE18, flrUsdE18]
        );
        const {sig} = await teeSign(msg);
        const rebTx = await (await new Contract(vaultAddr, art.abi, gov).rebalance(weightsBps, pricesE18, flrUsdE18, sig)).wait();

        // read the ACTUAL on-chain holdings after the rebalance
        const onchain = await new Contract(vaultAddr, art.abi, provider).getHoldings();
        const positions = syms.map((s, i) => {
            const units = Number(onchain[i]) / 1e18;
            const d = drift(b.id, s);
            return {sym: s, weight: b.weights[s], units, basePx: px[s], drift: d};
        });
        const startUsd = positions.reduce((a, p) => a + p.units * p.basePx, 0);
        const endUsd = positions.reduce((a, p) => a + p.units * p.basePx * (1 + p.drift), 0);
        const weekReturn = startUsd > 0 ? endUsd / startUsd - 1 : 0;

        console.log(`${b.id}: vault ${vaultAddr} deposited ${DEPOSIT_FLR} C2FLR, rebalanced on-chain tx=${rebTx.hash}`);
        rows.push({
            ...b, vault: vaultAddr, depositor: depositor.address, aumFlr: DEPOSIT_FLR,
            aumUsd: DEPOSIT_FLR * flrUsd, feeFlr: fee, feeTx: feeTx.hash, depositTx: depTx.hash,
            rebalanceTx: rebTx.hash, positions, weekReturn,
        });
    }

    rows.sort((a, b) => b.weekReturn - a.weekReturn);
    rows.forEach((r, i) => (r.rank = i + 1));

    const data = {
        generatedAt: new Date().toISOString(), network: "Coston2 (chain 114)",
        ftso: ftsoAddr, platform, rebalancer: teeSigner,
        attestedBy: "real Flare tee-node v0.0.24 (FCC) - signs each on-chain rebalance",
        feeBps: FEE_BPS, platformRevenueFlr: platformRevenue, flrUsd, baseline: px, baskets: rows,
    };
    writeFileSync(join(__dirname, "frontend", "data.js"), "window.DEMO = " + JSON.stringify(data, null, 2) + ";\n");
    console.log(`\nPLATFORM REVENUE: ${platformRevenue} C2FLR to ${platform}`);
    console.log("wrote frontend/data.js");
}
main().catch((e) => { console.error(e); process.exit(1); });
