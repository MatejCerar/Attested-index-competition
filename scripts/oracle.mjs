// Pluggable price oracle. createOracle({mode}) returns the same
// getPrices(symbols) -> {SYM: number} contract as index/prices.mjs, plus
// getAttestedPrices(symbols) -> {prices, attestation}. Three modes:
//   enclave-signed  (default) TEE fetches + signs; trust = the rebalance signer
//   fdc             FDC Web2Json attestation of the web fetch (per-rebalance)
//   raw             unattested feed for the fast display path
// Symbols are underlying market symbols (AAPL, GC=F), never token tickers.
import {AbiCoder, ZeroHash, encodeBytes32String, getBytes, keccak256, verifyMessage} from "ethers";
import {fetchYahoo} from "./prices.mjs";
import {getTokenPrices} from "./token-prices.mjs";
import {teeSign} from "../enclave/teesign.mjs";

const abi = AbiCoder.defaultAbiCoder();
const nowSec = () => Math.floor(Date.now() / 1000);

export const toE18 = (p) => BigInt(Math.round(p * 1e18));
export const toE6 = (p) => Math.round(p * 1e6);

// The exact payload SignedPriceOracle.setPrice re-hashes on-chain.
export function encodePricePayload(symbols, pricesE18, timestamp) {
    return abi.encode(["string[]", "uint256[]", "uint256"], [symbols, pricesE18, timestamp]);
}

// Local check of an enclave-signed attestation: recover the signer from the
// eth-personal-message over keccak256(payload), same as the on-chain gate.
export function verifyEnclaveAttestation(a) {
    const payload = encodePricePayload(a.symbols, a.pricesE18.map(BigInt), a.timestamp);
    const recovered = verifyMessage(getBytes(keccak256(payload)), a.signature);
    return {ok: recovered.toLowerCase() === a.signer.toLowerCase(), recovered};
}

// Per-symbol price ratio cur/prev; symbols with prev <= 0 (or no cur) are
// skipped. This is the "ratio of price" the exploit check inspects.
export function priceRatios(symbols, prevPx, curPx) {
    const out = {};
    for (const s of symbols || []) {
        const prev = prevPx?.[s];
        const cur = curPx?.[s];
        if (!(prev > 0) || !(cur > 0)) continue;
        out[s] = cur / prev;
    }
    return out;
}

// First asset whose one-step move exceeds maxStepMoveBps (|ratio-1| >
// maxStepMoveBps/10000), or null when every step is within bounds.
export function stepAnomaly(ratios, maxStepMoveBps = 2500) {
    const lim = maxStepMoveBps / 10000;
    for (const [sym, ratio] of Object.entries(ratios || {})) {
        if (Math.abs(ratio - 1) > lim) return {sym, ratio};
    }
    return null;
}

// Tiered 24/7 pricing with compare. PRIMARY = the tokenized asset's real
// venue price (Jupiter/CoinGecko, trades nights + weekends). FALLBACK = the
// Yahoo underlying reference. When both exist, premium = token/ref - 1; the
// token price wins while fresh and inside the band (a generous band: normal
// off-hours premium passes, stale or garbage prints are rejected to the ref).
// Returns {SYM: {price, source: "token"|"yahoo", ref, premium}}. Never throws.
export async function getComparedPrices(symbols, {
    band = 0.25,
    maxAgeMs = 15 * 60_000,
    fetchRef = fetchYahoo,
    fetchTok = getTokenPrices,
} = {}) {
    const uniq = [...new Set(symbols)];
    const [tok, ref] = await Promise.all([
        Promise.resolve().then(() => fetchTok(uniq)).catch(() => ({})),
        Promise.resolve().then(() => fetchRef(uniq)).catch(() => ({})),
    ]);
    const now = Date.now();
    const out = {};
    for (const s of uniq) {
        const t = tok[s];
        const r = ref[s] > 0 ? ref[s] : null;
        const fresh = t?.price > 0 && now - t.ts <= maxAgeMs;
        if (fresh && r) {
            const premium = t.price / r - 1;
            out[s] = Math.abs(premium) <= band
                ? {price: t.price, source: "token", ref: r, premium}
                : {price: r, source: "yahoo", ref: r, premium};
        } else if (fresh) {
            out[s] = {price: t.price, source: "token", ref: null, premium: null};
        } else if (r) {
            out[s] = {price: r, source: "yahoo", ref: r, premium: null};
        }
    }
    return out;
}

// Working Web2Json request builder against the Yahoo chart endpoint. jq scales
// the price to an integer at 1e6 (jq numbers are doubles, 1e18 would lose
// precision); the consumer rescales to 1e18. messageIntegrityCode is derived
// from the expected response at submit time, so it is zero until the round-trip.
const PRICE_JQ = "{price: (.chart.result[0].meta.regularMarketPrice * 1000000 | round)}";
const PRICE_ABI_SIG =
    '{"components":[{"internalType":"uint256","name":"price","type":"uint256"}],"internalType":"struct PriceData","name":"data","type":"tuple"}';
export function buildWeb2JsonRequest(symbol, {url} = {}) {
    return {
        attestationType: encodeBytes32String("Web2Json"),
        sourceId: encodeBytes32String("PublicWeb2"),
        messageIntegrityCode: ZeroHash,
        requestBody: {
            url: url ?? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
            httpMethod: "GET",
            headers: "{}",
            queryParams: "{}",
            body: "{}",
            postProcessJq: PRICE_JQ,
            abiSignature: PRICE_ABI_SIG,
        },
    };
}

// signFn(messageHex) -> {sig, recovered} is injectable so tests run without a
// live enclave; the default posts to the tee-node /sign like everything else.
export function createOracle({
    mode = "enclave-signed",
    signUrl = process.env.TEE_SIGN_URL,
    signFn,
    fetchPrices = fetchYahoo,
} = {}) {
    const sign = signFn ?? ((messageHex) => teeSign(signUrl, messageHex));

    async function getPrices(symbols) {
        return fetchPrices(symbols);
    }

    async function attestEnclave(symbols, prices) {
        const timestamp = nowSec();
        const pricesE18 = symbols.map((s) => toE18(prices[s]));
        const {sig, recovered} = await sign(encodePricePayload(symbols, pricesE18, timestamp));
        return {
            mode: "enclave-signed",
            symbols,
            prices,
            pricesE18: pricesE18.map(String),
            timestamp,
            signature: sig,
            signer: recovered,
        };
    }

    // Structured stub modeling IWeb2Json.Proof. TODO(fdc): the real round-trip
    // goes here - submit each request via FdcHub.requestAttestation, wait for
    // the voting round to finalize (~90s+), fetch {merkleProof, response} from
    // the DA layer, then verify with IWeb2JsonVerification.verifyWeb2Json.
    function attestFdc(symbols, prices) {
        const timestamp = nowSec();
        const requests = symbols.map((s) => buildWeb2JsonRequest(s));
        const proofs = symbols.map((s, i) => ({
            merkleProof: [],
            data: {
                attestationType: requests[i].attestationType,
                sourceId: requests[i].sourceId,
                votingRound: 0,
                lowestUsedTimestamp: timestamp,
                requestBody: requests[i].requestBody,
                responseBody: {abiEncodedData: abi.encode(["uint256"], [toE6(prices[s])])},
            },
        }));
        return {mode: "fdc", symbols, prices, timestamp, requests, proofs, stub: true};
    }

    async function getAttestedPrices(symbols) {
        const prices = await getPrices(symbols);
        const missing = symbols.filter((s) => !(prices[s] > 0));
        if (missing.length) throw new Error(`no price for ${missing.join(", ")}`);
        if (mode === "raw") return {prices, attestation: {mode: "raw", attested: false, timestamp: nowSec()}};
        if (mode === "fdc") return {prices, attestation: attestFdc(symbols, prices)};
        return {prices, attestation: await attestEnclave(symbols, prices)};
    }

    return {mode, getPrices, getAttestedPrices, verify: verifyEnclaveAttestation};
}
