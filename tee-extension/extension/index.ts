/**
 * Index rebalance signer for the INDEX/REBALANCE extension.
 *
 * The enclave op is: given {vault, nonce, weightsBps[], pricesE18[]}, validate
 * the inputs and EIP-191 (personal_sign) sign the exact digest that
 * StableIndexVault.rebalance verifies:
 *
 *   digest = keccak256(abi.encode(
 *     address vault, uint256 nonce, uint16[] weightsBps, uint256[] pricesE18))
 *   sig    = personal_sign(digest)   // toEthSignedMessageHash(digest)
 *
 * The signer key is the enclave-held TEE key and its address MUST equal the
 * vault's `rebalancer`. See src/StableIndexVault.sol (rebalance()).
 *
 * No emojis, no em dashes (house style).
 */

import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// abi.encode(address vault, uint256 nonce, uint16[] weightsBps, uint256[] pricesE18)
// byte-for-byte with StableIndexVault.rebalance's keccak256(abi.encode(...)).
export const REBALANCE_ABI = [
  { name: "vault", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "weightsBps", type: "uint16[]" },
  { name: "pricesE18", type: "uint256[]" },
] as const;

export interface Rebalance {
  vault: Address;
  nonce: bigint;
  weightsBps: number[];
  pricesE18: bigint[];
}

/** ABI-encode the rebalance preimage (the bytes the vault hashes). */
export function encodeRebalance(r: Rebalance): Hex {
  return encodeAbiParameters(REBALANCE_ABI, [
    r.vault,
    r.nonce,
    r.weightsBps,
    r.pricesE18,
  ]);
}

/** keccak256 of the ABI-encoded preimage = the vault's inner digest `h`. */
export function rebalanceDigest(r: Rebalance): Hex {
  return keccak256(encodeRebalance(r));
}

/** Validate weights (n>0, equal lengths, sum == 10000) and prices (all > 0). */
export function validateRebalance(r: Rebalance): string | null {
  const n = r.weightsBps.length;
  if (n === 0) return "weightsBps must not be empty";
  if (r.pricesE18.length !== n) return "weightsBps and pricesE18 length mismatch";
  let sum = 0;
  for (const w of r.weightsBps) {
    if (!Number.isInteger(w) || w < 0 || w > 0xffff) return "weight out of uint16 range";
    sum += w;
  }
  if (sum !== 10000) return `weights must sum to 10000, got ${sum}`;
  for (const p of r.pricesE18) {
    if (p <= 0n) return "prices must be positive";
  }
  return null;
}

/**
 * EIP-191 personal_sign of the rebalance digest with the enclave-held TEE key.
 * The recovered signer must equal StableIndexVault.rebalancer.
 */
export async function signRebalance(
  r: Rebalance,
  teeSignerKey: Hex,
): Promise<Hex> {
  const account = privateKeyToAccount(teeSignerKey);
  return account.signMessage({ message: { raw: rebalanceDigest(r) } });
}
