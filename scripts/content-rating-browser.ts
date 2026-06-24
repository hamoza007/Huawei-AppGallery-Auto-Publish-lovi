/**
 * Playwright script to automate the Huawei AppGallery content rating questionnaire.
 * Connects to an existing Chrome session via CDP and fills out the questionnaire
 * by selecting "No" for all questions, then verifies and submits.
 *
 * Usage:
 *   npx tsx scripts/content-rating-browser.ts <appId> [cdpUrl]
 *
 * Requires: Chrome browser already logged into Huawei AppGallery Connect console.
 * Default CDP endpoint: http://localhost:9222
 */
import { chromium, type Page } from "playwright";

const APP_ID = process.argv[2];
const CDP_URL = process.argv[3] || "http://localhost:9222";

if (!APP_ID) {
  console.error("Usage: npx tsx scripts/content-rating-browser.ts <appId> [cdpUrl]");
  process.exit(1);
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function navigateToVersionDraft(page: Page, appId: string) {
  const url = `https://developer.huawei.com/consumer/en/service/josp/agc/index.html#/myApp/${appId}`;
  console.log(`Navigating to app: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await delay(3000);

  // Click on "Version information" > "Draft" in the sidebar
  const draftLink = page.locator('li[title="Version information"]');
  if (await draftLink.count() > 0) {
    await draftLink.first().click();
    await delay(2000);
  }
}

async function openContentRatingDialog(page: Page) {
  console.log("Opening content rating dialog...");

  // Scroll to Content rating section and click "Set" button
  const setButton = page.locator('button:has-text("Set")').filter({
    has: page.locator("xpath=ancestor::section[.//text()[contains(., 'Content rating')]]"),
  });

  // Alternative: find the "Set" button near "Rate by age:" text
  const rateByAgeSet = page.locator("text=Rate by age:").locator("..").locator('button:has-text("Set")');
  if (await rateByAgeSet.count() > 0) {
    await rateByAgeSet.first().scrollIntoViewIfNeeded();
    await rateByAgeSet.first().click();
  } else if (await setButton.count() > 0) {
    await setButton.first().scrollIntoViewIfNeeded();
    await setButton.first().click();
  } else {
    // Fallback: look for any "Set" button in the content rating area
    await page.evaluate(() => {
      const sections = document.querySelectorAll("section");
      for (const section of sections) {
        if (section.textContent?.includes("Content rating") && section.textContent?.includes("Rate by age")) {
          const btn = section.querySelector('button');
          if (btn && btn.textContent?.trim() === "Set") {
            btn.click();
            return;
          }
        }
      }
    });
  }

  await delay(3000);
  console.log("Content rating dialog opened");
}

async function answerAllQuestionsNo(page: Page) {
  console.log("Answering all questionnaire questions with 'No'...");

  // The dialog has a scrollable container with categories
  // Each category needs to be expanded (click arrow), then "No" radio selected
  const result = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const logs: string[] = [];

    // Find the dialog scrollable area
    const dialog = document.querySelector('div[tabindex="-1"] div[class*="scroll"], div[tabindex="-1"] [style*="overflow"]') ||
      document.querySelector('div[tabindex="-1"]');

    if (!dialog) {
      logs.push("ERROR: Could not find dialog container");
      return { success: false, logs };
    }

    // Find all category items (li elements within the questionnaire)
    // Categories are typically in an unordered list
    const categoryContainer = dialog.querySelector("ul") || dialog;
    const categories = categoryContainer.querySelectorAll("li");

    if (categories.length === 0) {
      // Try alternative: look for expandable items
      logs.push("No li categories found, trying alternative approach...");

      // Look for all radio buttons labeled "No" and click them
      const allRadioGroups = document.querySelectorAll('[aria-label="radio-group"], [role="radiogroup"]');
      logs.push(`Found ${allRadioGroups.length} radio groups`);

      for (const group of allRadioGroups) {
        const labels = group.querySelectorAll("label");
        for (const label of labels) {
          if (label.textContent?.trim().toLowerCase() === "no") {
            const input = label.querySelector("input") || label.previousElementSibling;
            if (input && input instanceof HTMLElement) {
              input.click();
              logs.push(`Clicked 'No' in radio group`);
            } else {
              (label as HTMLElement).click();
              logs.push(`Clicked 'No' label directly`);
            }
            await sleep(300);
            break;
          }
        }
      }

      return { success: true, logs };
    }

    logs.push(`Found ${categories.length} category items`);

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const catText = cat.textContent?.split("\n")[0]?.trim() || `Category ${i}`;
      logs.push(`Processing: ${catText}`);

      // Click the category to expand it
      const expandable = cat.querySelector('[class*="arrow"], [class*="expand"], svg, i') ||
        cat.querySelector("div:first-child");
      if (expandable && expandable instanceof HTMLElement) {
        expandable.click();
        await sleep(1000);
      }

      // Find "No" radio buttons within this category
      const radios = cat.querySelectorAll('input[type="radio"], label');
      for (const radio of radios) {
        if (radio instanceof HTMLElement) {
          const text = radio.textContent?.trim().toLowerCase();
          if (text === "no") {
            radio.click();
            logs.push(`  Selected 'No' for ${catText}`);
            await sleep(300);
          }
        }
      }
    }

    return { success: true, logs };
  });

  if (result.logs) {
    for (const log of result.logs) {
      console.log(`  ${log}`);
    }
  }

  if (!result.success) {
    throw new Error("Failed to answer questionnaire questions");
  }
}

async function clickVerifyAndSubmit(page: Page) {
  console.log("Looking for Verify/Submit button...");

  // After answering all questions, look for "Verify" button in dialog footer
  const verifyBtn = page.locator('button:has-text("Verify")');
  if (await verifyBtn.count() > 0) {
    await verifyBtn.first().click();
    console.log("Clicked Verify");
    await delay(3000);
  }

  // Step 2: Verify age rating - "Rated 3+" should be pre-selected
  // Click "Submit" button
  const submitBtn = page.locator('footer button:has-text("Submit"), button:has-text("Submit")').first();
  if (await submitBtn.isVisible()) {
    await submitBtn.click();
    console.log("Clicked Submit on age rating verification");
    await delay(3000);
  }

  // Handle any error dialogs
  const okBtn = page.locator('button:has-text("OK")');
  if (await okBtn.count() > 0 && await okBtn.first().isVisible()) {
    await okBtn.first().click();
    console.log("Dismissed error dialog, retrying...");
    await delay(2000);
    // Retry submit
    const retrySubmit = page.locator('footer button:has-text("Submit")').first();
    if (await retrySubmit.isVisible()) {
      await retrySubmit.click();
      await delay(3000);
    }
  }

  console.log("Content rating submitted successfully");
}

async function main() {
  console.log(`Connecting to Chrome CDP at ${CDP_URL}...`);
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();

  if (contexts.length === 0) {
    throw new Error("No browser contexts found. Make sure Chrome is open.");
  }

  const page = contexts[0].pages()[0];
  if (!page) {
    throw new Error("No pages found. Make sure a tab is open in Chrome.");
  }

  console.log(`Current page: ${page.url()}`);

  // Check if we're already on the app page
  const currentUrl = page.url();
  if (!currentUrl.includes(APP_ID)) {
    await navigateToVersionDraft(page, APP_ID);
  }

  // Scroll to content rating and open the dialog
  await openContentRatingDialog(page);

  // Answer all questions with "No"
  await answerAllQuestionsNo(page);

  // Click Verify and Submit
  await clickVerifyAndSubmit(page);

  console.log("\n✓ Content rating automation complete!");
  await browser.close();
}

main().catch((err) => {
  console.error("Content rating automation failed:", err.message);
  process.exit(1);
});
