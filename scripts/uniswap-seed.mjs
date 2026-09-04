// Prove the vault can price and rebalance on Uniswap V3 pool prices. One
// MockUniswapV3Pool per index asset, paired with MockUSDC, each seeded from the
// stub USD baseline. The Uniswap price source reads each pool's slot0 back to a
// USD price; an asset with no pool falls back to the off-chain source. A signed
// rebalance is then built on the pool-derived prices (the same call the vault
// executes).
//
// Offline (default): deploys nothing. Seeds sqrtPriceX96 in-process, reads it
// back through createUniswapPriceSource with an in-memory Contract shim, and
// prints the recovered prices + one built rebalance call. Deterministic.
//
// Live (PK set): deploys MockUSDC + one MockUniswapV3Pool per asset on Coston2,
// seeds each pool on-chain, reads them with a real ethers provider, then relays
// a real FCC-signed rebalance. Testnet only.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {ASSETS} from "../index/assets.mjs";
import {getPricesSync} from "../index/prices.mjs";
import {
    createUniswapPriceSource,
    createStubPriceSource,
    sqrtPriceX96ToUsd,
} from "../index/prices.mjs";
import {weightsToBps} from "../index/weights.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PK = process.env.PK;

// Compute the seeded sqrtPriceX96 a MockUniswapV3Pool would hold for a target
// USD price. Mirrors MockUniswapV3Pool.sqrtPriceX96For exactly (BigInt).
function seedSqrtPriceX96(priceUsdE18, assetIsToken0, ad, sd) {
    let num, den;
    if (assetIsToken0) {
        num = priceUsdE18 * 10n ** BigInt(sd);
        den = 10n ** 18n * 10n ** BigInt(ad);
    } else {
        num = 10n ** 18n * 10n ** BigInt(ad);
        den = priceUsdE18 * 10n ** BigInt(sd);
    }
    const r = bigSqrt((num << 96n) / den);
    return r << 48n;
}
function bigSqrt(v) {
    if (v < 2n) return v;
    let x0 = v / 2n;
    let x1 = (x0 + v / x0) / 2n;
    while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + v / x0) / 2n;
    }
    return x0;
}

// An in-memory ethers-Contract shim so the real price source runs offline.
function makeShimFactory(poolState) {
    return function Contract(address) {
        const st = poolState[address];
        return {
            slot0: async () => [BigInt(st.sqrtPriceX96), 0n, 0, 1, 1, 0, true],
            assetIsToken0: async () => st.assetIsToken0,
            assetDecimals: async () => st.assetDecimals,
            stableDecimals: async () => st.stableDecimals,
        };
    };
}

async function runOffline() {
    // The seed index: all 7 crypto assets, priced by the stub baseline, plus a
    // deliberately pool-less asset ("NOPOOL") to exercise the fallback.
    const priced = ASSETS;
    const baseline = getPricesSync(priced);
    const stableDecimals = 6;
    const assetDecimals = 18;

    // Seed one pool per asset. Alternate token ordering to cover both branches.
    const pools = {};
    const poolState = {};
    priced.forEach((s, i) => {
        const addr = `0xpool${i}`;
        const assetIsToken0 = i % 2 === 0;
        const priceE18 = BigInt(Math.round(baseline[s] * 1e18));
        const sp = seedSqrtPriceX96(priceE18, assetIsToken0, assetDecimals, stableDecimals);
        pools[s] = addr;
        poolState[addr] = {sqrtPriceX96: sp, assetIsToken0, assetDecimals, stableDecimals};
    });

    const src = createUniswapPriceSource({
        provider: {},
        pools,
        fallbackSource: createStubPriceSource(),
        Contract: makeShimFactory(poolState),
    });

    // Ask for the pooled assets plus one with no pool.
    const symbols = [...priced, "NOPOOL"];
    const stubFallback = {
        getPrices: async () => ({NOPOOL: 42.5}), // stand-in off-chain price
    };
    const srcWithFb = createUniswapPriceSource({
        provider: {},
        pools,
        fallbackSource: stubFallback,
        Contract: makeShimFactory(poolState),
    });

    const prices = await srcWithFb.getPrices(symbols);
    console.log("Uniswap-pool prices (read back from seeded slot0):");
    for (const s of priced) {
        const got = prices[s];
        const target = baseline[s];
        const err = (Math.abs(got - target) / target) * 100;
        console.log(
            `  ${s.padEnd(5)} pool=${got.toFixed(6).padStart(14)} ` +
                `target=${target.toFixed(6).padStart(14)} (${err.toFixed(4)}%) ` +
                `[${srcWithFb.sources[s]}]`
        );
    }
    console.log(
        `  NOPOOL pool=${prices.NOPOOL} [${srcWithFb.sources.NOPOOL}] ` +
            `<- no pool, off-chain fallback`
    );

    // Build one signed-shape rebalance call on the pool prices (weights over the
    // priced crypto assets), exactly what the vault rebalance() consumes.
    const weights = {BTC: 40, ETH: 30, SOL: 15, XRP: 10, FLR: 5};
    const bps = weightsToBps(weights);
    const syms = Object.keys(weights);
    const pricesE18 = syms.map((s) => BigInt(Math.round(prices[s] * 1e18)));
    console.log("\nRebalance call built on pool prices:");
    console.log("  weightsBps:", syms.map((s) => `${s}=${bps[s]}`).join(" "));
    console.log(
        "  pricesE18 :",
        syms.map((s, i) => `${s}=${pricesE18[i]}`).join(" ")
    );
    console.log(
        "\nProof: the vault would receive these pool-derived pricesE18 in its " +
            "signed rebalance(weightsBps, pricesE18, sig) call. Run with PK set " +
            "to deploy the pools + relay a real Coston2 rebalance."
    );
}

async function runLive() {
    const {
        JsonRpcProvider, Wallet, Contract, ContractFactory, AbiCoder, keccak256,
        getBytes, verifyMessage, id: keccakId,
    } = await import("ethers");
    const abi = AbiCoder.defaultAbiCoder();
    const RPC = process.env.RPC ?? "https://coston2-api.flare.network/ext/C/rpc";
    const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
    const provider = new JsonRpcProvider(RPC);
    const gov = new Wallet(PK, provider);

    const load = (n) =>
        JSON.parse(readFileSync(join(__dirname, "abi", n), "utf8"));
    const usdcArt = load("MockUSDC.json");
    const poolArt = load("MockUniswapV3Pool.json");
    const vaultArt = load("StableIndexVault.json");
    const F = (art) => new ContractFactory(art.abi, art.bytecode, gov);

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

    const usdc = await F(usdcArt).deploy();
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();
    console.log("MockUSDC:", usdcAddr);

    const weights = {BTC: 40, ETH: 30, SOL: 15, XRP: 10, FLR: 5};
    const syms = Object.keys(weights);
    const baseline = getPricesSync(syms);

    // Deploy + seed one pool per asset. Use a per-asset placeholder token addr
    // (the asset side is not moved in this synthetic demo, only its price feed).
    const pools = {};
    const poolAddrs = {};
    for (const s of syms) {
        // A throwaway asset token = MockUSDC clone stands in as the asset side.
        const assetTok = await F(usdcArt).deploy();
        await assetTok.waitForDeployment();
        const assetAddr = await assetTok.getAddress();
        const pool = await F(poolArt).deploy(assetAddr, usdcAddr, 6, 6, 3000);
        await pool.waitForDeployment();
        const paddr = await pool.getAddress();
        await (await pool.seedPriceUsdE18(BigInt(Math.round(baseline[s] * 1e18)))).wait();
        pools[s] = paddr;
        poolAddrs[s] = paddr;
        console.log(`pool ${s}:`, paddr);
    }

    const src = createUniswapPriceSource({
        provider,
        pools,
        fallbackSource: createStubPriceSource(),
        Contract,
    });
    const prices = await src.getPrices(syms);
    console.log("read pool prices:", prices, "sources:", src.sources);

    // FCC signer + vault
    const probe = await teeSign(abi.encode(["bytes32"], [keccakId("probe")]));
    const teeSigner = probe.recovered;
    const vault = await F(vaultArt).deploy(teeSigner, usdcAddr, syms.length);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();

    const DEP = 1000n * 10n ** 6n;
    await (await usdc.mint(gov.address, DEP)).wait();
    await (await usdc.approve(vaultAddr, DEP)).wait();
    await (await vault.deposit(DEP)).wait();

    const bps = weightsToBps(weights);
    const weightsBps = syms.map((s) => bps[s]);
    const pricesE18 = syms.map((s) => BigInt(Math.round(prices[s] * 1e18)));
    const msg = abi.encode(
        ["address", "uint256", "uint16[]", "uint256[]"],
        [vaultAddr, 0, weightsBps, pricesE18]
    );
    const {sig} = await teeSign(msg);
    const tx = await (await vault.rebalance(weightsBps, pricesE18, sig)).wait();
    console.log("REBALANCED on Uniswap-pool prices, tx:", tx.hash);
    console.log("vault:", vaultAddr, "holdings:", (await vault.getHoldings()).map(String));
}

(PK ? runLive() : runOffline()).catch((e) => {
    console.error(e);
    process.exit(1);
});
