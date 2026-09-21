/**
 * Epoch attestation for the INDEX/BUILD op: run the deterministic index build
 * inside the enclave and sign the exact EpochAttestation that
 * src/AttestedEpochRegistry.sol:submitEpoch verifies:
 *
 *   h   = keccak256(abi.encode(bytes32 seriesId, uint64 epochId,
 *           bytes32 manifestHash, bytes32 outputRoot,
 *           bytes32 codeMeasurement, uint64 producedAt))
 *   sig = personal_sign(h)     // ECDSA.toEthSignedMessageHash(h)
 *
 * outputRoot is a Merkle root over one leaf per constituent, byte-for-byte
 * with src/libs/IndexWeightLeaf.sol:
 *
 *   leaf = keccak256(abi.encode(bytes32 id, uint16 weightBps))
 *
 * The tree is built over the leaf hashes sorted ascending, pairs hashed
 * OZ-commutative (sorted concat), so proofs verify with the registry's
 * MerkleProof.verify and the root is independent of build output order.
 * manifestHash = keccak256 of the frozen matrix csv bytes.
 */

import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { buildIndexBps, parseCsv, type IndexConfig } from "./build-index.js";

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/** Series name -> keccak256(utf8) (as enclave/deterministic.mjs seriesId());
 *  a bytes32 hex string passes through unchanged. */
export function seriesIdOf(s: string): Hex {
  return BYTES32_RE.test(s) ? (s.toLowerCase() as Hex) : keccak256(stringToHex(s));
}

/** keccak256 of the frozen matrix bytes: pins the exact input data. */
export function manifestHashOf(matrixCsv: string): Hex {
  return keccak256(stringToHex(matrixCsv));
}

/** Ticker as Solidity bytes32("TICK"): utf8 right-zero-padded. */
export function tickerToBytes32(id: string): Hex {
  return stringToHex(id, { size: 32 });
}

/** One leaf per constituent, byte-for-byte with IndexWeightLeaf.hash. */
export function indexWeightLeaf(id: string, weightBps: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint16" }],
      [tickerToBytes32(id), weightBps],
    ),
  );
}

/** OZ MerkleProof's commutative pair hash. */
function hashPair(a: Hex, b: Hex): Hex {
  const [x, y] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concatHex([x, y]));
}

/** Root over the leaves sorted ascending (canonical: input-order free). */
export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) throw new Error("no leaves");
  let level = leaves.map((l) => l.toLowerCase() as Hex).sort();
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(
        i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!,
      );
    level = next;
  }
  return level[0]!;
}

/** outputRoot over (id, weightBps) pairs. */
export function indexOutputRoot(ids: string[], weightsBps: number[]): Hex {
  return merkleRoot(ids.map((id, i) => indexWeightLeaf(id, weightsBps[i]!)));
}

/** Mirrors AttestedEpochRegistry.EpochAttestation field for field. */
export interface EpochAttestation {
  seriesId: Hex;
  epochId: bigint;
  manifestHash: Hex;
  outputRoot: Hex;
  codeMeasurement: Hex;
  producedAt: bigint;
}

// abi.encode field order MUST match AttestedEpochRegistry._digest exactly.
export const EPOCH_ATTESTATION_ABI = [
  { name: "seriesId", type: "bytes32" },
  { name: "epochId", type: "uint64" },
  { name: "manifestHash", type: "bytes32" },
  { name: "outputRoot", type: "bytes32" },
  { name: "codeMeasurement", type: "bytes32" },
  { name: "producedAt", type: "uint64" },
] as const;

/** The bytes the registry hashes (attestationMessage in deterministic.mjs). */
export function encodeEpochAttestation(att: EpochAttestation): Hex {
  return encodeAbiParameters(EPOCH_ATTESTATION_ABI, [
    att.seriesId,
    att.epochId,
    att.manifestHash,
    att.outputRoot,
    att.codeMeasurement,
    att.producedAt,
  ]);
}

/** Inner digest h; submitEpoch recovers over toEthSignedMessageHash(h). */
export function epochDigest(att: EpochAttestation): Hex {
  return keccak256(encodeEpochAttestation(att));
}

/** EIP-191 personal_sign of the epoch digest with the enclave TEE key. */
export async function signEpochAttestation(
  att: EpochAttestation,
  teeSignerKey: Hex,
): Promise<Hex> {
  const account = privateKeyToAccount(teeSignerKey);
  return account.signMessage({ message: { raw: epochDigest(att) } });
}

export interface IndexBuildInput {
  seriesId: string;
  epochId: bigint;
  config: IndexConfig;
  matrixCsv: string;
  producedAt: bigint;
  codeMeasurement: Hex;
}

export interface BuiltEpoch {
  ids: string[];
  weightsBps: number[];
  att: EpochAttestation;
  preimage: Hex;
  digest: Hex;
}

/** The whole deterministic build, run inside the enclave: matrix + config ->
 *  weights -> leaves -> outputRoot -> signable attestation preimage. Pure, so
 *  N replicas agree and the registry finalizes on agreement. */
export function buildIndexEpoch(input: IndexBuildInput): BuiltEpoch {
  const { tickers, weightsBps } = buildIndexBps(
    parseCsv(input.matrixCsv),
    input.config,
  );
  const att: EpochAttestation = {
    seriesId: seriesIdOf(input.seriesId),
    epochId: input.epochId,
    manifestHash: manifestHashOf(input.matrixCsv),
    outputRoot: indexOutputRoot(tickers, weightsBps),
    codeMeasurement: input.codeMeasurement,
    producedAt: input.producedAt,
  };
  const preimage = encodeEpochAttestation(att);
  return {
    ids: tickers,
    weightsBps,
    att,
    preimage,
    digest: keccak256(preimage),
  };
}

/** REBALANCE gate: null if (ids, weightsBps) equal the deterministic build of
 *  (matrixCsv, config), else the refusal reason. Order-insensitive: compares
 *  the id -> bps mapping, since the vault's asset order may differ from the
 *  canonical (bps desc, id asc) build order. */
export function weightsMatchBuild(
  ids: string[],
  weightsBps: number[],
  matrixCsv: string,
  config: IndexConfig,
): string | null {
  if (ids.length !== weightsBps.length)
    return "ids and weightsBps length mismatch";
  let built: { tickers: string[]; weightsBps: number[] };
  try {
    built = buildIndexBps(parseCsv(matrixCsv), config);
  } catch (e) {
    return `deterministic build failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (ids.length !== built.tickers.length)
    return "weights do not match deterministic build";
  const want = new Map(built.tickers.map((t, i) => [t, built.weightsBps[i]]));
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    if (seen.has(ids[i]!)) return "weights do not match deterministic build";
    seen.add(ids[i]!);
    if (want.get(ids[i]!) !== weightsBps[i])
      return "weights do not match deterministic build";
  }
  return null;
}
