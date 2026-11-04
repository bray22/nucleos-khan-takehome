
const { chromium } = require("playwright");

async function main() {
  let browser;

  try {
    // Launch Chromium first
    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Browser diagnostics.
    page.on("close", () => {
      // console.log("[Browser] Page closed");
    });

    page.on("crash", () => {
      // console.error("[Browser] Page crashed");
    });

    browser.on("disconnected", () => {
      // console.log("[Browser] Browser disconnected");
    });

    // Open Khan Academy registration.
    // console.log("[Onboarding] Opening Khan Academy...");

    await page.goto("https://www.khanacademy.org/signup", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // console.log("[Onboarding] Current URL:", page.url());
    // console.log("[Onboarding] Page title:", await page.title());

    // Handle cookie consent if present.
    const necessaryCookies = page.getByRole("button", {
      name: "Strictly Necessary Only",
    });

    if (await necessaryCookies.isVisible().catch(() => false)) {
      await necessaryCookies.click();
      // console.log("[Onboarding] Cookie preferences selected.");
    }

    // Select Student registration.
    // console.log("[Onboarding] Selecting Student registration...");

    await page
      .getByText("Student learning on my own", {
        exact: true,
      })
      .click({ timeout: 15000 });

    // console.log("[Onboarding] Student registration selected.");

    //  Wait for date-of-birth screen.
    await page
      .getByText("Date of birth", { exact: true })
      .waitFor({
        state: "visible",
        timeout: 15000,
      });

    // console.log("[Onboarding] Date-of-birth page detected.");

    // Select birth month.
    // Use the actual birth month of the adult registering.
    const birthMonth = "Jul";

    // console.log("[Onboarding] Selecting birth month...");

    await page
      .locator('button[aria-label="Month"]')
      .click({ timeout: 15000 });

    await page
      .getByRole("option", {
        name: birthMonth,
        exact: true,
      })
      .click();

    // console.log("[Onboarding] Birth month selected.");

    // Select birth year.
    // Use the actual birth year of the adult registering.
    const birthYear = "1974";

    // console.log("[Onboarding] Selecting birth year...");

    await page
      .locator('button[aria-label="Year"]')
      .click({ timeout: 15000 });

    await page
      .getByRole("option", {
        name: birthYear,
        exact: true,
      })
      .click();

    // console.log("[Onboarding] Birth year selected.");

    // Advance to the next registration step.
    // console.log("[Onboarding] Clicking Next...");

    await page
      .getByRole("button", {
        name: "Next",
        exact: true,
      })
      .click({ timeout: 15000 });

    // console.log("[Onboarding] Advanced to next registration step.");

    // Inspect the next screen.
    const nextPageText = await page
      .locator("main")
      .innerText()
      .catch(() => page.locator("body").innerText());

    // console.log("\n[Onboarding] Next screen:");
    // console.log(nextPageText.slice(0, 3000));

    // Inspect input fields without reading their values.
    const inputs = await page
      .locator("input")
      .evaluateAll((elements) =>
        elements.map((input) => ({
          type: input.type,
          name: input.name,
          placeholder: input.placeholder,
          ariaLabel: input.getAttribute("aria-label"),
          autocomplete: input.autocomplete,
        }))
      );

    // console.log(
    //   "\n[Onboarding] Input fields:",
    //   JSON.stringify(inputs, null, 2)
    // );

    // Inspect buttons on the next screen.
    const buttons = await page
      .getByRole("button")
      .allTextContents();

    // console.log(
    //   "\n[Onboarding] Buttons:",
    //   JSON.stringify(buttons, null, 2)
    // );

    // Step 10: Save screenshot for inspection.
    await page.screenshot({
      path: "registration-next-debug.png",
      fullPage: true,
    });

    // console.log("\n[Onboarding] Screenshot saved.");
    // console.log("[Onboarding] No account has been created.");
    // console.log("[Onboarding] Close the browser when finished.");

    // Keep Chromium open for manual inspection.
    await page.waitForEvent("close", {
      timeout: 0,
    });

  } catch (error) {
    // console.error("[Onboarding] Error:", error.message);
    process.exitCode = 1;
  } finally {
    if (browser && browser.isConnected()) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  // console.error("[Onboarding] Unexpected error:", error.message);
  process.exitCode = 1;
});
