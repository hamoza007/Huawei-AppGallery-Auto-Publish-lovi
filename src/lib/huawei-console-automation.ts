import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { type AppInfoTemplate, sanitizeCountries } from "./huawei-app-info";

export interface HuaweiConsoleAutomationOptions {
  appId: string;
  packageName?: string | null;
  versionName?: string | null;
  template?: AppInfoTemplate;
  cdpEndpoint?: string;
  appUrl?: string;
  onLog?: (line: string) => void | Promise<void>;
}

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const CONSOLE_HOME =
  "https://developer.huawei.com/consumer/en/service/josp/agc/index.html#/myApp";
const DEFAULT_PRIVACY_POLICY_URL = "https://sites.google.com/view/makeuphanane";
const DEFAULT_CATEGORY_LABELS = ["Games", "Role-playing", "Incremental games", "Casual game"];
const DEFAULT_COMPATIBLE_DEVICES = ["Mobile Phone", "Tablet"];

function truthy(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export function huaweiConsoleAutomationEnabled(): boolean {
  return truthy(process.env.HUAWEI_CONSOLE_AUTOMATION);
}

export function requireConsoleBeforeAutoSubmit(): boolean {
  return truthy(process.env.REQUIRE_HUAWEI_CONSOLE_AUTOMATION_FOR_SUBMIT, true);
}

async function log(opts: HuaweiConsoleAutomationOptions, message: string) {
  await opts.onLog?.(message);
}

async function firstVisible(locator: Locator, timeout = 1500): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    if (await item.isVisible({ timeout }).catch(() => false)) return item;
  }
  return null;
}

async function clickAny(page: Page, labels: string[], timeout = 2500): Promise<boolean> {
  for (const label of labels) {
    const candidates = [
      page.getByRole("button", { name: new RegExp(label, "i") }),
      page.getByRole("link", { name: new RegExp(label, "i") }),
      page.getByText(new RegExp(label, "i")),
    ];
    for (const locator of candidates) {
      const target = await firstVisible(locator, timeout);
      if (!target) continue;
      await target.click({ timeout }).catch(async () => {
        await target.click({ force: true, timeout });
      });
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

async function scrollAndClickAny(page: Page, labels: string[], timeout = 2500): Promise<boolean> {
  for (let pass = 0; pass < 6; pass += 1) {
    if (await clickAny(page, labels, timeout)) return true;
    await page.mouse.wheel(0, 650).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  return false;
}

async function clickScopedChoice(page: Page, fieldLabels: string[], choices: string[]): Promise<boolean> {
  for (const fieldLabel of fieldLabels) {
    const fieldNode = await firstVisible(page.getByText(new RegExp(fieldLabel, "i")), 1200);
    if (!fieldNode) continue;
    const container = fieldNode.locator(
      "xpath=ancestor::*[self::div or self::section or self::form or self::tr][1]",
    );
    for (const choice of choices) {
      const escaped = choice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const localChoice = await firstVisible(
        container
          .getByRole("radio", { name: new RegExp(escaped, "i") })
          .or(container.getByRole("checkbox", { name: new RegExp(escaped, "i") }))
          .or(container.getByText(new RegExp(`^\\s*${escaped}\\s*$`, "i"))),
        1200,
      );
      if (localChoice) {
        await localChoice.click({ timeout: 2000 }).catch(async () => localChoice.click({ force: true, timeout: 2000 }));
        await page.waitForTimeout(300);
        return true;
      }
    }
  }
  return false;
}

async function fillNearLabel(page: Page, label: string, value: string): Promise<boolean> {
  const directTarget = await firstVisible(page.getByLabel(new RegExp(label, "i")));
  if (directTarget) {
    await directTarget.fill(value);
    return true;
  }

  const labelNode = await firstVisible(page.getByText(new RegExp(label, "i")));
  if (!labelNode) return false;
  const container = labelNode.locator("xpath=ancestor::*[self::div or self::section or self::form][1]");
  const input = await firstVisible(container.locator("input, textarea"));
  if (!input) return false;
  await input.fill(value);
  return true;
}

async function fillScopedText(page: Page, labels: string[], value: string): Promise<boolean> {
  for (const label of labels) {
    if (await fillNearLabel(page, label, value).catch(() => false)) return true;
  }
  return false;
}

async function chooseOption(page: Page, label: string): Promise<boolean> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const option = await firstVisible(
    page
      .getByRole("option", { name: new RegExp(escaped, "i") })
      .or(page.getByText(new RegExp(`^\\s*${escaped}\\s*$`, "i"))),
    3000,
  );
  if (!option) return false;
  await option.click({ timeout: 3000 }).catch(async () => option.click({ force: true, timeout: 3000 }));
  await page.waitForTimeout(300);
  return true;
}

async function connect(opts: HuaweiConsoleAutomationOptions): Promise<{ browser: Browser; page: Page }> {
  const endpoint = opts.cdpEndpoint ?? process.env.HUAWEI_CDP_ENDPOINT ?? DEFAULT_CDP_ENDPOINT;
  await log(opts, `Connecting to Chrome CDP at ${endpoint}`);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(Number(process.env.HUAWEI_CONSOLE_TIMEOUT_MS ?? 10_000));
  return { browser, page };
}

function resolveAppUrl(opts: HuaweiConsoleAutomationOptions): string {
  const explicit = opts.appUrl ?? process.env.HUAWEI_CONSOLE_APP_URL;
  if (explicit) return explicit.replaceAll("{appId}", opts.appId);
  const template = process.env.HUAWEI_CONSOLE_APP_URL_TEMPLATE;
  if (template) return template.replaceAll("{appId}", opts.appId);
  return CONSOLE_HOME;
}

async function openApp(page: Page, opts: HuaweiConsoleAutomationOptions) {
  const url = resolveAppUrl(opts);
  await log(opts, `Opening Huawei Console for app ${opts.appId}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

  if (!page.url().includes(opts.appId)) {
    const opened = await clickAny(page, [opts.appId, opts.packageName ?? ""].filter(Boolean));
    if (opened) {
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    }
  }
}

async function saveIfPossible(page: Page) {
  await clickAny(page, ["Save", "OK", "Confirm", "Submit"], 1500);
}

async function applyCompatibleDevices(page: Page, opts: HuaweiConsoleAutomationOptions) {
  await log(opts, `Setting compatible devices: ${DEFAULT_COMPATIBLE_DEVICES.join(" and ")}`);
  if (!(await scrollAndClickAny(page, ["Compatible devices", "Device types", "Supported devices"], 1500))) return;
  for (const device of DEFAULT_COMPATIBLE_DEVICES) {
    await clickAny(page, [device], 1200);
  }
  await saveIfPossible(page);
}

async function applyBasicFields(page: Page, opts: HuaweiConsoleAutomationOptions) {
  const template = opts.template ?? {};
  await scrollAndClickAny(page, ["Version information", "Version Information", "Draft"], 2000);

  const privacyPolicyUrl = template.privacyPolicy ?? DEFAULT_PRIVACY_POLICY_URL;
  if (privacyPolicyUrl) {
    await log(opts, "Setting privacy policy URL");
    await fillScopedText(page, ["Privacy policy URL", "Privacy"], privacyPolicyUrl);
  }

  await log(opts, "Setting payment type to Free when the field is present");
  await clickScopedChoice(page, ["Payment type", "Paid or free", "Pricing"], ["Free"]);

  await log(opts, "Setting use testing version to No when the field is present");
  await clickScopedChoice(page, ["Use testing version", "Testing version"], ["No"]);

  await log(opts, "Setting collect personal data to No when the field is present");
  await clickScopedChoice(page, ["Collect personal data", "Personal data"], ["No"]);

  await log(opts, "Setting generative AI declaration to Not involved when present");
  await clickScopedChoice(page, ["Generative AI", "AI-generated", "AI service"], ["Not involved", "No"]);

  await log(opts, "Setting release time to Immediately when present");
  await clickScopedChoice(page, ["Release time", "Release schedule"], ["Immediately", "Upon approval"]);

  await saveIfPossible(page);
}

async function applyCategory(page: Page, opts: HuaweiConsoleAutomationOptions) {
  const categoryLabels = (process.env.HUAWEI_CONSOLE_CATEGORY_LABELS ?? DEFAULT_CATEGORY_LABELS.join("|"))
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (categoryLabels.length === 0) return;

  await log(opts, `Applying category path: ${categoryLabels.join(" / ")}`);
  if (!(await clickAny(page, ["App information", "App Information"], 2000))) return;
  if (!(await clickAny(page, ["Category", "App category"], 2000))) return;

  for (const label of categoryLabels) {
    if (!(await chooseOption(page, label))) {
      await clickAny(page, [label], 1500);
    }
  }
  await saveIfPossible(page);
}

async function applyCountries(page: Page, opts: HuaweiConsoleAutomationOptions) {
  const countries = sanitizeCountries(opts.template?.publishCountry);

  await log(opts, "Selecting all publish countries except Chinese mainland");
  if (!(await scrollAndClickAny(page, ["Version information", "Version Information", "Distribution", "Countries"], 2500))) return;
  if (await clickAny(page, ["Select all", "All countries", "All Countries"], 2500)) {
    await clickAny(page, ["Chinese mainland"], 1200);
    await saveIfPossible(page);
    return;
  }

  if (!countries) return;
  const countryList = countries.split(",");
  for (const country of countryList) {
    await fillNearLabel(page, "Search", country).catch(() => false);
    await clickAny(page, [country], 800);
  }
  await saveIfPossible(page);
}

async function answerVisibleNoQuestions(page: Page, opts: HuaweiConsoleAutomationOptions): Promise<number> {
  let answered = 0;
  const noLabels = page.getByText(/^\s*No\s*$/i);
  const count = await noLabels.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const label = noLabels.nth(i);
    if (!(await label.isVisible().catch(() => false))) continue;
    const checked = await label
      .locator("xpath=ancestor::label[1]//input")
      .isChecked()
      .catch(() => false);
    if (checked) continue;
    await label.click({ timeout: 1500 }).catch(async () => label.click({ force: true, timeout: 1500 }));
    answered += 1;
  }
  if (answered > 0) await log(opts, `Answered ${answered} visible content-rating question(s) with No`);
  return answered;
}

async function completeContentRating(page: Page, opts: HuaweiConsoleAutomationOptions) {
  await log(opts, "Opening content rating questionnaire");
  const opened = await scrollAndClickAny(page, ["Content rating", "Age rating", "Rating questionnaire"], 5000);
  if (!opened) {
    await log(opts, "Content rating section was not visible; skipping questionnaire");
    return;
  }
  await clickAny(page, ["Start questionnaire", "Start", "Edit", "Rate by age"], 3000);

  for (let pass = 0; pass < 12; pass += 1) {
    await clickAny(page, ["Expand all", "Open all"], 1000);
    const expanded = await clickAny(page, [
      "Violence",
      "Fear",
      "Sexuality",
      "Language",
      "Controlled substances",
      "Gambling",
      "Online",
      "Location",
      "User interaction",
      "Data",
      "Miscellaneous",
    ], 700);
    const answered = await answerVisibleNoQuestions(page, opts);
    await clickAny(page, ["Next"], 1200);
    if (!expanded && answered === 0) break;
    await page.waitForTimeout(400);
  }

  await clickAny(page, ["Verify", "Save", "Confirm"], 3000);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

export async function runHuaweiConsoleRequiredFields(opts: HuaweiConsoleAutomationOptions): Promise<void> {
  const { browser, page } = await connect(opts);
  try {
    await openApp(page, opts);
    await applyCompatibleDevices(page, opts);
    await applyCategory(page, opts);
    await applyCountries(page, opts);
    await applyBasicFields(page, opts);
    await completeContentRating(page, opts);
    await log(opts, "Huawei Console automation completed");
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function runHuaweiContentRatingNo(opts: HuaweiConsoleAutomationOptions): Promise<void> {
  const { browser, page } = await connect(opts);
  try {
    await openApp(page, opts);
    await completeContentRating(page, opts);
    await log(opts, "Huawei content rating questionnaire completed");
  } finally {
    await browser.close().catch(() => undefined);
  }
}
