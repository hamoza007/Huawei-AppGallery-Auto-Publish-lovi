#!/usr/bin/env bash
# One-shot VPS provisioning script for Debian/Ubuntu hosts.
#
# What it does:
#   1. Installs Node.js 20, PostgreSQL, Chromium, Caddy, pm2, Ruby (for
#      fastlane), and the deps Playwright/Chromium need.
#   2. Creates /opt/hwcodex checkout + /opt/huawei-profile + /var/log/hwcodex.
#   3. Configures PostgreSQL role + DB.
#   4. Installs the Caddyfile and reloads Caddy.
#   5. Starts pm2 with deploy/ecosystem.config.cjs.
#
# What it does NOT do:
#   - Log you into the Huawei Developer Console. Run `npx tsx
#     scripts/huawei-login.ts` (with xvfb-run or X11 forwarding) once, then the
#     worker will re-use the persisted cookies.
#   - Populate .env — you must copy .env.example to .env and fill in the API
#     keys before running pm2.
#
# Idempotent-ish: safe to re-run; steps that already succeeded are skipped.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/hamoza007/Huawei-AppGallery-Auto-Publish-lovi.git}"
REPO_DIR="${REPO_DIR:-/opt/hwcodex}"
PROFILE_DIR="${PROFILE_DIR:-/opt/huawei-profile}"
LOG_DIR="${LOG_DIR:-/var/log/hwcodex}"
DB_NAME="${DB_NAME:-hwcodex}"
DB_USER="${DB_USER:-hwcodex}"
DB_PASSWORD="${DB_PASSWORD:-changeme-please}"
DOMAIN="${DOMAIN:-hwcodex.shopinzo.bond}"

log()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m!! %s\033[0m\n" "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo bash deploy/install.sh)"
  exit 1
fi

log "Updating apt caches"
apt-get update -y

log "Installing system packages"
apt-get install -y \
  curl gnupg ca-certificates lsb-release git build-essential \
  chromium xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libxkbcommon0 libxcomposite1 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2 libgtk-3-0 fonts-liberation \
  postgresql postgresql-contrib \
  ruby-full ruby-dev

# --- Node.js 20 -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(20|21|22|23)'; then
  log "Installing Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log "Node $(node -v) already installed"
fi

log "Installing pm2 globally"
npm install -g pm2 tsx >/dev/null

# --- Caddy ------------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  log "Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  log "Caddy already installed"
fi

# --- Fastlane ---------------------------------------------------------------
if ! command -v fastlane >/dev/null 2>&1; then
  log "Installing fastlane"
  gem install fastlane --no-document
else
  log "fastlane already installed"
fi

# --- PostgreSQL setup ------------------------------------------------------
log "Configuring PostgreSQL role + DB"
sudo -u postgres psql <<SQL || true
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql <<SQL || true
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL

# --- Repo clone / update ----------------------------------------------------
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log "Cloning repo into ${REPO_DIR}"
  git clone "${REPO_URL}" "${REPO_DIR}"
else
  log "Updating existing repo"
  git -C "${REPO_DIR}" fetch --all --prune
  git -C "${REPO_DIR}" reset --hard origin/main
fi

log "Installing npm deps"
cd "${REPO_DIR}"
npm ci --no-audit --no-fund

log "Installing Playwright browsers"
npx playwright install --with-deps chromium

log "Generating Prisma client + syncing schema"
npx prisma generate
if [[ -n "${DATABASE_URL:-}" ]]; then
  npx prisma db push --skip-generate --accept-data-loss || true
fi

log "Building Next.js app"
npm run build

# --- Directories -----------------------------------------------------------
mkdir -p "${LOG_DIR}" "${PROFILE_DIR}"
chown -R root:root "${LOG_DIR}" "${PROFILE_DIR}"

# --- Caddy config ----------------------------------------------------------
if [[ ! -f /etc/caddy/Caddyfile.hwcodex.installed ]]; then
  log "Installing Caddy config"
  sed "s/hwcodex.shopinzo.bond/${DOMAIN}/g" "${REPO_DIR}/deploy/Caddyfile.example" > /etc/caddy/Caddyfile
  touch /etc/caddy/Caddyfile.hwcodex.installed
  systemctl reload caddy || systemctl restart caddy
else
  log "Caddy already configured (delete /etc/caddy/Caddyfile.hwcodex.installed to force reinstall)"
fi

# --- .env sanity check -----------------------------------------------------
if [[ ! -f "${REPO_DIR}/.env" ]]; then
  warn "No .env file at ${REPO_DIR}/.env — copy .env.example and fill in HUAWEI_AGC_CLIENT_ID, HUAWEI_AGC_CLIENT_SECRET, OPENAI_API_KEY, DATABASE_URL, then run: pm2 restart ecosystem.config.cjs"
fi

# --- pm2 -------------------------------------------------------------------
log "Starting pm2 processes"
cd "${REPO_DIR}"
pm2 start deploy/ecosystem.config.cjs || pm2 restart deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true

log "Done."
echo
echo "Next steps:"
echo "  1) Fill in ${REPO_DIR}/.env"
echo "  2) Log into Huawei once:"
echo "       xvfb-run -a npx tsx ${REPO_DIR}/scripts/huawei-login.ts"
echo "  3) Open https://${DOMAIN}/"
