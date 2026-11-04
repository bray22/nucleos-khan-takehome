
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const SIGNUP_URL = "https://www.khanacademy.org/signup";
const BIRTH_MONTH = "Jul";
const BIRTH_YEAR = "1974";

const SUBMISSION_MARKER = path.join(
  __dirname,
  ".registration-submitted.json"
);

function log(message) {
  console.log(`[Onboarding] ${message}`);
}

async function main() {
  let browser;

  try {
    const email = process.env.KHAN_EMAIL;
    const password = process.env.KHAN_PASSWORD;

    if (!email || !password) {
      throw new Error("Missing credentials in .env");
    }

    // Prevent repeat registration attempts.
    if (fs.existsSync(SUBMISSION_MARKER)) {
      throw new Error(
        "Registration was already submitted or attempted. " +
        "Check the existing account before trying again."
      );
    }

    log("Starting registration...");

    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    log("Opening Khan Academy...");

    await page.goto(SIGNUP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Cookie preferences.
    const necessaryCookies = page.getByRole("button", {
      name: "Strictly Necessary Only",
    });

    if (await necessaryCookies.isVisible().catch(() => false)) {
      await necessaryCookies.click();
    }

    // Select learner.
    log("Selecting learner registration...");

    await page
      .getByText("Student learning on my own", {
        exact: true,
      })
      .click({ timeout: 15000 });

    // Wait for date-of-birth screen.
    await page
      .getByText("Date of birth", { exact: true })
      .waitFor({
        state: "visible",
        timeout: 15000,
      });

    // Birth month.
    await page
      .locator('button[aria-label="Month"]')
      .click();

    await page
      .getByRole("option", {
        name: BIRTH_MONTH,
        exact: true,
      })
      .click();

    // Birth year.
    await page
      .locator('button[aria-label="Year"]')
      .click();

    await page
      .getByRole("option", {
        name: BIRTH_YEAR,
        exact: true,
      })
      .click();

    // Continue.
    await page
      .getByRole("button", {
        name: "Next",
        exact: true,
      })
      .click();

    // Registration form.
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const termsCheckbox = page.locator('input[type="checkbox"]');

    await emailInput.waitFor({
      state: "visible",
      timeout: 15000,
    });

    log("Registration form detected.");

    await emailInput.fill(email);
    await passwordInput.fill(password);
    await termsCheckbox.check();

    const formReady =
      (await emailInput.inputValue()) === email &&
      (await passwordInput.inputValue()) === password &&
      (await termsCheckbox.isChecked());

    if (!formReady) {
      throw new Error("Registration form is incomplete");
    }

    log("Registration form completed.");

    const signupButton = page.getByRole("button", {
      name: "Sign up",
      exact: true,
    });

    await signupButton.waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Record the attempt before clicking to prevent
    // accidental duplicate submissions after a crash.
    fs.writeFileSync(
      SUBMISSION_MARKER,
      JSON.stringify(
        {
          attemptedAt: new Date().toISOString(),
          status: "attempted",
        },
        null,
        2
      ),
      { flag: "wx", mode: 0o600 }
    );

    log("Submitting registration once...");

    await signupButton.click({
      timeout: 15000,
      noWaitAfter: true,
    });

    log("Submission click completed.");
    log("Waiting for Khan Academy's response...");

    // Give the application time to respond.
    await page.waitForTimeout(3000);

    log(`Current URL: ${page.url()}`);

    // Look for visible validation messages.
    const alerts = await page
      .locator('[role="alert"]')
      .allTextContents();

    const errors = alerts
      .map((message) => message.trim())
      .filter(Boolean);

    if (errors.length > 0) {
      log("Registration messages:");
      for (const error of errors) {
        console.log(`  ${error}`);
      }
    }

    const signupStillVisible = await signupButton
      .isVisible()
      .catch(() => false);

    if (signupStillVisible) {
      log("Registration form is still visible.");
      log("Account creation has NOT been confirmed.");
    } else {
      log("Registration form is no longer visible.");
      log("Account creation still requires verification.");
    }

    log(
      "If a CAPTCHA or email verification is required, " +
      "complete it manually in Chromium."
    );

    log("Do not submit registration a second time.");
    log("Close Chromium when finished.");

    // Keep browser open for manual verification.
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
