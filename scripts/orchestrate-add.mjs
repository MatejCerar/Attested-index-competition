// Phase 2: make a user-submitted index REAL on-chain. Using the already-deployed
// shared stable + VaultFactory (from compete-onchain.json), this:
//   1. ensures a MockUniswapV3Pool exists for every asset in the basket,
//   2. mints a vault via factory.createVault(pools) (bound to the shared stable
//      + FCC signer, so the user's minted mUSDC can deposit into it),
//   3. seeds it with an initial deposit and one FCC-signed rebalance,
//   4. registers the vault + any new pools back into compete-onchain.json so the
//      live engine reads its NAV and the FE shows an Invest button for it.
// Needs PK + TEE_SIGN_URL and a completed compete-setup (cfg.factory present).
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {
    JsonRpcProvider, Wallet, Contract, ContractFactory, AbiCoder, getBytes,
    keccak256, verifyMessage, id as keccakId,
} from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(__dirname, "..", "app", "public", "data", "compete-onchain.json");
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

const load = (n) => JSON.parse(readFileSync(join(__dirname, "abi", n), "utf8"));

// Deploy (if needed) + register a real vault for one basket. opts:
// {depositUsd, feeBps, priceFor, symFor} where priceFor/symFor take a catalog id.
export async function scoreBasketOnChain(
    basket,
    {depositUsd = 1000, feeBps = 200, priceFor, symFor}
) {
    const PK = process.env.PK;
    if (!PK) throw new Error("scoreBasketOnChain needs PK");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    if (!cfg.factory || !cfg.stable) {
        throw new Error("compete-onchain.json missing factory/stable - run compete-setup");
    }

    const provider = new JsonRpcProvider(cfg.rpc ?? RPC);
    const gov = new Wallet(PK, provider);
    const poolArt = load("MockUniswapV3Pool.json");
    const usdcArt = load("MockUSDC.json");
    const factoryArt = load("VaultFactory.json");
    const vaultArt = load("IndexShareVault.json");

    const usdc = new Contract(cfg.stable, usdcArt.abi, gov);
    const factory = new Contract(cfg.factory, factoryArt.abi, gov);
    const poolF = new ContractFactory(poolArt.abi, poolArt.bytecode, gov);

    const ids = Object.keys(basket.weights);
    const order = ids.map((id) => symFor(id)); // tickers, pool + vault order
    const weightsBps = ids.map((id) => basket.weights[id] * 100); // sum 10000
    const pricesE18 = ids.map((id) => {
        const p = priceFor(id);
        if (!(p > 0)) throw new Error(`no price for ${id}`);
        return BigInt(Math.round(p * 1e18));
    });

    // Ensure a pool per asset, seeded to its catalog price.
    const pools = {...(cfg.pools ?? {})};
    const newPools = {};
    for (let i = 0; i < ids.length; i++) {
        const sym = order[i];
        if (pools[sym]) continue;
        const assetAddr = "0x" + keccak256(keccakId(sym)).slice(26);
        const pool = await poolF.deploy(assetAddr, cfg.stable, 18, 6, 3000);
        await pool.waitForDeployment();
        const addr = await pool.getAddress();
        await (await pool.seedPriceUsdE18(pricesE18[i])).wait();
        pools[sym] = addr;
        newPools[sym] = addr;
    }
    const poolAddrs = order.map((sym) => pools[sym]);

    // Mint the vault via the factory (shared stable + FCC signer).
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
    if (!vaultAddr) throw new Error("no VaultCreated event");
    const vault = new Contract(vaultAddr, vaultArt.abi, gov);

    // Seed initial capital + one FCC-signed rebalance (nonce 0).
    await (await usdc.mint(gov.address, toUsdc(depositUsd))).wait();
    await (await usdc.approve(vaultAddr, toUsdc(depositUsd))).wait();
    const depTx = await (await vault.deposit(toUsdc(depositUsd))).wait();
    const msg = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [vaultAddr, 0, weightsBps, pricesE18]
    );
    const {sig} = await teeSign(msg);
    const rebTx = await (await vault.rebalance(weightsBps, pricesE18, sig)).wait();

    // Register the vault + new pools so the engine reads NAV and the FE can
    // deposit. Re-read the file first to avoid clobbering a concurrent write.
    const live = JSON.parse(readFileSync(cfgPath, "utf8"));
    live.pools = {...(live.pools ?? {}), ...newPools};
    live.vaults = {...(live.vaults ?? {}), [basket.id]: {addr: vaultAddr, order}};
    live.generatedAt = new Date().toISOString();
    writeFileSync(cfgPath, JSON.stringify(live, null, 2) + "\n");

    return {
        vault: vaultAddr,
        order,
        stable: cfg.stable,
        depositTx: depTx.hash,
        rebalanceTx: rebTx.hash,
    };
}
