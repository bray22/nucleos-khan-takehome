const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("[Onboarding] Opening Khan Academy...");

    await page.goto("https://www.khanacademy.org/signup", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    console.log("[Onboarding] Current URL:", page.url());
    console.log("[Onboarding] Page title:", await page.title());

    console.log(
      "[Onboarding] Inspect the registration flow in the browser."
    );

    console.log(
      "[Onboarding] Close the browser when finished."
    );

    await page.waitForEvent("close", { timeout: 0 });
  } catch (error) {
    console.error("[Onboarding] Error:", error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[Onboarding] Unexpected error:", error.message);
  process.exitCode = 1;
});
