/**
 * One-time login helper for the Huawei AppGallery Connect console.
 *
 * Launches a headed Chromium window using the same persistent profile
 * directory that the worker uses. Log in manually (SMS/OTP included) and close
 * the window when you land on the developer console. Cookies persist to disk
 * and the worker will re-use them.
 *
 * Usage:
 *   npx tsx scripts/huawei-login.ts             (headed, default profile)
 *   HUAWEI_PROFILE_DIR=/data/huawei npx tsx scripts/huawei-login.ts
 *
 * On a headless VPS, run this inside `xvfb-run` or over VNC:
 *   xvfb-run -a npx tsx scripts/huawei-login.ts
 * ...or forward the display via SSH X11 forwarding.
 */
import { chromium } from "playwright";
import { promises as fs } from "fs";

const PROFILE = process.env.HUAWEI_PROFILE_DIR || "/opt/huawei-profile";
const START_URL =
  process.env.HUAWEI_LOGIN_URL ||
  "https://developer.huawei.com/consumer/en/service/josp/agc/index.html";

async function main() {
  await fs.mkdir(PROFILE, { recursive: true });
  console.log(`Launching persistent Chromium (profile=${PROFILE})`);
  console.log("A browser window will open. Sign in to the Huawei Developer Console,");
  console.log("then close the window when you see the console dashboard.");

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  // Wait until the operator closes the browser (context.close event).
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
    // Also resolve if the user navigates and manually presses Ctrl+C.
    process.on("SIGINT", () => resolve());
  });

  console.log(`Profile saved at ${PROFILE}.`);
}

main().catch((err) => {
  console.error("Login helper failed:", (err as Error).message);
  process.exit(1);
});
