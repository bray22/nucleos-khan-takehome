
require("dotenv").config();

const { chromium } = require("playwright");

const SIGNUP_URL = "https://www.khanacademy.org/signup";

// Use the actual birth month and year of the adult registering.
const BIRTH_MONTH = "Jul";
const BIRTH_YEAR = "1974";

async function main() {
  let browser;

  try {
    // Load credentials from .env.
    const email = process.env.KHAN_EMAIL;
    const password = process.env.KHAN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "Missing KHAN_EMAIL or KHAN_PASSWORD in .env"
      );
    }

    console.log("[Onboarding] Starting registration...");

    // Launch Chromium.
    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Browser diagnostics.
    page.on("close", () => {
      console.log("[Browser] Page closed");
    });

    page.on("crash", () => {
      console.error("[Browser] Page crashed");
    });

    browser.on("disconnected", () => {
      console.log("[Browser] Browser disconnected");
    });

    // Step 1: Open Khan Academy.
    console.log("[Onboarding] Opening Khan Academy...");

    await page.goto(SIGNUP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    console.log("[Onboarding] Page loaded.");

    // Step 2: Handle cookie consent if present.
    const necessaryCookies = page.getByRole("button", {
      name: "Strictly Necessary Only",
    });

    if (await necessaryCookies.isVisible().catch(() => false)) {
      await necessaryCookies.click();
      console.log("[Onboarding] Cookie preferences selected.");
    }

    // Step 3: Select learner registration.
    console.log("[Onboarding] Selecting learner registration...");

    await page
      .getByText("Student learning on my own", {
        exact: true,
      })
      .click({ timeout: 15000 });

    console.log("[Onboarding] Learner registration selected.");

    // Step 4: Wait for date-of-birth screen.
    await page
      .getByText("Date of birth", { exact: true })
      .waitFor({
        state: "visible",
        timeout: 15000,
      });

    console.log("[Onboarding] Date-of-birth screen detected.");

    // Step 5: Select birth month.
    console.log("[Onboarding] Selecting birth month...");

    await page
      .locator('button[aria-label="Month"]')
      .click({ timeout: 15000 });

    await page
      .getByRole("option", {
        name: BIRTH_MONTH,
        exact: true,
      })
      .click({ timeout: 15000 });

    console.log("[Onboarding] Birth month selected.");

    // Step 6: Select birth year.
    console.log("[Onboarding] Selecting birth year...");

    await page
      .locator('button[aria-label="Year"]')
      .click({ timeout: 15000 });

    await page
      .getByRole("option", {
        name: BIRTH_YEAR,
        exact: true,
      })
      .click({ timeout: 15000 });

    console.log("[Onboarding] Birth year selected.");

    // Step 7: Continue to registration form.
    console.log("[Onboarding] Clicking Next...");

    await page
      .getByRole("button", {
        name: "Next",
        exact: true,
      })
      .click({ timeout: 15000 });

    // Step 8: Locate registration fields.
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const termsCheckbox = page.locator('input[type="checkbox"]');

    await emailInput.waitFor({
      state: "visible",
      timeout: 15000,
    });

    console.log("[Onboarding] Registration form detected.");

    // Step 9: Fill credentials without logging them.
    await emailInput.fill(email);
    await passwordInput.fill(password);

    console.log("[Onboarding] Credentials entered.");

    // Step 10: Accept terms.
    // Only run this script after reviewing and agreeing
    // to Khan Academy's Terms of Service and Privacy Policy.
    await termsCheckbox.check();

    console.log("[Onboarding] Terms checkbox selected.");

    // Step 11: Verify that the form is ready.
    const emailReady =
      (await emailInput.inputValue()) === email;

    const passwordReady =
      (await passwordInput.inputValue()) === password;

    const termsAccepted =
      await termsCheckbox.isChecked();

    const formReady =
      emailReady && passwordReady && termsAccepted;

    if (!formReady) {
      throw new Error(
        "Registration form could not be completed"
      );
    }

    console.log("[Onboarding] Form ready:", formReady);

    // Step 12: Confirm the submit button exists.
    const signupButton = page.getByRole("button", {
      name: "Sign up",
      exact: true,
    });

    await signupButton.waitFor({
      state: "visible",
      timeout: 15000,
    });

    console.log("[Onboarding] Sign up button detected.");

    // Do not submit yet.
    console.log("");
    console.log("[Onboarding] Registration form is ready.");
    console.log("[Onboarding] No account has been created.");
    console.log("[Onboarding] Submission is intentionally disabled.");
    console.log("[Onboarding] Close Chromium when finished.");

    // Keep browser open for manual inspection.
    await page.waitForEvent("close", {
      timeout: 0,
    });

  } catch (error) {
    console.error("[Onboarding] Error:", error.message);
    process.exitCode = 1;
  } finally {
    if (browser && browser.isConnected()) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(
    "[Onboarding] Unexpected error:",
    error.message
  );
  process.exitCode = 1;
});
