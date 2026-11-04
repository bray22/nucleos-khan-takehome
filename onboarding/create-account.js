
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

function isRegistrationConfirmed(snapshot) {
  const url = new URL(snapshot.url);
  return url.origin === "https://www.khanacademy.org" &&
    /^\/profile\/me\/?$/.test(url.pathname) &&
    snapshot.title === "Dashboard | Khan Academy" &&
    ["My account", "My profile", "Learner home"]
      .every((heading) => snapshot.headings.includes(heading)) &&
    !snapshot.signupVisible;
}

async function waitForRegistrationConfirmation(page) {
  while (!page.isClosed()) {
    let snapshot;
    try {
      snapshot = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        headings: Array.from(document.querySelectorAll("h1, h2"))
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.textContent.trim()),
        signupVisible: Array.from(document.querySelectorAll("button"))
          .some((element) => element.textContent.trim() === "Sign up" &&
            element.getClientRects().length > 0),
      }));
    } catch (error) {
      if (page.isClosed()) {
        return false;
      }
      if (!error.message.includes("Execution context was destroyed")) {
        throw error;
      }
    }
    if (snapshot && isRegistrationConfirmed(snapshot)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  require("dotenv").config();
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
        console.log(`  ${error.split(email).join("[email]").split(password).join("[password]")}`);
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
    log("Waiting for a visible authenticated learner dashboard in this Chromium tab.");
    log("Close Chromium when finished.");

    const confirmed = await waitForRegistrationConfirmation(page);
    if (confirmed) {
      const marker = JSON.parse(fs.readFileSync(SUBMISSION_MARKER, "utf8"));
      fs.writeFileSync(SUBMISSION_MARKER, JSON.stringify({
        ...marker,
        status: "verified",
        verifiedAt: new Date().toISOString(),
        evidence: "Authenticated learner dashboard in fresh registration context",
      }, null, 2), { mode: 0o600 });
      log("Account creation confirmed: authenticated learner dashboard reached.");
      if (!page.isClosed()) {
        await page.waitForEvent("close", { timeout: 0 });
      }
    } else {
      log("Account creation remains unconfirmed.");
      process.exitCode = 1;
    }

  } catch (error) {
    let message = error.message;
    for (const value of [process.env.KHAN_EMAIL, process.env.KHAN_PASSWORD]) {
      if (value) {
        message = message.split(value).join("[redacted]");
      }
    }
    console.error("[Onboarding] Error:", message);
    process.exitCode = 1;
  } finally {
    if (browser && browser.isConnected()) {
      await browser.close();
    }
  }
}

module.exports = { isRegistrationConfirmed, waitForRegistrationConfirmation };

if (require.main === module) {
  main().catch((error) => {
    console.error("[Onboarding] Unexpected error:", error.message);
    process.exitCode = 1;
  });
}
