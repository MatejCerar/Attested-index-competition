# tee-extension: the INDEX/REBALANCE FCC signer

Ready-to-deploy source for signing the index rebalance inside a real Flare
Confidential Compute (FCC) TEE on Coston2, using the `fce-extension-scaffold`.

The enclave op is INDEX/REBALANCE. Given `{vault, nonce, weightsBps[], pricesE18[]}`
the enclave validates the inputs and EIP-191 (personal_sign) signs the exact
digest that `src/StableIndexVault.sol` verifies:

```
digest = keccak256(abi.encode(
  address vault, uint256 nonce, uint16[] weightsBps, uint256[] pricesE18))
sig    = personal_sign(digest)        // ECDSA.toEthSignedMessageHash(digest)
recover(sig) == StableIndexVault.rebalancer
```

The signing key is held INSIDE the TEE and its address is the vault's
`rebalancer`. So a valid `rebalance()` on-chain is proof the plan was signed in
the enclave, not by a hot key on a laptop.

## This is ADDITIVE and enabled by CONFIG only

Nothing in `scripts/server.mjs`, the engines, or `rebalancer/rebalancer.mjs` is
touched. Those already POST to `TEE_SIGN_URL` with `{message:b64}` and expect
`{signature:b64}` (see `enclave/teesign.mjs`, `scripts/compete-setup.mjs`). The
`enclave-gateway.mjs` here exposes exactly that `/sign` contract in front of the
real enclave. Enabling the real TEE = point `TEE_SIGN_URL` at the gateway:

```
export TEE_SIGN_URL=https://<slug>.trycloudflare.com/sign
```

No code change anywhere in the project.

## What is in this folder

| Path | What it is |
| --- | --- |
| `extension/config.ts` | Adds `OP_TYPE_INDEX` / `OP_COMMAND_REBALANCE` (bytes32 of "INDEX"/"REBALANCE") next to the Hello World constants. |
| `extension/index.ts` | `REBALANCE_ABI`, `encodeRebalance`, `rebalanceDigest`, `validateRebalance`, `signRebalance`. The rebalance preimage + EIP-191 signer. |
| `extension/handlers.ts` | Adds `handleIndexRebalance` + registers INDEX/REBALANCE + `reportRebalanceState()`; leaves `reportState()` byte-for-byte unchanged (conformance-pinned). |
| `extension/__tests__/rebalance.test.ts` | Unit tests: digest determinism, signature recovers to the TEE address, weight/price validation, vault pinning, empty/invalid handling. |
| `enclave-gateway.mjs` | CORS shim: `POST /sign {message:b64} -> {signature:b64}` (abi-encoded preimage) plus `POST /rebalance {vault,nonce,weights,prices}`. Forwards to the enclave `/action`. |
| `InstructionSender.sol` | Scaffold contract with `sendRebalance(bytes)` + the INDEX/REBALANCE op constants. Replaces `contracts/InstructionSender.sol`. |
| `env/.env.coston2.example` | `.env.coston2` template (secrets blanked; `INDEX_*` vars). |
| `env/extension_proxy.coston2.docker.toml.example` | Proxy config with `[db]` indexer placeholders + Coston2 `[addresses]`. |
| `DEPLOY.md` | The full runbook (prereqs, copy-in, env, tunnel, setup, wire `TEE_SIGN_URL`, gotchas). |

`extension/config.ts` and `extension/handlers.ts` are FULL files (Hello World
code plus the rebalance additions), so copying them over the scaffold versions
is correct. `extension/index.ts` replaces the scaffold's `avv.ts` slot.

## The gateway /sign contract (byte-for-byte with the project client)

`enclave/teesign.mjs` sends `{message: base64(abi.encode(vault,nonce,weightsBps,pricesE18))}`
and expects `{signature: base64(65-byte sig)}`, then recovers the signer over
`keccak256(message)` as an EIP-191 message. The gateway:

1. base64-decodes `message` back to the abi-encoded preimage,
2. forwards it to the enclave as the INDEX/REBALANCE `originalMessage`,
3. the enclave computes `keccak256(preimage)`, EIP-191 signs it in the TEE,
4. the gateway returns `{signature: base64(sig)}`.

So `TEE_SIGN_URL=<gateway>/sign` is a drop-in for the local dev tee-node.

See `DEPLOY.md` for the step-by-step.
