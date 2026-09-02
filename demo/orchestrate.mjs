// Real rebalance: per index, deploy a SyntheticIndexVault, take a fee, deposit,
// then the FCC tee-node signs the target weights + prices and we relay an
// on-chain rebalance that actually moves the vault's holdings.
//
// Two kinds of index compete side by side:
//   - crypto baskets (baskets.mjs): priced on live FTSO feeds.
//   - user RWA baskets (user-baskets.json): built in the browser from the
//     tokenized-asset catalog. Each leg is priced FTSO-where-available, else
//     from the CSV snapshot in the catalog. The vault verifies a signature
//     over whatever prices the enclave supplies, so the price source is an
//     off-chain detail: the on-chain rebalance is identical either way.
//
// Without PK set, runs in preview mode: resolves prices and writes the
// leaderboard, but deploys/deposits nothing.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
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
const PREVIEW = !GOV_KEY; // no key -> resolve + write leaderboard, no on-chain tx
const DEPOSIT_FLR = 50;
const FEE_BPS = 200;

const CR_ABI = ["function getContractAddressByName(string) view returns (address)"];
const FTSO_ABI = ["function getFeedsById(bytes21[]) payable returns (uint256[], int8[], uint64)"];
const feedId = (s) => "0x01" + Buffer.from(`${s}/USD`, "utf8").toString("hex").padEnd(40, "0");
const drift = (b, s) => (-0.15 + (Number(BigInt(keccak256(toUtf8Bytes(`${b}:${s}:week1`))) % 10000n) / 10000) * 0.43);

// catalog + user-built RWA baskets
const CATALOG = JSON.parse(readFileSync(join(__dirname, "catalog.json"), "utf8"));
const catMap = new Map(CATALOG.assets.map((a) => [a.id, a]));
const userBaskets = existsSync(join(__dirname, "user-baskets.json"))
    ? JSON.parse(readFileSync(join(__dirname, "user-baskets.json"), "utf8"))
    : [];

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
    const cr = new Contract(CR, CR_ABI, provider);
    const ftsoAddr = await cr.getContractAddressByName("FtsoV2");
    const ftso = new Contract(ftsoAddr, FTSO_ABI, provider);

    // crypto FTSO baseline (the existing 7 assets)
    const [values, decimals] = await ftso.getFeedsById.staticCall(ASSETS.map(feedId));
    const px = {};
    ASSETS.forEach((s, i) => (px[s] = Number(values[i]) / 10 ** Number(decimals[i])));
    const flrUsd = px.FLR;
    console.log("FTSO baseline. FLR/USD =", flrUsd);

    // probe an RWA FTSO feed once; unknown feeds revert -> null -> CSV fallback
    const ftsoCache = new Map();
    async function tryFtso(sym) {
        if (ftsoCache.has(sym)) return ftsoCache.get(sym);
        let price = null;
        try {
            const [v, d] = await ftso.getFeedsById.staticCall([feedId(sym)]);
            const p = Number(v[0]) / 10 ** Number(d[0]);
            if (p > 0) price = p;
        } catch { /* feed not on this chain -> CSV */ }
        ftsoCache.set(sym, price);
        return price;
    }

    // resolve one leg of any basket to {key,label,price,source,assetClass,issuer}
    async function resolveLeg(basketKind, key) {
        if (basketKind !== "rwa") {
            return {key, label: key, price: px[key], source: "ftso", assetClass: "crypto", issuer: "FTSO"};
        }
        const a = catMap.get(key);
        if (!a) throw new Error(`unknown asset "${key}" - rebuild catalog?`);
        let price = null, source = null;
        if (a.ftso) { const p = await tryFtso(a.ftso); if (p) { price = p; source = "ftso"; } }
        if (price == null && a.priceUsd) { price = a.priceUsd; source = "csv"; }
        if (price == null) throw new Error(`no price for "${key}"`);
        return {key, label: a.ticker, price, source, assetClass: a.assetClass, issuer: a.issuerName};
    }

    // The competition is the RWA indices from user-baskets.json. The crypto
    // baskets (baskets.mjs) are opt-in via INCLUDE_CRYPTO=1 for a live-FTSO
    // comparison.
    const withCrypto = !!process.env.INCLUDE_CRYPTO;
    const entries = [
        ...(withCrypto ? BASKETS.map((b) => ({...b, kind: "crypto"})) : []),
        ...userBaskets.map((b) => ({...b, kind: "rwa"})),
    ];
    console.log(
        `competition: ${userBaskets.length} RWA indices` +
        (withCrypto ? ` + ${BASKETS.length} crypto (INCLUDE_CRYPTO)` : "")
    );

    let gov, platform, factory, art, teeSigner;
    if (!PREVIEW) {
        gov = new Wallet(GOV_KEY, provider);
        platform = gov.address;
        art = JSON.parse(readFileSync(join(__dirname, "abi", "SyntheticIndexVault.json"), "utf8"));
        factory = new ContractFactory(art.abi, art.bytecode, gov);
        const probe = await teeSign(abi.encode(["bytes32"], [keccakId("probe")]));
        teeSigner = probe.recovered;
        console.log("FCC rebalancer (tee) signer:", teeSigner);
    } else {
        console.log("PREVIEW mode (no PK): resolving prices and writing the leaderboard, no on-chain tx.");
    }

    let platformRevenue = 0;
    const rows = [];

    for (const b of entries) {
        const keys = Object.keys(b.weights);
        const legs = [];
        for (const k of keys) legs.push({...(await resolveLeg(b.kind, k)), weight: b.weights[k]});

        // integer % -> bps; fix any rounding drift on the last leg so sum == 10000
        const weightsBps = legs.map((l) => Math.round(l.weight * 100));
        const sumBps = weightsBps.reduce((a, x) => a + x, 0);
        if (sumBps !== 10000) weightsBps[weightsBps.length - 1] += 10000 - sumBps;
        const pricesE18 = legs.map((l) => BigInt(Math.round(l.price * 1e18)));
        const flrUsdE18 = BigInt(Math.round(flrUsd * 1e18));

        let vaultAddr = null, feeTx = null, depTx = null, rebTx = null, onchain = null, depositor = null;
        if (!PREVIEW) {
            const vault = await factory.deploy(teeSigner, legs.length);
            await vault.waitForDeployment();
            vaultAddr = await vault.getAddress();

            depositor = Wallet.createRandom().connect(provider);
            const fee = (DEPOSIT_FLR * FEE_BPS) / 10000;
            await (await gov.sendTransaction({to: depositor.address, value: parseEther(String(DEPOSIT_FLR + fee + 0.5))})).wait();
            feeTx = await (await depositor.sendTransaction({to: platform, value: parseEther(String(fee))})).wait();
            const vaultD = new Contract(vaultAddr, art.abi, depositor);
            depTx = await (await vaultD.deposit({value: parseEther(String(DEPOSIT_FLR))})).wait();
            platformRevenue += fee;

            const msg = abi.encode(
                ["address", "uint256", "uint16[]", "uint256[]", "uint256"],
                [vaultAddr, 0, weightsBps, pricesE18, flrUsdE18]
            );
            const {sig} = await teeSign(msg);
            rebTx = await (await new Contract(vaultAddr, art.abi, gov).rebalance(weightsBps, pricesE18, flrUsdE18, sig)).wait();
            onchain = await new Contract(vaultAddr, art.abi, provider).getHoldings();
        }

        // holdings the rebalance produces (read on-chain, or compute for preview)
        const nav = DEPOSIT_FLR * flrUsd;
        const positions = legs.map((l, i) => {
            const units = onchain
                ? Number(onchain[i]) / 1e18
                : (nav * (weightsBps[i] / 10000)) / l.price;
            return {sym: l.label, weight: l.weight, units, basePx: l.price, source: l.source,
                assetClass: l.assetClass, issuer: l.issuer, drift: drift(b.id, l.key)};
        });
        const startUsd = positions.reduce((a, p) => a + p.units * p.basePx, 0);
        const endUsd = positions.reduce((a, p) => a + p.units * p.basePx * (1 + p.drift), 0);
        const weekReturn = startUsd > 0 ? endUsd / startUsd - 1 : 0;
        const fee = (DEPOSIT_FLR * FEE_BPS) / 10000;

        console.log(
            `${b.id} [${b.kind}]: ${legs.map((l) => `${l.label} ${l.weight}%(${l.source})`).join(" ")}` +
            (PREVIEW ? "" : ` -> vault ${vaultAddr} rebalanced tx=${rebTx.hash}`)
        );
        rows.push({
            id: b.id, name: b.name, prompt: b.prompt, kind: b.kind,
            vault: vaultAddr, depositor: depositor?.address, aumFlr: DEPOSIT_FLR,
            aumUsd: DEPOSIT_FLR * flrUsd, feeFlr: fee, feeTx: feeTx?.hash, depositTx: depTx?.hash,
            rebalanceTx: rebTx?.hash, positions, weekReturn,
        });
    }

    rows.sort((a, b) => b.weekReturn - a.weekReturn);
    rows.forEach((r, i) => (r.rank = i + 1));

    const data = {
        generatedAt: new Date().toISOString(), network: "Coston2 (chain 114)",
        ftso: ftsoAddr, registry: CR, platform: platform ?? null, rebalancer: teeSigner ?? null,
        attestedBy: PREVIEW
            ? "preview (no on-chain rebalance) - set PK + run the tee-node to attest"
            : "real Flare tee-node v0.0.24 (FCC) - signs each on-chain rebalance",
        preview: PREVIEW, feeBps: FEE_BPS,
        platformRevenueFlr: PREVIEW ? entries.length * (DEPOSIT_FLR * FEE_BPS) / 10000 : platformRevenue,
        flrUsd, baseline: px, baskets: rows,
    };
    writeFileSync(join(__dirname, "frontend", "data.js"), "window.DEMO = " + JSON.stringify(data, null, 2) + ";\n");
    if (!PREVIEW) console.log(`\nPLATFORM REVENUE: ${platformRevenue} C2FLR to ${platform}`);
    console.log("wrote frontend/data.js");
}
main().catch((e) => { console.error(e); process.exit(1); });
