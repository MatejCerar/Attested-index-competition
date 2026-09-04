# Live deployment (Coston2, chain 114)

Every address and tx below is on-chain, not a local sim.

## Index Competition RWA vaults, tee-signed rebalance (2026-09-03)

Five RWA index vaults (aligned with the live-engine field), deployed by
`0x4AD9F5F107c54264A5d107dEb10f768a9d27b8b7` and rebalanced via the real Flare
tee-node v0.0.24 (MODE=1 simulated attestation). FCC rebalancer (tee) signer:
`0x8FFf2C049eDe07D33716d312d53D3FF03a65BD65` (== each vault's `rebalancer`).

| Contract | Address |
|---|---|
| MockUSDC | `0x800422CD55549fd71bA3C3A283cBB287836aAe54` |
| StableIndexVault mag-7-rwa | `0x89267d063D079058811569fA311ed4320885996c` |
| StableIndexVault ai-semiconductors | `0x9F5Dc89de4C3a52760fE850F262AdB4f8DDfbbf6` |
| StableIndexVault wall-street-financials | `0xa08667be287258CFC11f2BE4cE3166F5e6a3f7CD` |
| StableIndexVault precious-metals | `0x7ED06545011c789D162D0ae2C5f667f27004bdC3` |
| StableIndexVault tokenized-index-funds | `0xC55C87c327438eEd0778EE4e27Ee83A47E7513a9` |

Full pool map (21 pools) in `app/public/data/compete-onchain.json`. Each vault
holds 1000 mUSDC. Real tee-signed `rebalance()` txs (status SUCCESS, holdings
moved):
- mag-7-rwa: `0xead0b309340590881850254da16f2c584e5553b325cf3562c5961b744300cba9` (block 34836800)
- ai-semiconductors: `0xe17da598de36bdf76704e615b0582b6933dd0dfb3d7d14bb9300deae1dc5b527` (block 34836802)
- wall-street-financials: `0x3ba483c4344e1df07f9d5871bc1e633008bc600e52bb6b6f426c92cd8e252b84` (block 34836805)
- precious-metals: `0x2e1ca2fa5f6eebfac181ada713d49086226381ec645c57761875c8fe6b52adee` (block 34836807)
- tokenized-index-funds: rebalances on-chain once its drift-5 band is breached (pure drift strategy, no trigger at t0).

## Contracts

| Contract | Address |
|---|---|
| AttestedEpochRegistry | `0x04fdd94f24021bca2486375704e2e664c4758805` |
| SimulatedAttestationVerifier | `0xd95dcc5c07eb6d69edf716cad35ba22baae07510` |
| IndexVault | `0xef749278eba072799ef64d57b7126ee496262c56` |

Explorer: https://coston2-explorer.flare.network/address/0x04fdd94f24021bca2486375704e2e664c4758805

Governance: `0x4AD9F5F107c54264A5d107dEb10f768a9d27b8b7` (throwaway key,
testnet only). Series `PF-AI-COMPUTE` =
`0x790934be616d4f879ee36650542c6d94792fa93271d4a9d119af3a96a4a03961`,
PayloadType.Index, minReplicas = 2.

## Agreement + tamper (epochs 1-2)

Index of AMD (cik 2488, 41.2%) + NVDA (cik 1045810, 58.8%),
outputRoot `0x165434c1614f13b090d4cca3b9ae502cb1bd757bee57d12e46b7f28bf95248c9`.

- Epoch 1: enclave A submits (finalized=false), enclave B submits the matching
  root (finalized=true, tx `0xd183edb2af8bc91cd5710afad951e8d5c0462ad87969af54d0c34aae85f5b57d`).
  `verifyLeaf(NVDA)` = true; `verifyLeaf(tampered weight)` = false.
- Epoch 2: a rogue enclave submits a different root -> transaction REVERTED
  (OutputMismatch); epoch stays unfinalized. An operator cannot substitute its
  own result.

## Real Flare tee-node (epoch 5)

Two real Flare tee-node v0.0.24 containers (built from
`flare-foundation/fce-extension-scaffold` `go/Dockerfile`, MODE=1) each hold
their own key inside the TEE and expose `/sign` on loopback. Two enclave
sidecars share each tee-node's network namespace, get a real signature, and
commit. The tee-node signs `TextHash(keccak256(message))`, which equals the
contract's `_digest`, so it verifies unchanged.

- tee-node image measurement =
  `0x09e60cc117ce7ca8eb6178e9aafdce33aa36c64ede2846035a6ff7f6f95a7167`
  (allow-listed: tx `0x42a4a0c69b5d65e72a574cab3c59d8735e794b2db50100e37c37389945f2b94f`).
- enclave-a TEE signer `0x7346c293ad9962ee04DB086f0bD869905C3CC868`,
  submit tx `0x84c3e5225199f6e587319c497c5c782e11686fbca07ce76ce598b076a13acc05`.
- enclave-b TEE signer `0x0c25cE2f733514AC0636bDD46AC94b39E1536726`,
  submit tx `0xecab5a3082a1308f472a50840979b270d5f76ff83b435a8d5ca3b5ccc3073070`.
- both produced root `0x165434c1...48c9`; epoch 5 finalized = true (verified
  on-chain). Signatures come from the real tee-node binary, not a local key.

Only the attestation root of trust is still MODE=1 simulated; MODE=0 on
Confidential Space is the remaining step. AVV (demo-mystic) was not touched.

## Tests

`forge test` -> 9 passed (agreement, mismatch revert, bad-code, double-count,
multi-level Merkle proof, quote self-registration).

## Rewrite note (index-first)

The project was re-centered so index, rebalancer, and frontend lead, and the
attestation/FCC story is a footnote. The vault no longer prices in FTSO or holds
native C2FLR: `src/StableIndexVault.sol` is denominated in a mock USD stablecoin
(`src/MockUSDC.sol`, 6 decimals) and `rebalance()` drops the flrUsd argument.
The addresses and tx hashes above are unchanged and remain valid for the
historical FTSO/native-C2FLR deploy of `SyntheticIndexVault.sol` and the
attestation registry. New stablecoin-vault deploys, when run, should be appended
below.

`forge test` -> 14 passed after the rewrite (9 attestation + 5 StableIndexVault:
deposit, rebalance weights/nav, bad-sig, bad-weights, bad-len).
