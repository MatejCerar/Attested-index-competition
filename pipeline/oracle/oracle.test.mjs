// Hermetic: a local ethers Wallet plays the enclave via the injectable signFn,
// and prices come from an injected fetcher. No network, no running tee-node.
import test from "node:test";
import assert from "node:assert/strict";
import {Wallet, getBytes, keccak256} from "ethers";
import {createOracle, verifyEnclaveAttestation, buildWeb2JsonRequest} from "./oracle.mjs";

const enclave = new Wallet("0x" + "ab".repeat(32));
const signFn = async (messageHex) => ({
    sig: await enclave.signMessage(getBytes(keccak256(messageHex))),
    recovered: enclave.address,
});
const FIXED = {AAPL: 123.45, "GC=F": 2410.3};
const fetchPrices = async (symbols) =>
    Object.fromEntries(symbols.filter((s) => FIXED[s]).map((s) => [s, FIXED[s]]));

test("enclave-signed: attestation verifies and recovers the enclave", async () => {
    const o = createOracle({mode: "enclave-signed", signFn, fetchPrices});
    const {prices, attestation} = await o.getAttestedPrices(["AAPL", "GC=F"]);
    assert.equal(prices.AAPL, 123.45);
    assert.equal(attestation.signer, enclave.address);
    assert.equal(attestation.pricesE18[0], String(BigInt(Math.round(123.45 * 1e18))));
    const v = verifyEnclaveAttestation(attestation);
    assert.equal(v.ok, true);
    assert.equal(v.recovered, enclave.address);
});

test("enclave-signed: a tampered price fails verification", async () => {
    const o = createOracle({mode: "enclave-signed", signFn, fetchPrices});
    const {attestation} = await o.getAttestedPrices(["AAPL"]);
    const bad = {...attestation, pricesE18: [String(BigInt(attestation.pricesE18[0]) + 1n)]};
    const v = verifyEnclaveAttestation(bad);
    assert.equal(v.ok, false);
    assert.notEqual(v.recovered, enclave.address);
});

test("enclave-signed: a tampered timestamp fails verification", async () => {
    const o = createOracle({mode: "enclave-signed", signFn, fetchPrices});
    const {attestation} = await o.getAttestedPrices(["AAPL"]);
    assert.equal(verifyEnclaveAttestation({...attestation, timestamp: attestation.timestamp + 1}).ok, false);
});

test("getPrices matches the index/prices.mjs contract", async () => {
    const o = createOracle({mode: "raw", fetchPrices});
    assert.deepEqual(await o.getPrices(["AAPL"]), {AAPL: 123.45});
});

test("raw mode: unattested", async () => {
    const o = createOracle({mode: "raw", fetchPrices});
    const {attestation} = await o.getAttestedPrices(["AAPL"]);
    assert.equal(attestation.mode, "raw");
    assert.equal(attestation.attested, false);
});

test("fdc mode: structured IWeb2Json.Proof stub and request builder", async () => {
    const o = createOracle({mode: "fdc", fetchPrices});
    const {attestation} = await o.getAttestedPrices(["AAPL"]);
    assert.equal(attestation.stub, true);
    const req = attestation.requests[0];
    assert.match(req.requestBody.url, /finance\/chart\/AAPL/);
    assert.equal(req.requestBody.httpMethod, "GET");
    assert.match(req.requestBody.postProcessJq, /regularMarketPrice/);
    const proof = attestation.proofs[0];
    assert.deepEqual(proof.merkleProof, []);
    assert.equal(proof.data.attestationType, req.attestationType);
    assert.ok(proof.data.responseBody.abiEncodedData.startsWith("0x"));
});

test("missing price throws instead of attesting a hole", async () => {
    const o = createOracle({mode: "enclave-signed", signFn, fetchPrices});
    await assert.rejects(() => o.getAttestedPrices(["AAPL", "NOPE"]), /no price for NOPE/);
});
