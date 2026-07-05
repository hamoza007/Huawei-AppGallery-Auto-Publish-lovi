// pm2 process manifest for the Huawei AppGallery auto-publish stack.
//
// Layout expected on the VPS:
//   /opt/hwcodex           <- checkout of this repo (git clone here)
//   /opt/huawei-profile    <- persistent Chromium profile (see scripts/huawei-login.ts)
//   /var/log/hwcodex       <- pm2 log directory
//
// Usage:
//   cd /opt/hwcodex
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//   pm2 startup            # follow the printed instruction to enable at boot
//
// Environment variables are read from /opt/hwcodex/.env (loaded by Next.js and
// tsx automatically via dotenv-flow). Do NOT commit real secrets here.

const path = require("path");
const REPO = process.env.HWCODEX_DIR || "/opt/hwcodex";
const LOG_DIR = process.env.HWCODEX_LOG_DIR || "/var/log/hwcodex";

module.exports = {
  apps: [
    {
      name: "hwcodex-web",
      cwd: REPO,
      // `next start` reads .env / .env.production automatically.
      script: "npm",
      args: "run start -- -p 3000 -H 127.0.0.1",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_memory_restart: "1G",
      out_file: path.join(LOG_DIR, "web.out.log"),
      error_file: path.join(LOG_DIR, "web.err.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "hwcodex-worker",
      cwd: REPO,
      script: "npm",
      args: "run worker",
      env: {
        NODE_ENV: "production",
        // Playwright: use the on-disk profile the operator seeded with
        // scripts/huawei-login.ts.
        HUAWEI_PROFILE_DIR: process.env.HUAWEI_PROFILE_DIR || "/opt/huawei-profile",
        HUAWEI_CONSOLE_AUTOMATION: "1",
        // Force Playwright to use the system Chromium we install via apt.
        // If you install `npx playwright install chromium` instead, unset
        // this to let Playwright pick its bundled binary.
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "/root/.cache/ms-playwright",
      },
      max_memory_restart: "1500M",
      out_file: path.join(LOG_DIR, "worker.out.log"),
      error_file: path.join(LOG_DIR, "worker.err.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
