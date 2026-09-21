# Deploy to a server

Three tiers: the app (static), the API + live engine (Node), and the enclave
(TEE). This folder deploys the first two on one Linux box behind Caddy. The
enclave has its own runbook in `tee-extension/DEPLOY.md`.

Topology behind `deploy/Caddyfile`:

```
  browser ── https ──> Caddy ──┬── /        -> app/dist (static SPA)
                               └── /api/*    -> 127.0.0.1:8787 (server.mjs)
  live-engine.mjs ── writes ──> app/public/data/{live,leaderboard}.json
                               (server.mjs serves them over /api/live, /api/leaderboard)
  server.mjs (on-chain mode) ── TEE_SIGN_URL ──> enclave gateway /sign
```

Same-origin means the app talks to the API at the relative path `/api`
(`app/.env.production`), so there is nothing host-specific baked into the build.

## Prerequisites on the server

- Node 20+ (`node`, `npm`)
- Caddy 2 (TLS + reverse proxy) OR nginx if you prefer
- A DNS record pointing your hostname at the box
- Foundry (`forge`, `cast`) only if you run the on-chain setup from this box

## First-time setup

```
# 1. Get the code (adjust the path in the unit files if you change this)
sudo mkdir -p /opt/index-competition && sudo chown deploy:deploy /opt/index-competition
git clone <repo-url> /opt/index-competition
cd /opt/index-competition

# 2. Install deps and build the app
npm install
npm install --prefix app
npm --prefix app run build            # emits app/dist, reads app/.env.production

# 3. Secrets + runtime env (NOT committed). chmod 600.
sudo tee /etc/index-competition.env >/dev/null <<'EOF'
PORT=8787
RPC=https://coston2-api.flare.network/ext/C/rpc
# Off-chain by default. For the real on-chain, TEE-signed board, add:
# PK=0x<funded-coston2-key>
# TEE_SIGN_URL=https://<your-tunnel-slug>.trycloudflare.com/sign
EOF
sudo chmod 600 /etc/index-competition.env

# 4. Services
sudo cp deploy/index-api.service deploy/index-engine.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now index-api index-engine

# 5. Reverse proxy + TLS (edit the hostname in deploy/Caddyfile first)
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 6. Check
systemctl status index-api index-engine --no-pager
curl -s http://127.0.0.1:8787/api/leaderboard | head -c 300
```

## Repeat deploys

```
cd /opt/index-competition && ./deploy/deploy.sh
```

## Off-chain vs on-chain

- Off-chain (default): leave `PK` unset. The engine uses live prices, writes the
  board, provenance shows `priceOracleMode=raw`. No keys, no enclave needed.
- On-chain, TEE-signed: bring up the enclave (`tee-extension/DEPLOY.md`), set
  `PK` and `TEE_SIGN_URL` in `/etc/index-competition.env`, run the one-time
  `node scripts/compete-setup.mjs` to deploy this round's vaults + pools bound to
  the enclave, then `sudo systemctl restart index-engine`. Each rebalance is now
  a real Coston2 tx, gated by the enclave build check.

## The app on Cloudflare instead (matches git history)

The app was originally shipped to Cloudflare Workers (`app/wrangler.jsonc`,
project `attested-index-competition1`). If you prefer that over serving the SPA
from this box, point the app at the API's public URL at build time and deploy:

```
# app talks to a separate, publicly reachable API box:
VITE_API_URL=https://<api-host>/api \
VITE_GENERATE_URL=https://<api-host>/api/generate \
VITE_BUILD_URL=https://<api-host>/api/build \
  npm --prefix app run build

cd app && npx wrangler deploy         # needs `wrangler login` or CLOUDFLARE_API_TOKEN
```

In that split, the API box still needs to be reachable at `<api-host>` (a named
`cloudflared` tunnel or a normal domain), and Caddy only proxies `/api` there.

## Note: enclave extension files changed

The enclave now runs the deterministic build and gates the signature, so when you
follow `tee-extension/DEPLOY.md` step 2, copy the FULL current `extension/`
(includes `build-index.ts`, `epoch.ts`, `abi.ts`, the updated `handlers.ts` +
`config.ts`, and `../base/`). Gated signing needs `TEE_SIGN_URL` pointed at the
gateway `/sign`, not the bare tee-node.
