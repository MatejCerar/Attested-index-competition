#!/usr/bin/env bash
# Build the app and restart the services. Run from the repo on the server.
# First-time setup is in deploy/README.md; this is the repeat-deploy path.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
npm install
npm install --prefix app
npm --prefix app run build            # reads app/.env.production (VITE_*=/api)

sudo systemctl restart index-api index-engine
sudo systemctl reload caddy || true
echo "deployed: app rebuilt, api + engine restarted"
