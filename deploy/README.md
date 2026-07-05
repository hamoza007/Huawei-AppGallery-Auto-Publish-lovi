# VPS deployment (Caddy + pm2)

This directory contains the artifacts for running the Huawei AppGallery
auto-publish app on a plain Debian/Ubuntu VPS with Caddy in front and pm2
managing the Node processes.

## Files

| File                     | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `install.sh`             | One-shot provisioning script (Node/Caddy/pm2/Postgres/Chromium).  |
| `ecosystem.config.cjs`   | pm2 manifest for the web + worker processes.                      |
| `Caddyfile.example`      | Reverse-proxy config for `hwcodex.shopinzo.bond`.                 |
| `start.sh`               | Legacy Docker/supervisord entrypoint (kept for parity).           |
| `supervisord.conf`       | Legacy Docker/supervisord config.                                 |

## First-time provisioning

```bash
sudo bash /opt/hwcodex/deploy/install.sh
```

This will:
1. Install Node 20, Chromium, PostgreSQL, Caddy, pm2, fastlane, and dev deps.
2. Clone (or update) `/opt/hwcodex` from `origin/main`.
3. Install npm deps, generate Prisma client, sync the schema, build the app.
4. Install `/etc/caddy/Caddyfile` for `hwcodex.shopinzo.bond` and reload Caddy.
5. Start `hwcodex-web` and `hwcodex-worker` under pm2 and enable at boot.

The install script does **not** populate `.env`. Before the app can talk to
Huawei you must:

```bash
cp /opt/hwcodex/.env.example /opt/hwcodex/.env
$EDITOR /opt/hwcodex/.env
# Fill in:
#   DATABASE_URL=postgres://hwcodex:changeme@localhost:5432/hwcodex
#   HUAWEI_AGC_CLIENT_ID=...
#   HUAWEI_AGC_CLIENT_SECRET=...
#   OPENAI_API_KEY=...
pm2 restart deploy/ecosystem.config.cjs
```

## Seeding the Huawei console profile

Console-based automation (content rating, category, countries, personal data,
AI declaration, release time) uses a persistent Chromium profile at
`/opt/huawei-profile`. Log in once and the profile stays on disk:

```bash
# Option A: over SSH with X11 forwarding (ssh -X):
npx tsx /opt/hwcodex/scripts/huawei-login.ts

# Option B: headless via Xvfb (works over a plain SSH shell):
xvfb-run -a npx tsx /opt/hwcodex/scripts/huawei-login.ts

# Option C: attach an existing debug-mode Chrome via CDP:
HUAWEI_CDP_URL=http://localhost:9222 pm2 restart hwcodex-worker
```

If the worker reports "Huawei console session expired", repeat step A/B and
`pm2 restart hwcodex-worker`.

## DNS

`hwcodex.shopinzo.bond` must have an A record pointing to the VPS's public IP
before Caddy will get a TLS cert on first start. Verify with:

```bash
dig +short hwcodex.shopinzo.bond
```

## Logs

```bash
pm2 logs hwcodex-web
pm2 logs hwcodex-worker
tail -f /var/log/caddy/hwcodex.access.log
journalctl -u caddy -f
```

## Updating the app

```bash
cd /opt/hwcodex
git pull
npm ci --no-audit --no-fund
npx prisma generate
npx prisma db push --skip-generate --accept-data-loss
npm run build
pm2 restart deploy/ecosystem.config.cjs
```
