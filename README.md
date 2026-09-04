# Index Competition

A marketplace of tokenized real-world-asset (RWA) index funds on Flare.

You build an index - a basket of tokenized stocks, ETFs or metals with weights,
plus a rule for when to rebalance - and every index competes on a live
leaderboard by return. The point of difference: no human runs the money. A
rebalance only executes when it is signed inside a secure enclave (a TEE) on
Flare, so each index runs itself and every move is provable on-chain.

```
  build an index   ->   it competes live    ->   ranked by return
  weights + a           the rebalancer keeps      leaderboard; the best
  rebalance rule        it on target, TEE-signed   attract more deposits
```

Built on Flare (Coston2 testnet). The universe is ~1,300 priceable tokenized
RWAs. There is no crypto anywhere.

## How to run

Three levels, simplest first. Pick one.

### 1. Just look at it (no setup)

The frontend with sample data. No blockchain, no keys.

```
cd app
npm install
npm run dev            # open http://localhost:3000
```

### 2. Run the live competition locally (recommended)

The full product on real market prices, but off the blockchain. Build an index
and watch it rebalance and climb the board. The prices and the rebalancer are
real; only the on-chain settlement is skipped (no wallet, no keys).

```
npm install                 # once, at the repo root
npm install --prefix app    # once, the app
npm run compete             # app on :3000, local API on :8787
```

Open http://localhost:3000/build, type a prompt (or click a template like
"Bloomberg top 5"), generate an index, tweak it, and "Add to competition". It
appears on /leaderboard and races on /live.

### 3. The real on-chain version (Flare Coston2)

Now each rebalance is a real transaction on Flare, signed inside the TEE.

Two facts that make this simple:

- The contracts are already on Coston2 (see `DEPLOYMENT.md`). You do not write
  or redeploy any Solidity. One setup command deploys this round's vaults, wired
  to your enclave.
- You only need two things running: the enclave (the real TEE) and the app.

It runs in a simulated-attestation "dummy TEE" mode by default: the signing is
real, only the secure-hardware attestation is simulated. That means you can test
the whole on-chain flow on a normal machine, with no special hardware.

```
# a) start the enclave (the real Flare tee-node). Details in tee-extension/DEPLOY.md.
#    It signs on port 7701 in simulated mode (MODE=1, SIMULATED_TEE=true).

# b) point the app at the enclave, give it a funded Coston2 key, and run:
export TEE_SIGN_URL=http://127.0.0.1:7701/sign
export PK=<a funded Coston2 key>       # never commit this
node scripts/compete-setup.mjs         # deploys this round's vaults + pools, bound to your enclave
npm run compete                        # rebalances are now real, TEE-signed Coston2 transactions
```

Each rebalance then shows up as a real transaction on the Coston2 explorer.
`DEPLOYMENT.md` lists verified examples from a live run.

## What the pieces are

- **Index** - a prompt, asset weights, and a rebalance strategy. You can write it
  by hand in the builder, or generate the whole thing from a prompt: an AI
  (Claude) picks assets and weights, but only from the RWA catalog. Code in
  `index/`.
- **Rebalancer + strategies** - decides *when* to rebalance (intervals from 1
  minute to daily, drift bands, take-profit, or combinations) and moves the vault
  back to its target weights. `index/strategies.mjs`, `rebalancer/`.
- **The vault** - `src/StableIndexVault.sol` holds a USD stablecoin and moves its
  holdings on `rebalance()`, which only runs if the TEE signed the weights and
  prices. `src/MockUSDC.sol` is a test stablecoin with a faucet (mint 1000 test
  USD, 1:1).
- **Prices** - live market data (Yahoo). On-chain, each asset has a Uniswap V3
  pool on Coston2 that the vault reads to rebalance; the keeper pushes the live
  price into it. A few assets (like gold) have deep real DEX pools; the rest use
  the live feed.
- **The TEE** - the rebalancer runs inside a Flare Confidential Compute enclave
  and signs each rebalance, so the allocation is autonomous and every move is
  provable. `enclave/`, `tee-extension/`.

## Layout

```
app/            the frontend (Vite + React + Mantine): /build, /leaderboard, /live
index/          index definitions, strategies, prices, AI generation
rebalancer/     the rebalance loop
scripts/        the local API server, the live engine, on-chain setup, the catalog
src/            Solidity: StableIndexVault, MockUSDC, MockUniswapV3Pool, attestation
tee-extension/  the enclave (TEE) that signs rebalances, and how to run it (DEPLOY.md)
DEPLOYMENT.md   the live Coston2 addresses and verified tx hashes
```

## What is real vs simulated

- **Real**: the prices (live market data), the rebalancer and its strategies,
  and - in mode 3 - the deposits and TEE-signed rebalances on Coston2.
- **Simulated**: the multi-day performance path (a real week takes a week), and
  the TEE hardware attestation (MODE=1; real secure hardware needs a Confidential
  Space VM). The signing itself is real.

## Tests

```
npm install
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
forge test        # 29 passing
```
