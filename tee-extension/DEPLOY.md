# DEPLOY: INDEX/REBALANCE TEE signer on Coston2

This runbook signs the index rebalance inside a real Flare Confidential Compute
(FCC) TEE on Coston2, using the `fce-extension-scaffold`. The enclave holds the
rebalancer key; a valid `StableIndexVault.rebalance()` proves the plan was signed
in the enclave. Enabling it is pure config: point the project's `TEE_SIGN_URL` at
the gateway. No edits to `scripts/server.mjs`, the engines, or `rebalancer/`.

Everything in this folder is SOURCE only. You copy it into a fresh scaffold
clone, fill secrets, and run the scaffold's setup script.

## 0. Prerequisites

Install on the deploy host (a Linux box or the Confidential Space VM):

- Docker (with compose) and permission to run it
- Go 1.25+ (the scaffold's Go tooling + cgo abigen)
- Foundry (`forge`, `cast`) for building/deploying `InstructionSender.sol`
- Node 20+ (this extension is TypeScript; scaffold tooling uses Node too)
- cloudflared (for the ext-proxy public tunnel and the gateway tunnel)
- gcc / build-essential (REQUIRED: cgo abigen fails to link without it)

Values you must supply (NOT in this repo):
- a funded Coston2 key (C2FLR from the Coston2 faucet) for `INITIAL_OWNER` /
  `DEPLOYMENT_PRIVATE_KEY` and `PROXY_PRIVATE_KEY`
- the hackathon chain indexer DB host + name (+ user/password) for the ext-proxy
  `[db]` block

## 1. Clone the scaffold

```
git clone --depth 1 https://github.com/flare-foundation/fce-extension-scaffold.git
cd fce-extension-scaffold
```

## 2. Drop in the extension

Copy this folder's `extension/*` into the scaffold's TypeScript app dir, and
replace the scaffold's `InstructionSender.sol`:

```
cp -r <this-folder>/extension/* typescript/src/app/
cp    <this-folder>/InstructionSender.sol contracts/InstructionSender.sol
```

`extension/` contains:
- `config.ts`  - adds `OP_TYPE_INDEX` = bytes32("INDEX") and
  `OP_COMMAND_REBALANCE` = bytes32("REBALANCE") next to the GREETING constants
  (KEEP the Hello World ones).
- `index.ts`   - `encodeRebalance`, `rebalanceDigest`, `validateRebalance`,
  `signRebalance` (replaces the scaffold's `avv.ts` slot).
- `handlers.ts` - adds `handleIndexRebalance` + registers INDEX/REBALANCE, and a
  separate `reportRebalanceState()`. `reportState()` is left byte-for-byte
  unchanged (the conformance fixtures pin it).
- `__tests__/rebalance.test.ts` - unit tests for the handler + signer.

`config.ts` and `handlers.ts` are FULL replacements (Hello World plus the index
additions), so a straight copy is correct.

Sanity-check locally before deploying:

```
cd typescript && npm install && npm run build && npx vitest run   # tests pass
cd .. && forge build                                              # sendRebalance compiles
```

## 3. Configure `.env.coston2`

```
cp <this-folder>/env/.env.coston2.example .env.coston2
```

Set:
- `DEPLOYMENT_PRIVATE_KEY` - a Coston2-funded key
- `INITIAL_OWNER`          - the address derived from that key
- `PROXY_PRIVATE_KEY`      - a funded key for proxy signing
- `LANGUAGE=typescript`    - already set
- `SIMULATED_TEE=true`     - simulated attestation (no real TEE hardware)
- `INDEX_CHAIN_ID=114`     - Coston2

Leave `TEE_REBALANCER_KEY`, `INDEX_VAULT`, `INDEX_REBALANCER` BLANK for now: the
enclave generates its key inside the TEE. You learn the address in step 6 by
probing `/sign`, then deploy the vault with it as `rebalancer`.

`full-setup.sh --chain coston2` copies `.env.coston2` to `.env` automatically.

## 4. Configure the ext-proxy DB (indexer creds)

```
cp <this-folder>/env/extension_proxy.coston2.docker.toml.example \
   config/proxy/extension_proxy.coston2.docker.toml
# edit [db] host/port/database/username/password with the hackathon indexer creds
chmod 644 config/proxy/extension_proxy.coston2.docker.toml
```

The `chmod 644` is NOT optional. See GOTCHAS. Never commit the filled file.

## 5. Run the full setup

```
./scripts/full-setup.sh --chain coston2 --tunnel --test
```

This runs pre-build -> start (docker compose: redis, ext-proxy, extension-tee)
-> post-build (deploys `InstructionSender`, calls `setExtensionId`, registers TEE
governance + machine) -> test. Wait for `All tests passed`.

## 6. Start the gateway and learn the rebalancer address

Run the gateway pointed at the enclave (`extension-tee:7702` on the compose
network, or the container IP / mapped port from your host):

```
ENCLAVE_URL=http://extension-tee:7702 GATEWAY_PORT=8799 \
  node <this-folder>/enclave-gateway.mjs
```

Expose it with a quick tunnel:

```
cloudflared tunnel --url http://localhost:8799
# note the https://<slug>.trycloudflare.com URL it prints
```

Probe `/rebalance` once to learn the TEE signer (== the address you must set as
`StableIndexVault.rebalancer`). The project scripts already recover it from the
`/sign` probe (`scripts/compete-setup.mjs` prints `FCC rebalancer (tee) signer`).

## 7. Wire TEE_SIGN_URL and run the on-chain flow

Point the existing on-chain path at the gateway and run it. No code changes:

```
export TEE_SIGN_URL=https://<slug>.trycloudflare.com/sign
export PK=<funded Coston2 key>        # the deployer, not the TEE key

# deploy vaults with the TEE address as rebalancer, then run the engine on-chain:
node scripts/compete-setup.mjs
PK=$PK TEE_SIGN_URL=$TEE_SIGN_URL node scripts/live-engine.mjs   # ON-CHAIN mode

# or a single add end to end:
PK=$PK TEE_SIGN_URL=$TEE_SIGN_URL node scripts/orchestrate-add.mjs
```

Each rebalance is now FCC-signed: the engine builds
`abi.encode(vault, nonce, weightsBps, pricesE18)`, base64s it to `/sign`, the
enclave signs `keccak256(...)` in the TEE, and `StableIndexVault.rebalance`
verifies the signer == `rebalancer` on Coston2.

## Values the operator still must supply

- indexer DB host + name (+ user/password) for the ext-proxy `[db]` block
- a funded Coston2 key (deployer/proxy)
- Docker + Go 1.25 + Foundry + cloudflared + gcc on the deploy host

## GOTCHAS

- The proxy toml MUST be mode 644. If it is 600 the ext-proxy container cannot
  read it and crashes on start.
- cgo abigen needs gcc. Install build-essential/gcc or Go binding generation
  fails to link.
- The cloudflared quick-tunnel URL is EPHEMERAL: it changes on every restart.
  For a durable demo use a NAMED tunnel (stable hostname) and update
  `TEE_SIGN_URL` accordingly.
- Register only ONE TEE machine. Multiple active TEE machines make the ext-proxy
  route `/action/result` to a stale one, so polling 404s / times out.
- `SIMULATED_TEE=true` uses a simulated (test) attestation. For real attestation
  run on a GCP Confidential Space VM with `SIMULATED_TEE=false`.
- The enclave key (teeID) rotates when the extension-tee container is recreated.
  To change the extension code, re-run
  `./scripts/full-setup.sh --chain coston2 --tunnel --test` so the new enclave is
  re-registered, and re-derive the rebalancer address (it changes).
