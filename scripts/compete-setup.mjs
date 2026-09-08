// On-chain setup for the live competition. Deploys MockUSDC, one
// MockUniswapV3Pool per distinct asset in the 5-index field, and one
// StableIndexVault per index; mints stable, deposits into each vault, seeds
// each pool to a baseline price, and writes the address maps the live engine
// reads (app/public/data/compete-onchain.json). The engine then pushes each
// tick's live price via pool.setPriceE18 and relays FCC-signed rebalances.
//
// Needs PK (a funded Coston2 key) and TEE_SIGN_URL (the FCC tee-node /sign).
// Off-chain mode (no PK): a clear no-op message, nothing deployed.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataDir = join(root, "app", "public", "data");

const PK = process.env.PK;
const RPC = process.env.RPC ?? "https://coston2-api.flare.network/ext/C/rpc";
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const CAPITAL = process.env.CAPITAL ? Number(process.env.CAPITAL) : 100000;
const USDC_DECIMALS = 6;
const toUsdc = (n) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

// The same 5-index field the live engine competes (ids + weights must match).
const catalog = JSON.parse(readFileSync(join(__dirname, "catalog.json"), "utf8"));
const byId = new Map(catalog.assets.map((a) => [a.id, a]));
const CRYPTO_SEED = {
    BTC: 76769.05, ETH: 2384.558, XRP: 1.330262, SOL: 99.0116,
    AVAX: 7.14331, DOGE: 0.081039, FLR: 0.00657099,
};
// The same 5 RWA indices the live engine competes. Keep in sync with the FIELD
// in scripts/live-engine.mjs (ids + weights must match so on-chain vaults line
// up with the engine's rebalances).
const FIELD = [
    {
        id: "mag-7-rwa",
        kind: "rwa",
        weights: {
            "NVDAx::backed-assets-je-limited": 25,
            "AAPLx::backed-assets-je-limited": 20,
            "MSFTx::backed-assets-je-limited": 20,
            "AMZNx::backed-assets-je-limited": 18,
            "GOOGLx::backed-assets-je-limited": 17,
        },
    },
    {
        id: "ai-semiconductors",
        kind: "rwa",
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
        kind: "rwa",
        weights: {
            "JPMx::backed-assets-je-limited": 35,
            "Vx::backed-assets-je-limited": 25,
            "MAx::backed-assets-je-limited": 25,
            "GSx::backed-assets-je-limited": 15,
        },
    },
    {
        id: "precious-metals",
        kind: "rwa",
        weights: {
            "XAUT0::usdt0-network-xaut0-deployments": 50,
            "SLV::robinhood-markets-inc": 25,
            "PPLTon::ondo-global-markets-bvi-limited": 15,
            "PALLx::backed-assets-je-limited": 10,
        },
    },
    {
        id: "tokenized-index-funds",
        kind: "rwa",
        weights: {
            "SPYx::backed-assets-je-limited": 50,
            "QQQx::backed-assets-je-limited": 35,
            "IWMx::backed-assets-je-limited": 15,
        },
    },
];

// Bare symbol used as the pool key (crypto id, or the catalog ticker).
function symOf(id, kind) {
    return kind === "crypto" ? id : byId.get(id).ticker;
}
function baseline(id, kind) {
    if (kind === "crypto") return CRYPTO_SEED[id] ?? 1;
    return byId.get(id)?.priceUsd ?? 1;
}

if (!PK) {
    console.log(
        "compete-setup: off-chain mode (no PK). No contracts deployed. The live " +
            "engine runs fully off-chain on live prices. Set PK + TEE_SIGN_URL to " +
            "deploy MockUSDC + pools + vaults and enable on-chain rebalances."
    );
    process.exit(0);
}

const {
    JsonRpcProvider, Wallet, Contract, ContractFactory, AbiCoder, getBytes,
    keccak256, verifyMessage, id: keccakId,
} = await import("ethers");
const abi = AbiCoder.defaultAbiCoder();

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

function artifact(name) {
    const a = JSON.parse(readFileSync(join(__dirname, "abi", `${name}.json`), "utf8"));
    return a;
}

async function main() {
    const provider = new JsonRpcProvider(RPC);
    const gov = new Wallet(PK, provider);
    console.log("compete-setup on Coston2, deployer:", gov.address);

    const usdcArt = artifact("MockUSDC");
    const poolArt = artifact("MockUniswapV3Pool");
    const vaultArt = artifact("IndexShareVault"); // ABI to talk to created vaults
    const factoryArt = artifact("VaultFactory");
    const usdcF = new ContractFactory(usdcArt.abi, usdcArt.bytecode, gov);
    const poolF = new ContractFactory(poolArt.abi, poolArt.bytecode, gov);
    const factoryF = new ContractFactory(
        factoryArt.abi, factoryArt.bytecode, gov
    );

    // Resolve the FCC tee signer (the rebalancer for every vault).
    const probe = await teeSign(abi.encode(["bytes32"], [keccakId("probe")]));
    const tee = probe.recovered;
    console.log("FCC rebalancer (tee) signer:", tee);

    const usdc = await usdcF.deploy();
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();
    console.log("MockUSDC:", usdcAddr);

    // One factory: every index vault it mints shares the FCC signer + stable.
    const factory = await factoryF.deploy(tee, usdcAddr);
    await factory.waitForDeployment();
    const factoryAddr = await factory.getAddress();
    console.log("VaultFactory:", factoryAddr);

    // One pool per distinct asset symbol, seeded to its baseline price.
    const symbols = new Set();
    for (const b of FIELD) for (const id of Object.keys(b.weights)) symbols.add(symOf(id, b.kind));
    const pools = {};
    for (const b of FIELD)
        for (const id of Object.keys(b.weights)) {
            const sym = symOf(id, b.kind);
            if (pools[sym]) continue;
            // A throwaway 18-decimals asset address per pool (sorted ordering only).
            const assetAddr = "0x" + keccak256(keccakId(sym)).slice(26);
            const pool = await poolF.deploy(assetAddr, usdcAddr, 18, 6, 3000);
            await pool.waitForDeployment();
            const addr = await pool.getAddress();
            await (await pool.seedPriceUsdE18(BigInt(Math.round(baseline(id, b.kind) * 1e18)))).wait();
            pools[sym] = addr;
            console.log(`  pool ${sym}: ${addr} seeded @ ${baseline(id, b.kind)}`);
        }

    // One vault per index, minted by the factory over that index's pools (in
    // weight order). Seed each with equal capital as the first deposit.
    const vaults = {};
    for (const b of FIELD) {
        const order = Object.keys(b.weights).map((id) => symOf(id, b.kind));
        const poolAddrs = order.map((sym) => pools[sym]);
        const tx = await factory.createVault(poolAddrs);
        const rec = await tx.wait();
        let vaultAddr;
        for (const log of rec.logs) {
            try {
                const p = factory.interface.parseLog(log);
                if (p && p.name === "VaultCreated") {
                    vaultAddr = p.args.vault;
                    break;
                }
            } catch {
                /* not our event */
            }
        }
        if (!vaultAddr) throw new Error(`no VaultCreated event for ${b.id}`);
        const vault = new Contract(vaultAddr, vaultArt.abi, gov);
        await (await usdc.mint(gov.address, toUsdc(CAPITAL))).wait();
        await (await usdc.approve(vaultAddr, toUsdc(CAPITAL))).wait();
        await (await vault.deposit(toUsdc(CAPITAL))).wait();
        vaults[b.id] = {addr: vaultAddr, order};
        console.log(`  vault ${b.id}: ${vaultAddr} deposited ${CAPITAL} mUSDC, order=[${order.join(",")}]`);
    }

    const cfg = {
        generatedAt: new Date().toISOString(),
        rpc: RPC,
        network: "Coston2 (chain 114)",
        stable: usdcAddr,
        factory: factoryAddr,
        tee,
        capital: CAPITAL,
        pools,
        vaults,
    };
    writeFileSync(join(dataDir, "compete-onchain.json"), JSON.stringify(cfg, null, 2) + "\n");
    console.log("\nwrote app/public/data/compete-onchain.json");
    console.log("Now run: PK=... TEE_SIGN_URL=... node scripts/live-engine.mjs (ON-CHAIN mode)");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
