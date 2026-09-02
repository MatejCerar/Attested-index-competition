# Demo

Five AI-recipe indices: each is funded, pays the platform a fee, and is
rebalanced on-chain by the FCC tee-node, then ranked on a leaderboard.

## Run

```
npm install
# start the Flare tee-node (see repo README), then, in its netns:
docker run --rm --network container:tee -v "$PWD":/demo -w /demo \
  -e PK=<throwaway-coston2-key> node:22-alpine node orchestrate.mjs
```

`orchestrate.mjs` reads live FTSO, deploys a vault per basket, deposits, does
the FCC-signed on-chain rebalance, and writes `frontend/data.js`.

## View

Open `frontend/index.html` (data.js is a script include, no server needed).

## Edit the indices

`baskets.mjs` holds the 5 prompts + weights. Change them and re-run.
