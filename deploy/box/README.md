# Box-native deployment (OVH VPS `vps-82c9b3ae`)

This directory documents how Maldoror runs on the shared donto box, which deliberately
**diverges from the upstream `deploy/` (DigitalOcean + HAProxy + port-22) recipe**. The
box's port 22 is the operator's SSH lifeline and cannot be taken, and the box has strong
conventions (per-tenant DB containers, native systemd Node services, cgroup resource caps,
system Caddy for TLS). So here:

| Concern | Upstream | This box |
|---|---|---|
| Game SSH port | 22 (HAProxy, moves system SSH → 22022) | **2222, direct** (`ssh -p 2222 abyss.maldoror.dev`) |
| HAProxy | zero-downtime SSH front | **dropped** (direct listen) |
| Runtime | docker-compose (ssh-world + agent-bot) | **native systemd unit** `maldoror-ssh-world.service` |
| Postgres | `postgres` compose service | dedicated docker container **`maldoror-pg`** (`127.0.0.1:5436`) |
| Stats HTTP | :3000 | **:3105** (3000 is taken on the box) → `maldoror.dev` via system Caddy |
| Memory | `--max-old-space-size=5632` | capped: `maldoror.slice` MemoryMax=1600M, node heap 1280M |
| AI | your OpenAI/Anthropic key | on-box OpenAI service-account key |

## Components

- **DB:** docker container `maldoror-pg` (postgres:16-alpine), bound `127.0.0.1:5436`,
  named volume `maldoror_pgdata`, `--memory=1g`. Password in `/etc/donto/maldoror-pg.pass`.
- **App:** `maldoror-ssh-world.service` (in `maldoror.slice`), runs
  `node dist/index.js` from `apps/ssh-world`, reads `/etc/donto/maldoror.env`.
- **Env:** `/etc/donto/maldoror.env` (root:ajax 640) — `DATABASE_URL`, `SSH_PORT=2222`,
  `STATS_PORT=3105`, `AI_PROVIDER=openai`, `AI_MODEL=gpt-4o`, `OPENAI_API_KEY`, capped
  `NODE_OPTIONS`, `WORKER_STARTUP_TIMEOUT_MS=300000` (the box's sdb is often I/O-saturated
  by other tenants; the forked game-worker loads its module graph off disk slowly, so the
  worker-startup timeout is raised well above the 180s default). SSH host key at
  `apps/ssh-world/keys/host.key` (gitignored).

> **Build invariant:** `@maldoror/db` owns its tsup ESM bundle in the package's canonical
> `build` script. `turbo build` and filtered deploy builds therefore produce the same
> importable database artifact; no operator-only repair step is required. `redeploy.sh`
> also stamps the current Git hash before building so the running service is traceable.
- **Web:** none on the box. `maldoror.dev` is **Cloudflare-proxied → Vercel** (existing
  setup), so the box never sees its traffic. The stats endpoint stays on `127.0.0.1:3105`
  (and `0.0.0.0:3105`); to publish it, point a **grey/DNS-only** subdomain
  (e.g. `stats.maldoror.dev` → `15.235.185.42`) at the box and add a Caddy vhost for it.

## First-time install (already done 2026-07-23)

```bash
# 1. DB container
sudo docker run -d --name maldoror-pg --restart unless-stopped \
  -p 127.0.0.1:5436:5432 -e POSTGRES_USER=maldoror \
  -e POSTGRES_PASSWORD="$(sudo cat /etc/donto/maldoror-pg.pass)" \
  -e POSTGRES_DB=maldoror -v maldoror_pgdata:/var/lib/postgresql/data \
  --memory=1g --memory-swap=1g postgres:16-alpine

# 2. systemd units
sudo cp deploy/box/maldoror.slice /etc/systemd/system/
sudo cp deploy/box/maldoror-ssh-world.service /etc/systemd/system/
sudo systemctl daemon-reload

# 3. build + schema + host key  (see redeploy.sh — it does install/build/push)
cd apps/ssh-world && mkdir -p keys && ssh-keygen -t ed25519 -f keys/host.key -N "" -q && cd ../..

# 4. start
sudo systemctl enable --now maldoror-ssh-world.service
```

## Iterating (heavy development)

```bash
./deploy/box/redeploy.sh          # install → build → tsup db → drizzle push → restart
journalctl -u maldoror-ssh-world -f
curl -s http://127.0.0.1:3105/stats | jq .
ssh -p 2222 localhost             # play locally
```

## DNS (to make it public — do in Cloudflare/registrar for maldoror.dev)

- `abyss.maldoror.dev`  A → `15.235.185.42`  **DNS-only / grey cloud** (raw SSH can't be CF-proxied).
  Players then connect: `ssh -p 2222 abyss.maldoror.dev`.
- `abyss.maldoror.dev` is set (2026-07-23) and the game is reachable there.
- `maldoror.dev` stays on Vercel (unchanged). For box-served stats, add a **grey** subdomain
  like `stats.maldoror.dev` → `15.235.185.42` and a matching Caddy vhost → `127.0.0.1:3105`.

## Notes / future

- **Bare `ssh abyss.maldoror.dev` (port 22)** would require a second/failover IP from OVH so
  the game can own :22 on its own IP without touching the box's operator SSH.
- **agent-bot** and the **web/web-3d** viewers are not deployed here (SSH world only, by request).
