// Enclave gateway: a thin CORS-enabled HTTP shim in front of the real Flare TEE
// extension server. It exposes the SAME /sign contract the index-competition
// scripts already speak (scripts/compete-setup.mjs, live-engine.mjs, orchestrate-add.mjs,
// rebalancer/rebalancer.mjs, enclave/teesign.mjs):
//
//   POST /sign      {message:b64}                       -> {signature:b64}
//   POST /rebalance {vault,nonce,weights,prices}        -> {signature:b64, ...}
//
// So enabling the real FCC TEE is purely config: set the project's
//   TEE_SIGN_URL = https://<slug>.trycloudflare.com/sign
// and nothing in server.mjs / the engines changes. The gateway builds the
// StableIndexVault preimage abi.encode(address vault, uint256 nonce,
// uint16[] weightsBps, uint256[] pricesE18), forwards it to the enclave, and the
// enclave computes keccak256(preimage) and EIP-191 signs it INSIDE the TEE with
// the key whose address == vault.rebalancer. The private key never leaves the TEE.
//
// /sign takes the already-abi-encoded preimage (base64 of the raw bytes) exactly
// like teesign.mjs sends it. /rebalance is a friendlier entry that builds the
// preimage here from {vault,nonce,weights,prices} then signs.
//
// No emojis, no em dashes.
import http from "node:http";
import { AbiCoder, getBytes, keccak256 } from "ethers";

const ENCLAVE = process.env.ENCLAVE_URL || "http://extension-tee:7702";
const PORT = Number(process.env.GATEWAY_PORT || 8799);
const abi = AbiCoder.defaultAbiCoder();

function bytes32(s) {
  const e = new TextEncoder().encode(s);
  const b = new Uint8Array(32);
  b.set(e);
  return "0x" + Buffer.from(b).toString("hex");
}
function utf8hex(s) {
  return "0x" + Buffer.from(s, "utf-8").toString("hex");
}
const OP_TYPE = bytes32("INDEX");
const OP_CMD = bytes32("REBALANCE");
const ID1 = "0x" + "00".repeat(31) + "01";

// abi.encode(address vault, uint256 nonce, uint16[] weightsBps, uint256[] pricesE18),
// byte-for-byte with StableIndexVault.rebalance's keccak256(abi.encode(...)).
function buildPreimage(vault, nonce, weightsBps, pricesE18) {
  return abi.encode(
    ["address", "uint256", "uint16[]", "uint256[]"],
    [vault, BigInt(nonce), weightsBps.map(Number), pricesE18.map((p) => BigInt(p))],
  );
}

// Ask the enclave to sign a rebalance and return the 65-byte signature (base64).
// The originalMessage is the abi-encoded preimage; the enclave hashes+signs it.
async function enclaveSign(preimageHex) {
  const originalMessage = preimageHex && preimageHex !== "0x" ? preimageHex : "0x";
  const dataFixed = { instructionId: ID1, opType: OP_TYPE, opCommand: OP_CMD, originalMessage };
  const action = {
    data: { id: ID1, type: "instruction", submissionTag: "submit", message: utf8hex(JSON.stringify(dataFixed)) },
  };
  const r = await fetch(`${ENCLAVE}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const jr = await r.json();
  const raw = jr.result ?? jr;
  if (raw.status !== 1 || !raw.data || raw.data === "0x") {
    throw new Error(`enclave status=${raw.status} log=${raw.log ?? ""}`);
  }
  // Handler returns hex-encoded UTF-8 JSON {digest, preimage, signature}.
  const json = JSON.parse(Buffer.from(getBytes(raw.data)).toString("utf-8"));
  const sig = getBytes(json.signature);
  return { signature: json.signature, digest: json.digest, sigB64: Buffer.from(sig).toString("base64") };
}

async function readBody(req) {
  let body = "";
  for await (const c of req) body += c;
  return body;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { res.writeHead(404); res.end("POST /sign or /rebalance"); return; }

  const url = (req.url || "").split("?")[0];
  try {
    const body = await readBody(req);
    const j = body ? JSON.parse(body) : {};

    // POST /sign {message:b64} -> {signature:b64}. message = abi-encoded preimage.
    if (url === "/sign") {
      if (typeof j.message !== "string") throw new Error("missing message (base64)");
      const preimageHex = "0x" + Buffer.from(j.message, "base64").toString("hex");
      const out = await enclaveSign(preimageHex);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ signature: out.sigB64 }));
      return;
    }

    // POST /rebalance {vault,nonce,weights,prices} -> {signature:b64, signatureHex, digest}.
    if (url === "/rebalance") {
      const { vault, nonce = 0, weights, prices } = j;
      if (!vault || !Array.isArray(weights) || !Array.isArray(prices)) {
        throw new Error("need {vault, nonce, weights[], prices[]}");
      }
      const preimageHex = buildPreimage(vault, nonce, weights, prices);
      const out = await enclaveSign(preimageHex);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ signature: out.sigB64, signatureHex: out.signature, digest: out.digest }));
      return;
    }

    res.writeHead(404); res.end("POST /sign or /rebalance");
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, () => console.log(`enclave-gateway on :${PORT} -> ${ENCLAVE} (/sign, /rebalance)`));
