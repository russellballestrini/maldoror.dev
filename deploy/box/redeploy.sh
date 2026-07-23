#!/usr/bin/env bash
# Box-native redeploy for the OVH VPS (vps-82c9b3ae).
# Rebuilds ssh-world + its workspace deps, re-bundles @maldoror/db (ESM), pushes any
# schema changes to the dedicated maldoror-pg container, and restarts the systemd unit.
# Runs niced/ionice'd so it yields on this shared box. See ./README.md for the full setup.
set -euo pipefail

REPO="/mnt/donto-data/workspace/maldoror.dev"
export PATH=/usr/bin:/bin:/usr/local/bin
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
cd "$REPO"

echo ">>> install (filtered to ssh-world + deps)"
nice -n15 ionice -c3 pnpm install --frozen-lockfile --filter "@maldoror/ssh-world..."

echo ">>> build (filtered)"
nice -n15 ionice -c3 pnpm build --filter "@maldoror/ssh-world..."

echo ">>> re-bundle @maldoror/db with tsup (ESM resolution in prod)"
cd "$REPO/packages/db"
nice -n15 npx tsup src/index.ts src/schema/index.ts --format esm --dts --clean \
  --external drizzle-orm --external pg --external @maldoror/protocol

echo ">>> push schema to maldoror-pg"
set -a; source <(sudo grep -E '^DATABASE_URL=' /etc/donto/maldoror.env); set +a
nice -n15 npx drizzle-kit push --force

echo ">>> restart service"
sudo systemctl restart maldoror-ssh-world.service
sleep 3
systemctl is-active maldoror-ssh-world.service
echo ">>> done. logs: journalctl -u maldoror-ssh-world -f"
