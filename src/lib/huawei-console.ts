/**
 * Huawei AppGallery Connect Console automation via Playwright.
 *
 * Purpose:
 *   Certain publishing fields cannot be set through the Connect Publishing API
 *   (either because the endpoint returns 404 or because the API rejects the
 *   value for first-version apps). We drive those fields through the developer
 *   console UI instead. Fields covered:
 *     - Category (App Information)               API returns "BM not exist"
 *     - Distribution countries (Version Info)    API returns "BT/BM not exist"
 *     - Content rating questionnaire (all No)    API returns 404
 *     - Collect personal data = No               not exposed by API
 *     - Generative AI service = Not involved     not exposed by API
 *     - Release time = Immediately once approved not exposed by API
 *     - Submit for review                        used as fallback if API submit
 *                                                fails with "Incomplete
 *                                                application version information"
 *
 * Connection model:
 *   We prefer a *persistent Chromium profile* on disk (default
 *   /opt/huawei-profile). Operator runs `scripts/huawei-login.ts` once, logs
 *   into https://developer.huawei.com/, and the cookies stay on disk. Every
 *   subsequent automated run reuses the same profile with no attached browser.
 *
 *   As a fallback we also support CDP attach (connect to an already-running
 *   Chrome via --remote-debugging-port) for local debugging.
 *
 * Why locators instead of page.evaluate():
 *   The previous script used `page.evaluate(async () => { ... })`. `tsx`
 *   compiles those arrow bodies with a `__name` helper that references a
 *   module-level constant the browser context does not have, producing
 *   "__name is not defined" errors. All page interaction here is done through
 *   Playwright locators, which never inject TS-compiled code.
 */
import { promises as fs } from "fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

const CONSOLE_ORIGIN = "https://developer.huawei.com";
const CONSOLE_APP_PATH = "/consumer/en/service/josp/agc/index.html#/myApp";

export interface ConsoleOptions {
  /** Optional CDP endpoint. If set, we attach instead of launching. */
  cdpUrl?: string;
  /** Show a visible browser (persistent-context mode only). */
  headed?: boolean;
  /** Override the on-disk profile directory. */
  profileDir?: string;
  /** Per-step log callback. */
  onLog?: (line: string) => void | Promise<void>;
  /** Extra wait between clicks in ms (default 400). */
  clickDelayMs?: number;
  /** Global step timeout in ms (default 60_000). */
  stepTimeoutMs?: number;
}

interface Session {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

function defaultProfileDir(): string {
  return process.env.HUAWEI_PROFILE_DIR || "/opt/huawei-profile";
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

async function log(opts: ConsoleOptions, line: string): Promise<void> {
  if (opts.onLog) await opts.onLog(line);
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Open the AppGallery Connect console.
 *
 * If cdpUrl is provided, attach to an existing Chrome. Otherwise launch a
 * persistent Chromium context. If the console redirects to a login page we
 * throw a clear error (the worker surfaces "please re-authenticate" to the UI).
 */
export async function openConsole(opts: ConsoleOptions = {}): Promise<Session> {
  const cdpUrl = opts.cdpUrl || process.env.HUAWEI_CDP_URL;
  if (cdpUrl) {
    await log(opts, `Attaching to Chrome at ${cdpUrl}`);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    if (contexts.length === 0) throw new Error("No browser contexts found on CDP endpoint");
    const context = contexts[0];
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      browser,
      context,
      page,
      close: async () => {
        await browser.close().catch(() => {});
      },
    };
  }

  const profile = opts.profileDir || defaultProfileDir();
  await ensureDir(profile);
  await log(opts, `Launching persistent Chromium (profile=${profile}, headed=${!!opts.headed})`);
  const context = await chromium.launchPersistentContext(profile, {
    headless: !opts.headed,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    close: async () => {
      await context.close().catch(() => {});
    },
  };
}

/**
 * Navigate to the given app's console page and check that we're not sitting on
 * the login screen. Throws with a clear message on session expiry so the worker
 * can surface it.
 */
export async function navigateToApp(page: Page, appId: string, opts: ConsoleOptions = {}): Promise<void> {
  const url = `${CONSOLE_ORIGIN}${CONSOLE_APP_PATH}/${encodeURIComponent(appId)}`;
  await log(opts, `Navigating to ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.stepTimeoutMs ?? 60_000 });
  await page.waitForLoadState("networkidle", { timeout: opts.stepTimeoutMs ?? 60_000 }).catch(() => {});
  await delay(1500);

  // Detect the SSO login screen.
  const currentUrl = page.url();
  if (/\/id\/|login|signin/i.test(currentUrl) && !currentUrl.includes(appId)) {
    throw new Error(
      `Huawei console session expired (redirected to ${currentUrl}). ` +
        `Run \`npx tsx scripts/huawei-login.ts\` on the host to re-authenticate.`,
    );
  }
}

// ---------------------- Generic helpers ----------------------

/**
 * Click the first visible match for any of the given locators, in order.
 * Returns the locator that succeeded, or undefined if none matched.
 */
async function clickFirstVisible(
  candidates: Locator[],
  opts: ConsoleOptions = {},
  timeoutPerCandidate = 2000,
): Promise<Locator | undefined> {
  for (const c of candidates) {
    try {
      const first = c.first();
      await first.waitFor({ state: "visible", timeout: timeoutPerCandidate });
      await first.scrollIntoViewIfNeeded().catch(() => {});
      await first.click({ timeout: timeoutPerCandidate });
      await delay(opts.clickDelayMs ?? 400);
      return first;
    } catch {
      // try next
    }
  }
  return undefined;
}

/**
 * Click all locators that resolve, ignoring individual failures. Useful for
 * "expand all sections" style operations.
 */
async function clickAll(locator: Locator, opts: ConsoleOptions = {}): Promise<number> {
  const count = await locator.count();
  let clicked = 0;
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    try {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 2000 });
      clicked++;
      await delay(opts.clickDelayMs ?? 250);
    } catch {
      // ignore
    }
  }
  return clicked;
}

// ---------------------- App Information: Category ----------------------

export interface CategorySelection {
  /** e.g. "Games" */
  parent: string;
  /** e.g. "Role-playing" */
  child: string;
  /** e.g. "Incremental games" */
  grandChild: string;
  /** Optional secondary tag, e.g. "Casual game" */
  extraTag?: string;
}

/**
 * Set the category on the App Information page.
 *
 * Huawei's console renders a 3-level cascader for parent/child/grand-child and
 * an optional "Casual game" tag checkbox for the Games branch.
 */
export async function setCategory(
  page: Page,
  category: CategorySelection,
  opts: ConsoleOptions = {},
): Promise<void> {
  await log(opts, `Setting category: ${category.parent} > ${category.child} > ${category.grandChild}`);

  // Navigate to App Information via sidebar.
  await clickFirstVisible(
    [
      page.locator('li[title="App information"]'),
      page.getByRole("menuitem", { name: /App information/i }),
      page.locator('a:has-text("App information")'),
    ],
    opts,
    3000,
  );
  await delay(1500);

  // Click "Edit" next to Category if it's collapsed.
  await clickFirstVisible(
    [
      page.locator('label:has-text("Category")').locator("..").locator('button:has-text("Edit")'),
      page.locator('button:has-text("Edit")').filter({ hasText: /Category/i }),
    ],
    opts,
    2000,
  );

  // Open the cascader input by clicking the placeholder area.
  await clickFirstVisible(
    [
      page.locator('label:has-text("Category")').locator("..").locator("input"),
      page.locator('.ant-cascader-picker, .el-cascader').first(),
    ],
    opts,
    3000,
  );

  // Pick each level from the dropdown list.
  for (const label of [category.parent, category.child, category.grandChild]) {
    const item = page
      .locator(
        `[role="menuitem"]:has-text("${label}"), .ant-cascader-menu-item:has-text("${label}"), li:has-text("${label}")`,
      )
      .first();
    await item.waitFor({ state: "visible", timeout: 5000 });
    await item.click();
    await delay(opts.clickDelayMs ?? 400);
  }

  // Optional "Casual game" tag checkbox.
  if (category.extraTag) {
    const tag = page.locator(`label:has-text("${category.extraTag}") input[type="checkbox"]`).first();
    if (await tag.count() > 0) {
      const checked = await tag.isChecked().catch(() => false);
      if (!checked) {
        await tag.check({ timeout: 3000 }).catch(async () => {
          // Some Huawei skins render the checkbox behind a span
          await page.locator(`label:has-text("${category.extraTag}")`).first().click();
        });
      }
    }
  }

  // Save.
  await clickFirstVisible(
    [
      page.getByRole("button", { name: /^Save$/ }),
      page.locator('button:has-text("Save"):not(:has-text("Draft"))'),
    ],
    opts,
    3000,
  );
  await delay(1500);
  await log(opts, "Category saved");
}

// ---------------------- Version Information: Countries ----------------------

/**
 * Set distribution countries to "all except Chinese mainland" on the Version
 * Information page. Huawei's console has a dedicated "Select all" checkbox and
 * a China checkbox we can uncheck.
 */
export async function setCountriesAllExceptChina(page: Page, opts: ConsoleOptions = {}): Promise<void> {
  await log(opts, "Setting distribution countries (all except Chinese mainland)");

  await clickFirstVisible(
    [
      page.locator('li[title="Version information"]'),
      page.getByRole("menuitem", { name: /Version information/i }),
      page.locator('a:has-text("Version information")'),
    ],
    opts,
    3000,
  );
  await delay(1500);

  // Open the "Selected countries/regions" edit modal.
  await clickFirstVisible(
    [
      page.locator('label:has-text("Selected countries/regions")').locator("..").locator('button:has-text("Edit")'),
      page.locator('label:has-text("Countries")').locator("..").locator('button:has-text("Edit")'),
      page.locator('button:has-text("Select countries/regions")'),
    ],
    opts,
    3000,
  );
  await delay(1000);

  // Click "Select all".
  await clickFirstVisible(
    [
      page.getByRole("checkbox", { name: /Select all/i }),
      page.locator('label:has-text("Select all") input[type="checkbox"]'),
      page.locator('span:has-text("Select all")'),
    ],
    opts,
    3000,
  );

  // Uncheck Chinese mainland.
  const china = page
    .locator(
      'label:has-text("Chinese mainland") input[type="checkbox"], label:has-text("China") input[type="checkbox"]',
    )
    .first();
  if (await china.count() > 0) {
    try {
      await china.uncheck({ timeout: 3000 });
    } catch {
      // Some skins need to click the label
      await page.locator('label:has-text("Chinese mainland")').first().click().catch(() => {});
    }
  }

  // Save.
  await clickFirstVisible(
    [
      page.getByRole("button", { name: /^OK$/ }),
      page.getByRole("button", { name: /^Confirm$/ }),
      page.getByRole("button", { name: /^Save$/ }),
    ],
    opts,
    3000,
  );
  await delay(1500);
  await log(opts, "Countries saved");
}

// ---------------------- Version Information: Content Rating ----------------------

/**
 * Open the content rating dialog, expand all 11 categories, click "No" for
 * every question, then Verify + Submit.
 *
 * This is the flow that used to fail with __name errors. Now uses locators
 * exclusively: no page.evaluate.
 */
export async function answerContentRatingNo(page: Page, opts: ConsoleOptions = {}): Promise<void> {
  await log(opts, "Answering content rating questionnaire with all No");

  // Version Information sidebar (may already be selected).
  await clickFirstVisible(
    [
      page.locator('li[title="Version information"]'),
      page.getByRole("menuitem", { name: /Version information/i }),
    ],
    opts,
    2000,
  );

  // Open the content rating "Set" button.
  const openBtn =
    (await clickFirstVisible(
      [
        page.locator('label:has-text("Rate by age")').locator("..").locator('button:has-text("Set")'),
        page.locator('label:has-text("Rate by age")').locator("..").locator('button:has-text("Edit")'),
        page.locator('label:has-text("Content rating")').locator("..").locator('button:has-text("Set")'),
      ],
      opts,
      3000,
    )) ??
    (await clickFirstVisible(
      [page.locator('button:has-text("Set")').filter({ hasText: /rating|Rate/i })],
      opts,
      2000,
    ));

  if (!openBtn) {
    // Maybe already open. Continue.
    await log(opts, "Rate-by-age Set button not found; assuming dialog is already open");
  }
  await delay(1500);

  // Expand all category rows so radio inputs are in the DOM.
  // Huawei renders each of the 11 categories as an expandable row with a caret icon.
  const carets = page.locator(
    '[role="dialog"] .anticon-right, [role="dialog"] .anticon-down, [role="dialog"] [class*="arrow"], [role="dialog"] [class*="expand"]',
  );
  const caretCount = await carets.count();
  await log(opts, `Found ${caretCount} category expanders`);
  // Click each; if it collapses instead we'll reopen.
  for (let i = 0; i < caretCount; i++) {
    const el = carets.nth(i);
    try {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 2000 });
      await delay(200);
    } catch {
      // ignore
    }
  }

  // Click every "No" radio label within the dialog. Huawei uses ant-radio;
  // labels contain the text "No". We select ONLY radios in the questionnaire
  // scope by anchoring on the [role="dialog"].
  const noLabels = page.locator(
    '[role="dialog"] label:has-text("No"), [role="dialog"] .ant-radio-wrapper:has-text("No")',
  );
  const noCount = await noLabels.count();
  await log(opts, `Found ${noCount} "No" radio labels`);
  let clicked = 0;
  for (let i = 0; i < noCount; i++) {
    const el = noLabels.nth(i);
    // Only click labels whose immediate text is exactly "No" (case-insensitive,
    // trimmed). This avoids clicking things like "Not applicable".
    const raw = ((await el.textContent()) ?? "").trim().toLowerCase();
    if (raw !== "no") continue;
    try {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 2000, force: true });
      clicked++;
      await delay(150);
    } catch {
      // ignore
    }
  }
  await log(opts, `Selected 'No' on ${clicked} questions`);

  // Click Verify.
  await clickFirstVisible(
    [
      page.locator('[role="dialog"] button:has-text("Verify")'),
      page.getByRole("button", { name: /Verify/i }),
    ],
    opts,
    5000,
  );
  await delay(2500);

  // Confirmation screen: click Submit.
  await clickFirstVisible(
    [
      page.locator('[role="dialog"] button:has-text("Submit")'),
      page.getByRole("button", { name: /^Submit$/ }),
    ],
    opts,
    5000,
  );
  await delay(2500);

  // Some flows show a follow-up OK; dismiss it if present.
  const ok = page.getByRole("button", { name: /^OK$/ }).first();
  if (await ok.isVisible().catch(() => false)) {
    await ok.click().catch(() => {});
    await delay(1000);
  }

  await log(opts, "Content rating submitted");
}

// ---------------------- Version Information: Booleans ----------------------

/**
 * Toggle a "Yes/No" style question by label. `desiredValue` is "Yes" or "No".
 * Works for both the "Collect personal data" and "Generative AI" sections
 * which render as inline radio pairs.
 */
async function setYesNoField(
  page: Page,
  label: RegExp | string,
  desiredValue: "Yes" | "No",
  opts: ConsoleOptions = {},
): Promise<void> {
  const scope = page
    .locator("section, div")
    .filter({ has: page.locator(`label:text-matches("${label instanceof RegExp ? label.source : label}", "i")`) })
    .first();

  const radio = scope
    .locator(
      `label:has-text("${desiredValue}") input[type="radio"], .ant-radio-wrapper:has-text("${desiredValue}")`,
    )
    .first();

  if (await radio.count() === 0) {
    // Fallback: click any radio labelled desiredValue near the label text.
    await page
      .getByText(label)
      .locator("xpath=ancestor::*[self::section or self::div][1]")
      .locator(`label:has-text("${desiredValue}"), .ant-radio-wrapper:has-text("${desiredValue}")`)
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    return;
  }

  try {
    await radio.check({ timeout: 3000 });
  } catch {
    await radio.click({ timeout: 3000, force: true }).catch(() => {});
  }
  await delay(opts.clickDelayMs ?? 400);
}

export async function setCollectPersonalDataNo(page: Page, opts: ConsoleOptions = {}): Promise<void> {
  await log(opts, "Setting Collect personal data = No");
  await setYesNoField(page, /Collect personal data/i, "No", opts);
  // Some layouts require a Save inside the section.
  const save = page
    .locator('section:has(label:has-text("Collect personal data")) button:has-text("Save")')
    .first();
  if (await save.isVisible().catch(() => false)) await save.click().catch(() => {});
  await delay(700);
}

export async function setAiNotInvolved(page: Page, opts: ConsoleOptions = {}): Promise<void> {
  await log(opts, "Setting Generative AI service = Not involved");
  // Huawei uses "Not involved" as the option label rather than "No".
  await setYesNoField(page, /Generative AI/i, "No", opts);
  // If a "Not involved" radio exists instead of a Yes/No pair, prefer that.
  const notInvolved = page
    .locator('label:has-text("Not involved"), .ant-radio-wrapper:has-text("Not involved")')
    .first();
  if (await notInvolved.isVisible().catch(() => false)) {
    await notInvolved.click({ force: true }).catch(() => {});
    await delay(500);
  }
  const save = page
    .locator('section:has(label:has-text("Generative AI")) button:has-text("Save")')
    .first();
  if (await save.isVisible().catch(() => false)) await save.click().catch(() => {});
  await delay(700);
}

export async function setReleaseImmediately(page: Page, opts: ConsoleOptions = {}): Promise<void> {
  await log(opts, "Setting Release time = Immediately once approved");
  // Radio labelled "Immediately once approved" (or similar).
  const radio = page
    .locator(
      'label:has-text("Immediately"), .ant-radio-wrapper:has-text("Immediately"), label:has-text("Once approved")',
    )
    .first();
  if (await radio.isVisible().catch(() => false)) {
    await radio.click({ force: true }).catch(() => {});
  }
  const save = page
    .locator('section:has(label:has-text("Release time")) button:has-text("Save")')
    .first();
  if (await save.isVisible().catch(() => false)) await save.click().catch(() => {});
  await delay(700);
}

// ---------------------- Submit for review (console fallback) ----------------------

export async function submitForReviewConsole(page: Page, opts: ConsoleOptions = {}): Promise<void> {
  await log(opts, "Clicking Submit for review in console");

  // The submit button lives at the top-right of the Version Information page.
  const submit = await clickFirstVisible(
    [
      page.getByRole("button", { name: /^Submit for review$/i }),
      page.locator('button:has-text("Submit for review")'),
      page.getByRole("button", { name: /^Submit$/ }),
    ],
    opts,
    5000,
  );
  if (!submit) throw new Error('Could not find "Submit for review" button in console');
  await delay(1500);

  // Confirmation dialog.
  await clickFirstVisible(
    [
      page.getByRole("button", { name: /^OK$/ }),
      page.getByRole("button", { name: /^Confirm$/ }),
      page.getByRole("button", { name: /^Submit$/ }),
    ],
    opts,
    3000,
  );
  await delay(2000);
  await log(opts, "Submit clicked; awaiting console confirmation");
}

// ---------------------- Public: one-shot content-rating run ----------------------

/**
 * Convenience wrapper used by scripts/content-rating-browser.ts.
 */
export async function runContentRatingAllNo(
  appId: string,
  opts: ConsoleOptions = {},
): Promise<void> {
  const session = await openConsole(opts);
  try {
    await navigateToApp(session.page, appId, opts);
    await answerContentRatingNo(session.page, opts);
  } finally {
    await session.close().catch(() => {});
  }
}

// ---------------------- Public: full console fallback ----------------------

export interface FullConsoleFlowOptions extends ConsoleOptions {
  category?: CategorySelection;
  setCountries?: boolean;
  setContentRating?: boolean;
  setPersonalData?: boolean;
  setAi?: boolean;
  setReleaseTime?: boolean;
  submit?: boolean;
}

/**
 * Runs whichever subset of console-only steps the caller enables, in the
 * canonical Huawei order: Category -> Countries -> Content rating -> Personal
 * data -> AI -> Release time -> Submit.
 *
 * Each step is isolated so a failure in one does not abort the rest; the
 * function returns per-step results the caller can log.
 */
export async function runConsoleFlow(
  appId: string,
  flow: FullConsoleFlowOptions,
): Promise<Array<{ step: string; ok: boolean; error?: string }>> {
  const results: Array<{ step: string; ok: boolean; error?: string }> = [];
  const session = await openConsole(flow);
  try {
    await navigateToApp(session.page, appId, flow);

    if (flow.category) {
      await runStep(results, "category", () => setCategory(session.page, flow.category!, flow));
      // After changing App Info, we need to be back on Version Info for the
      // remaining steps.
      await clickFirstVisible(
        [
          session.page.locator('li[title="Version information"]'),
          session.page.getByRole("menuitem", { name: /Version information/i }),
        ],
        flow,
        3000,
      );
      await delay(1500);
    }

    if (flow.setCountries) {
      await runStep(results, "countries", () => setCountriesAllExceptChina(session.page, flow));
    }
    if (flow.setContentRating) {
      await runStep(results, "contentRating", () => answerContentRatingNo(session.page, flow));
    }
    if (flow.setPersonalData) {
      await runStep(results, "personalData", () => setCollectPersonalDataNo(session.page, flow));
    }
    if (flow.setAi) {
      await runStep(results, "aiNotInvolved", () => setAiNotInvolved(session.page, flow));
    }
    if (flow.setReleaseTime) {
      await runStep(results, "releaseTime", () => setReleaseImmediately(session.page, flow));
    }
    if (flow.submit) {
      await runStep(results, "submit", () => submitForReviewConsole(session.page, flow));
    }
  } finally {
    await session.close().catch(() => {});
  }
  return results;
}

async function runStep(
  results: Array<{ step: string; ok: boolean; error?: string }>,
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    results.push({ step: name, ok: true });
  } catch (err) {
    results.push({ step: name, ok: false, error: (err as Error).message });
  }
}

// ---------------------- Guard: is automation enabled ----------------------

export function consoleAutomationEnabled(): boolean {
  const flag = process.env.HUAWEI_CONSOLE_AUTOMATION;
  if (flag === undefined) return true; // default on when profile exists
  return /^(1|true|yes|on)$/i.test(flag);
}

export async function profileExists(dir = defaultProfileDir()): Promise<boolean> {
  try {
    const s = await fs.stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}
