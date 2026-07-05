/**
 * Playwright script to automate the Huawei AppGallery content rating questionnaire.
 *
 * Two supported connection modes:
 *   1. Persistent context (default): reuses a logged-in Chromium profile stored
 *      on disk. Log in once with `scripts/huawei-login.ts` and this script (and
 *      the worker) will re-use the same profile without a browser attached.
 *   2. CDP attach (legacy): connect to an already-running Chrome via
 *      --remote-debugging-port. Enabled by passing --cdp <url> or setting
 *      HUAWEI_CDP_URL.
 *
 * Usage:
 *   npx tsx scripts/content-rating-browser.ts <appId> [--cdp <url>] [--headed]
 *
 * Env vars honoured:
 *   HUAWEI_PROFILE_DIR   Chromium user-data-dir (default: /opt/huawei-profile)
 *   HUAWEI_CDP_URL       Optional CDP endpoint (e.g. http://localhost:9222)
 *   HUAWEI_HEADED        "1" to run headed (useful for local debugging)
 *
 * Historical bug fixed:
 *   Previously used `page.evaluate(async () => {...})`. Under `tsx`, the
 *   TypeScript compiler injects a `__name` helper that is undefined inside the
 *   browser context, causing "__name is not defined" errors. This rewrite uses
 *   Playwright locators exclusively for the questionnaire flow, so no
 *   TS-compiled arrow bodies are ever shipped into the page.
 */
import { runContentRatingAllNo } from "../src/lib/huawei-console";

function parseArgs(argv: string[]): { appId?: string; cdpUrl?: string; headed?: boolean } {
  const out: { appId?: string; cdpUrl?: string; headed?: boolean } = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cdp") {
      out.cdpUrl = argv[++i];
    } else if (a === "--headed") {
      out.headed = true;
    } else if (a.startsWith("--")) {
      // unknown flag, ignore
    } else {
      rest.push(a);
    }
  }
  out.appId = rest[0];
  return out;
}

async function main() {
  const { appId, cdpUrl, headed } = parseArgs(process.argv.slice(2));
  if (!appId) {
    console.error("Usage: npx tsx scripts/content-rating-browser.ts <appId> [--cdp <url>] [--headed]");
    process.exit(1);
  }

  const cdp = cdpUrl || process.env.HUAWEI_CDP_URL || undefined;
  const isHeaded = headed || /^(1|true|yes)$/i.test(process.env.HUAWEI_HEADED ?? "");

  await runContentRatingAllNo(appId, {
    cdpUrl: cdp,
    headed: isHeaded,
    onLog: (line) => console.log(line),
  });

  console.log("\n\u2713 Content rating automation complete!");
}

main().catch((err) => {
  console.error("Content rating automation failed:", (err as Error).message);
  process.exit(1);
});
