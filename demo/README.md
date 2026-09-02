# Demo

Crypto and RWA indices compete side by side: each is funded, pays the platform
a fee, is rebalanced on-chain by the FCC tee-node, and ranked on a leaderboard.

## Build the catalog

```
npm install
node build-catalog.mjs   # rwa-database.txt -> frontend/catalog.js (+ catalog.json)
```

Collapses the ~8,900-row database to the selectable universe, one asset per
unique (Ticker, Issuer).

## Build an index

Open `frontend/build.html`: search/filter the universe, add assets, set a
percentage weight on each (must sum to 100), name it, "Add index to
competition", then download `user-baskets.json` into this folder. Each leg is
priced FTSO-where-available, else from the CSV snapshot.

## Run the competition

```
node orchestrate.mjs                       # preview: no PK, no on-chain tx
# or, in the tee-node netns for the real thing:
docker run --rm --network container:tee -v "$PWD":/demo -w /demo \
  -e PK=<throwaway-coston2-key> node:22-alpine node orchestrate.mjs
```

`orchestrate.mjs` reads FTSO, resolves every leg (FTSO or CSV), and for each
crypto basket + user RWA index deploys a vault, deposits, does the FCC-signed
on-chain rebalance, and writes `frontend/data.js`. Without `PK` it runs in
preview mode (prices + leaderboard only).

## View

Open `frontend/index.html` (data.js is a script include, no server needed).

## Edit the indices

`baskets.mjs` holds the 5 crypto prompts + weights; `user-baskets.json` holds
the RWA indices from the builder. Change either and re-run.
