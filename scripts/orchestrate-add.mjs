// Real Coston2 deposit + FCC-signed rebalance for a single submitted basket.
// Same shape as orchestrate-rebalance.mjs, scoped to one index so the server can
// score an /api/add on-chain when PK + TEE_SIGN_URL are set. Deploys MockUSDC +
// a StableIndexVault, deposits, has the FCC tee-node sign (vault,nonce,weights,
// prices), relays the rebalance, and returns the vault + tx hashes. Testnet.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {
    JsonRpcProvider, Wallet, ContractFactory, AbiCoder, getBytes, keccak256,
    verifyMessage,
} from "ethers";
import {weightsToBps} from "../index/weights.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();
const RPC = process.env.RPC ?? "https://coston2-api.flare.network/ext/C/rpc";
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const USDC_DECIMALS = 6;
const toUsdc = (n) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

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
            return {sig: sigHex, recovered: verifyMessage(getBytes(keccak256(messageHex)), sigHex)};
        } catch (e) {
            last = e;
            await new Promise((x) => setTimeout(x, 1000));
        }
    }
    throw last;
}

// Deploy + deposit + rebalance one basket. opts: {depositUsd, feeBps, priceFor}.
export async function scoreBasketOnChain(basket, {depositUsd = 1000, feeBps = 200, priceFor}) {
    const PK = process.env.PK;
    if (!PK) throw new Error("scoreBasketOnChain needs PK");
    const provider = new JsonRpcProvider(RPC);
    const gov = new Wallet(PK, provider);

    const load = (n) => JSON.parse(readFileSync(join(__dirname, "abi", n), "utf8"));
    const vaultArt = load("StableIndexVault.json");
    const usdcArt = load("MockUSDC.json");
    const F = (art) => new ContractFactory(art.abi, art.bytecode, gov);

    const syms = Object.keys(basket.weights);
    const bpsMap = weightsToBps(basket.weights);
    const weightsBps = syms.map((s) => bpsMap[s]);
    const pricesE18 = syms.map((s) => {
        const p = priceFor(s);
        if (!(p > 0)) throw new Error(`no price for ${s}`);
        return BigInt(Math.round(p * 1e18));
    });

    const usdc = await F(usdcArt).deploy();
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();

    const probe = await teeSign(abi.encode(["bytes32"], [keccak256(getBytes("0x00"))]));
    const teeSigner = probe.recovered;

    const vault = await F(vaultArt).deploy(teeSigner, usdcAddr, syms.length);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();

    const fee = (depositUsd * feeBps) / 10000;
    await (await usdc.mint(gov.address, toUsdc(fee))).wait();
    await (await usdc.mint(gov.address, toUsdc(depositUsd))).wait();
    await (await usdc.approve(vaultAddr, toUsdc(depositUsd))).wait();
    const depTx = await (await vault.deposit(toUsdc(depositUsd))).wait();

    const msg = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [vaultAddr, 0, weightsBps, pricesE18]
    );
    const {sig} = await teeSign(msg);
    const rebTx = await (await vault.rebalance(weightsBps, pricesE18, sig)).wait();

    return {
        vault: vaultAddr, stable: usdcAddr, rebalancer: teeSigner,
        depositTx: depTx.hash, rebalanceTx: rebTx.hash,
    };
}
