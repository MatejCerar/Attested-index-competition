/**
 * MAIN CUSTOMIZATION POINT: your extension's handlers.
 *
 * Mirrors go/internal/extension/extension.go. Each handler follows the same
 * 4-step pattern: decode, validate, execute, respond.
 *
 * Handler contract:
 *   (originalMessageHex) => [dataHexOrNull, status, errorOrNull]
 *   status 0 = error, 1 = success. See docs/extension-contract.md 4.6.
 *
 * The framework serializes handler calls, so plain module-level state is safe.
 */

import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { Framework, HandlerResult } from "../base/types.js";

import { decodeSayGoodbye } from "./abi.js";
import {
  DEFAULT_MAX_STEP_MOVE_BPS,
  encodeRebalance,
  priceStepGuard,
  rebalanceDigest,
  signRebalance,
  validateRebalance,
  type Rebalance,
} from "./index.js";
import {
  buildIndexEpoch,
  signEpochAttestation,
  weightsMatchBuild,
  type BuiltEpoch,
} from "./epoch.js";
import type { IndexConfig } from "./build-index.js";
import {
  OP_COMMAND_BUILD,
  OP_COMMAND_REBALANCE,
  OP_COMMAND_SAY_GOODBYE,
  OP_COMMAND_SAY_HELLO,
  OP_TYPE_GREETING,
  OP_TYPE_INDEX,
} from "./config.js";

// --- Extension state ---------------------------------------------------------
// Serialized by the framework; no locking needed here.
let greetingCount = 0;
let lastGreeting = "";
let farewellCount = 0;
let lastFarewell = "";

// INDEX/REBALANCE state. Kept separate from the conformance-pinned greeting
// state so reportState() (compared byte-for-byte by the conformance fixtures)
// is never changed.
let rebalanceCount = 0;
let lastDigest = "";
let indexBuildCount = 0;
let lastOutputRoot = "";
// Last SIGNED price vector per vault (lowercased address), for the price-step
// guard. First rebalance for a vault has no prior, so the check is skipped.
const lastPricesByVault = new Map<string, bigint[]>();

/** Reset all state. Used by tests; not part of the wire contract. */
export function resetState(): void {
  greetingCount = 0;
  lastGreeting = "";
  farewellCount = 0;
  lastFarewell = "";
  rebalanceCount = 0;
  lastDigest = "";
  indexBuildCount = 0;
  lastOutputRoot = "";
  lastPricesByVault.clear();
}

/** Wire handlers to (opType, opCommand) pairs. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_HELLO, handleSayHello);
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_GOODBYE, handleSayGoodbye);
  framework.handle(OP_TYPE_INDEX, OP_COMMAND_REBALANCE, handleIndexRebalance);
  framework.handle(OP_TYPE_INDEX, OP_COMMAND_BUILD, handleIndexBuild);
}

/**
 * Snapshot returned by GET /state. Mirrors the Go State struct.
 *
 * DO NOT add fields here: the conformance fixtures compare this byte-for-byte.
 * Rebalance state is exposed separately via reportRebalanceState().
 */
export function reportState(): unknown {
  return {
    greetingCount,
    lastGreeting,
    farewellCount,
    lastFarewell,
  };
}

/** Rebalance counter, kept out of the conformance-pinned reportState(). */
export function reportRebalanceState(): unknown {
  return {
    rebalanceCount,
    lastDigest,
  };
}

/** Build counter, kept out of the conformance-pinned reportState(). */
export function reportIndexBuildState(): unknown {
  return {
    indexBuildCount,
    lastOutputRoot,
  };
}

/** GREETING/SAY_HELLO - JSON payload {"name": "..."}. */
export function handleSayHello(msg: string): HandlerResult {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let req: unknown;
  try {
    req = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }

  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }

  // Match Go's DisallowUnknownFields.
  const unknown = Object.keys(req).filter((k) => k !== "name").sort();
  if (unknown.length > 0) {
    return [null, 0, `decoding request: unknown field "${unknown[0]}"`];
  }

  // 2. Validate
  const name = (req as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  greetingCount++;
  const greeting = `Hello, ${name}! Welcome to Flare Confidential Compute.`;
  lastGreeting = greeting;

  // 4. Respond
  const resp = { greeting, greetingNumber: greetingCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

/** GREETING/SAY_GOODBYE - ABI-encoded (string name, string reason). */
export function handleSayGoodbye(msg: string): HandlerResult {
  // 1. Decode
  let hex: string;
  try {
    // Normalize through hexToBytes so malformed input fails here, not in viem.
    hex = bytesToHex(hexToBytes(msg));
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let decoded: { name: string; reason: string };
  try {
    decoded = decodeSayGoodbye(hex as `0x${string}`);
  } catch (e) {
    return [null, 0, `decoding request: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 2. Validate
  if (!decoded.name) {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  farewellCount++;
  const farewell = `Goodbye, ${decoded.name}! Reason: ${decoded.reason}`;
  lastFarewell = farewell;

  // 4. Respond
  const resp = { farewell, farewellNumber: farewellCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

/**
 * INDEX/REBALANCE - EIP-191 sign the StableIndexVault rebalance digest, but
 * ONLY for weights the enclave can reproduce from the frozen matrix.
 *
 * The message is a hex-encoded UTF-8 JSON envelope:
 *   {"vault": "0x..", "nonce": <n>, "weightsBps": [uint16...],
 *    "pricesE18": ["<dec>"...], "ids": ["TICK"...],
 *    "config": IndexConfig, "matrixCsv": "id,sector,...\n...",
 *    "maxStepMoveBps": <optional, default 2500>}
 * ids[i] names the constituent weightsBps[i] belongs to. Before signing, the
 * enclave recomputes buildIndexBps(matrixCsv, config) and refuses ("weights do
 * not match deterministic build") unless the requested id -> bps mapping
 * equals the recomputed one. It also refuses ("price step exceeds guard") any
 * per-asset price step beyond maxStepMoveBps vs the last vector it signed for
 * the vault (priceStepGuard; the first rebalance has no prior and skips).
 * Only then it builds the preimage
 *   abi.encode(address vault, uint256 nonce, uint16[] weightsBps, uint256[] pricesE18),
 * signs keccak256(preimage) with the TEE key (whose address == vault.rebalancer),
 * and returns a JSON {digest, preimage, signature} (signature 0x + 65 bytes,
 * response shape unchanged so the existing on-chain relay keeps working).
 */
export async function handleIndexRebalance(msg: string): Promise<HandlerResult> {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }

  const obj = parsed as {
    vault?: unknown;
    nonce?: unknown;
    weightsBps?: unknown;
    pricesE18?: unknown;
    ids?: unknown;
    config?: unknown;
    matrixCsv?: unknown;
    maxStepMoveBps?: unknown;
  };
  if (typeof obj.vault !== "string") return [null, 0, "vault must be an address string"];
  if (!Array.isArray(obj.weightsBps)) return [null, 0, "weightsBps must be an array"];
  if (!Array.isArray(obj.pricesE18)) return [null, 0, "pricesE18 must be an array"];
  if (!Array.isArray(obj.ids) || obj.ids.some((t) => typeof t !== "string")) {
    return [null, 0, "ids must be an array of constituent id strings"];
  }
  if (typeof obj.config !== "object" || obj.config === null || Array.isArray(obj.config)) {
    return [null, 0, "config must be the index config object"];
  }
  if (typeof obj.matrixCsv !== "string" || obj.matrixCsv === "") {
    return [null, 0, "matrixCsv must be the frozen feature matrix csv"];
  }

  let rebalance: Rebalance;
  try {
    rebalance = {
      vault: obj.vault as `0x${string}`,
      nonce: BigInt((obj.nonce ?? 0) as string | number),
      weightsBps: obj.weightsBps.map((w) => Number(w)),
      pricesE18: obj.pricesE18.map((p) => BigInt(p as string | number)),
    };
  } catch (e) {
    return [null, 0, `decoding request: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 2. Validate
  const bad = validateRebalance(rebalance);
  if (bad) return [null, 0, bad];

  // The gate: recompute the deterministic build in-enclave and refuse to sign
  // any weights that are not its exact output.
  const mismatch = weightsMatchBuild(
    obj.ids as string[],
    rebalance.weightsBps,
    obj.matrixCsv,
    obj.config as IndexConfig,
  );
  if (mismatch) return [null, 0, mismatch];

  // Price-step guard: refuse a per-asset jump beyond maxStepMoveBps vs the
  // last vector this enclave signed for the vault (default 2500 = 25%).
  const maxStepMoveBps =
    typeof obj.maxStepMoveBps === "number" &&
    Number.isFinite(obj.maxStepMoveBps) &&
    obj.maxStepMoveBps > 0
      ? obj.maxStepMoveBps
      : DEFAULT_MAX_STEP_MOVE_BPS;
  const vaultKey = rebalance.vault.toLowerCase();
  const stepErr = priceStepGuard(
    lastPricesByVault.get(vaultKey),
    rebalance.pricesE18,
    maxStepMoveBps,
    obj.ids as string[],
  );
  if (stepErr) return [null, 0, stepErr];

  // Enclave-held config: the rebalancer key (== vault.rebalancer). Optionally
  // pin the vault so the enclave refuses to sign for any other vault.
  const signerKey = process.env.TEE_REBALANCER_KEY as `0x${string}` | undefined;
  const pinnedVault = process.env.INDEX_VAULT as `0x${string}` | undefined;
  if (!signerKey) return [null, 0, "TEE_REBALANCER_KEY not set in enclave"];
  if (pinnedVault && pinnedVault.toLowerCase() !== rebalance.vault.toLowerCase()) {
    return [null, 0, "vault not permitted by enclave"];
  }

  // 3. Sign
  let preimage: string;
  let digest: string;
  let signature: string;
  try {
    preimage = encodeRebalance(rebalance);
    digest = rebalanceDigest(rebalance);
    signature = await signRebalance(rebalance, signerKey);
  } catch (e) {
    return [null, 0, `rebalance sign failed: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 4. Respond
  rebalanceCount++;
  lastDigest = digest;
  lastPricesByVault.set(vaultKey, rebalance.pricesE18.slice());
  const resp = { digest, preimage, signature };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;

/**
 * INDEX/BUILD - run the deterministic index build INSIDE the enclave and sign
 * the EpochAttestation that AttestedEpochRegistry.submitEpoch verifies.
 *
 * The message is a hex-encoded UTF-8 JSON envelope:
 *   {"seriesId": "<name or 0x bytes32>", "epochId": <uint64>,
 *    "config": IndexConfig, "matrixCsv": "id,sector,...\n...",
 *    "producedAt": <unix seconds>}
 *
 * The enclave recomputes buildIndexBps(matrixCsv, config), Merkle-roots the
 * (id, weightBps) leaves (IndexWeightLeaf scheme), sets manifestHash =
 * keccak256(matrixCsv), and personal_signs the registry digest with the TEE
 * key. codeMeasurement is enclave-owned: env MEASUREMENT, never the caller.
 * Response: {weightsBps, ids, outputRoot, manifestHash, signature, preimage}.
 */
export async function handleIndexBuild(msg: string): Promise<HandlerResult> {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }

  const obj = parsed as {
    seriesId?: unknown;
    epochId?: unknown;
    config?: unknown;
    matrixCsv?: unknown;
    producedAt?: unknown;
  };

  // 2. Validate
  if (typeof obj.seriesId !== "string" || obj.seriesId === "") {
    return [null, 0, "seriesId must be a series name or bytes32 hex"];
  }
  if (typeof obj.config !== "object" || obj.config === null || Array.isArray(obj.config)) {
    return [null, 0, "config must be the index config object"];
  }
  if (typeof obj.matrixCsv !== "string" || obj.matrixCsv === "") {
    return [null, 0, "matrixCsv must be the frozen feature matrix csv"];
  }
  let epochId: bigint;
  let producedAt: bigint;
  try {
    epochId = BigInt(obj.epochId as string | number);
    producedAt = BigInt(obj.producedAt as string | number);
  } catch (e) {
    return [null, 0, `decoding request: ${e instanceof Error ? e.message : String(e)}`];
  }
  if (epochId < 0n || epochId > UINT64_MAX) return [null, 0, "epochId out of uint64 range"];
  if (producedAt < 0n || producedAt > UINT64_MAX) return [null, 0, "producedAt out of uint64 range"];

  const signerKey = process.env.TEE_REBALANCER_KEY as `0x${string}` | undefined;
  const measurement = process.env.MEASUREMENT;
  if (!signerKey) return [null, 0, "TEE_REBALANCER_KEY not set in enclave"];
  if (!measurement || !BYTES32_RE.test(measurement)) {
    return [null, 0, "MEASUREMENT not set in enclave"];
  }

  // 3. Execute + sign
  let built: BuiltEpoch;
  let signature: string;
  try {
    built = buildIndexEpoch({
      seriesId: obj.seriesId,
      epochId,
      config: obj.config as IndexConfig,
      matrixCsv: obj.matrixCsv,
      producedAt,
      codeMeasurement: measurement as `0x${string}`,
    });
    signature = await signEpochAttestation(built.att, signerKey);
  } catch (e) {
    return [null, 0, `index build failed: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 4. Respond
  indexBuildCount++;
  lastOutputRoot = built.att.outputRoot;
  const resp = {
    weightsBps: built.weightsBps,
    ids: built.ids,
    outputRoot: built.att.outputRoot,
    manifestHash: built.att.manifestHash,
    signature,
    preimage: built.preimage,
  };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}
