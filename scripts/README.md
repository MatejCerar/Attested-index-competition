# scripts/

Off-chain scripts: the catalog builder, the local server, the on-chain
orchestrator, the live competition, and the Uniswap-pool proof. Node ESM
(ethers v6), deps resolve from the repo root `node_modules`.

## Build the catalog

```
node build-catalog.mjs   # rwa-database.txt -> catalog.json
```

Collapses the ~8,900-row database to the selectable universe, one asset per
unique (Ticker, Issuer): ~2,300 instruments, ~1,300 priceable.

## One command (server + app)

```
npm run demo            # from the repo root
```

Starts the local API server (`server.mjs`, http://localhost:8787) and the Vite
dev server (http://localhost:3000) together. Open `/build`, type a prompt to
generate a real index, tweak, and add it to the competition: it appears on
`/leaderboard`.

## Local server (server.mjs)

A tiny Node http server (no framework), default port 8787:

- `POST /api/generate {prompt}` -> `generateIndex(prompt)` from
  `index/generate.mjs` (real Claude Haiku, catalog-validated). Falls back to a
  safe index (flagged `source:"fallback"`) if the CLI is unavailable.
- `POST /api/add {basket}` -> validates against the catalog + strategies,
  appends to `app/public/data/user-baskets.json` (dedup by id), scores it with
  the real rebalance math on the Uniswap price source (mock pools, seeded from
  the catalog), upserts it into `app/public/data/leaderboard.json` and re-ranks.
  With `PK` + `TEE_SIGN_URL` set it does the real Coston2 deposit + FCC-signed
  rebalance and records tx hashes; otherwise it scores off-chain.
- `GET /api/leaderboard` -> the current leaderboard.json.

```
node server.mjs                             # off-chain scoring, seeded prices
PK=<key> TEE_SIGN_URL=... node server.mjs   # real Coston2 deposit + rebalance
```

## On-chain orchestrator (crypto baskets)

```
node orchestrate-rebalance.mjs        # needs PK; deploys + rebalances the 5 crypto indices
```

Deploys MockUSDC + a StableIndexVault per crypto index, deposits, FCC-signs
`(vault, nonce, weightsBps, pricesE18)`, relays the real rebalance, and writes
`app/public/data/leaderboard.json`. Priced by the in-repo stub source.

## Real competition (live data)

```
node compete.mjs                      # HL oracle, 1h, rebalance 15m, $100k each
PRICE_SOURCE=yahoo node compete.mjs   # Yahoo/CoinGecko instead
INCLUDE_CRYPTO=1 node compete.mjs     # add the 5 crypto baskets
```

Prices every index on live data (`prices.mjs`), runs the rebalancer, tracks
realized return, and writes `app/public/data/live.json` each tick. Open the
app's `/live` route to watch.

## Uniswap-pool proof

```
node uniswap-seed.mjs                 # offline: seed pools in-process, read back
PK=<key> node uniswap-seed.mjs        # live: deploy + seed on Coston2, rebalance
```

## Edit the indices

`baskets.mjs` holds the 5 crypto prompts + weights; `user-baskets.json` holds
the RWA indices from the builder. Change either and re-run.
