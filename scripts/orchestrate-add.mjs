// Phase 2: make a user-submitted index REAL on-chain. Using the already-deployed
// shared stable + VaultFactory (from compete-onchain.json), this:
//   1. ensures a MockUniswapV3Pool exists for every asset in the basket,
//   2. mints a vault via factory.createVault(pools) (bound to the shared stable
//      + FCC signer, so the user's minted mUSDC can deposit into it),
//   3. registers the vault + any new pools back into compete-onchain.json so the
//      live engine reads its NAV and the FE shows an Invest button for it.
// The vault is created EMPTY: the user's own FE deposit is the only capital, and
// the live engine does the first rebalance at live prices (like the house
// indices), so there is no house seed money and no catalog-vs-live offset.
// Needs PK + TEE_SIGN_URL and a completed compete-setup (cfg.factory present).
import {readFileSync, writeFileSync, unlinkSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {
    JsonRpcProvider, Wallet, Contract, ContractFactory, AbiCoder, getBytes,
    keccak256, verifyMessage, id as keccakId,
} from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "app", "public", "data");
const cfgPath = join(dataDir, "compete-onchain.json");
const lockPath = join(dataDir, "deploy.lock");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

const isNonceErr = (e) =>
    /nonce|replacement|underpriced|already known/i.test(String(e?.message ?? e));

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

    // Reuse an existing vault for this index id: re-submitting the same index
    // must NOT mint a second (empty) vault that the engine would then read as $0
    // while the FE still points at the first one.
    const existing = cfg.vaults?.[basket.id];
    if (existing?.addr) {
        return {
            vault: existing.addr,
            order: existing.order ?? [],
            stable: cfg.stable,
            reused: true,
        };
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
    const pricesE18 = ids.map((id) => {
        const p = priceFor(id);
        if (!(p > 0)) throw new Error(`no price for ${id}`);
        return BigInt(Math.round(p * 1e18));
    });

    // Pause the live engine's on-chain writes (it shares this key), wait for its
    // in-flight txs to settle, then drive our own txs with explicit,
    // self-correcting nonces so the two processes never collide.
    writeFileSync(lockPath, String(Date.now()));
    await sleep(3000);
    try {
        // Wait until the account has no pending (in-flight) tx so our nonce base
        // is clean. The engine is paused by the lock, so this settles fast.
        let base;
        for (let i = 0; i < 20; i++) {
            const [pending, latest] = await Promise.all([
                provider.getTransactionCount(gov.address, "pending"),
                provider.getTransactionCount(gov.address, "latest"),
            ]);
            if (pending === latest) {
                base = latest;
                break;
            }
            await sleep(1500);
        }
        let nonce =
            base ?? (await provider.getTransactionCount(gov.address, "pending"));

        // Send with an explicit sequential nonce; on any nonce/replacement race
        // resync from the chain's pending count and retry the same step.
        const send = async (build) => {
            let last;
            for (let i = 0; i < 8; i++) {
                const n = nonce;
                try {
                    const rec = await (await build(n)).wait();
                    nonce = n + 1;
                    return rec;
                } catch (e) {
                    if (!isNonceErr(e)) throw e;
                    last = e;
                    await sleep(2000);
                    nonce = await provider.getTransactionCount(
                        gov.address,
                        "pending"
                    );
                }
            }
            throw last;
        };
        const deploy = async (factory, args) => {
            let last;
            for (let i = 0; i < 8; i++) {
                const n = nonce;
                try {
                    const c = await factory.deploy(...args, {nonce: n});
                    await c.waitForDeployment();
                    nonce = n + 1;
                    return c;
                } catch (e) {
                    if (!isNonceErr(e)) throw e;
                    last = e;
                    await sleep(2000);
                    nonce = await provider.getTransactionCount(
                        gov.address,
                        "pending"
                    );
                }
            }
            throw last;
        };

        // Ensure a pool per asset, seeded to its catalog price.
        const pools = {...(cfg.pools ?? {})};
        const newPools = {};
        for (let i = 0; i < ids.length; i++) {
            const sym = order[i];
            if (pools[sym]) continue;
            const assetAddr = "0x" + keccak256(keccakId(sym)).slice(26);
            const pool = await deploy(poolF, [assetAddr, cfg.stable, 18, 6, 3000]);
            const addr = await pool.getAddress();
            await send((n) => pool.seedPriceUsdE18(pricesE18[i], {nonce: n}));
            pools[sym] = addr;
            newPools[sym] = addr;
        }
        const poolAddrs = order.map((sym) => pools[sym]);

        // Mint the vault via the factory (shared stable + FCC signer).
        const rec = await send((n) => factory.createVault(poolAddrs, {nonce: n}));
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
        // No gov seed and no rebalance here: the vault starts empty, the user's
        // own deposit (from the FE) is the only capital, and the live engine
        // does the first rebalance at LIVE prices - same as the house indices,
        // so there is no catalog-vs-live valuation offset and no house money.

        // Register the vault + new pools so the engine reads NAV and the FE can
        // deposit. Re-read first to avoid clobbering a concurrent write.
        const liveCfg = JSON.parse(readFileSync(cfgPath, "utf8"));
        liveCfg.pools = {...(liveCfg.pools ?? {}), ...newPools};
        liveCfg.vaults = {
            ...(liveCfg.vaults ?? {}),
            [basket.id]: {addr: vaultAddr, order},
        };
        liveCfg.generatedAt = new Date().toISOString();
        writeFileSync(cfgPath, JSON.stringify(liveCfg, null, 2) + "\n");

        return {vault: vaultAddr, order, stable: cfg.stable};
    } finally {
        try {
            unlinkSync(lockPath);
        } catch {
            /* lock already removed */
        }
    }
}
