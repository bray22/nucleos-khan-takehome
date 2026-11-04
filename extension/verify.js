
(() => {
  "use strict";

  const PREFIX = "[Khan Auto Login]";
  const PROFILE_HOST = "www.khanacademy.org";
  const PROFILE_PATH = "/profile/me/";
  const VERIFY_TIMEOUT = 15000;

  function log(message) {
    console.log(`${PREFIX} ${message}`);
  }

  function isProfilePage() {
    return (
      window.location.hostname === PROFILE_HOST &&
      (
        window.location.pathname === PROFILE_PATH ||
        window.location.pathname === "/profile/me"
      )
    );
  }

  function getHeadings() {
    return Array.from(
      document.querySelectorAll("h1, h2")
    )
      .map((element) => element.textContent.trim())
      .filter(Boolean);
  }

  function isAuthenticatedDashboard() {
    const headings = getHeadings();

    const hasDashboardTitle =
      document.title === "Dashboard | Khan Academy";

    const hasAccountHeading =
      headings.includes("My account");

    const hasProfileHeading =
      headings.includes("My profile");

    const hasLearnerHome =
      headings.includes("Learner home");

    return (
      hasDashboardTitle &&
      hasAccountHeading &&
      hasProfileHeading &&
      hasLearnerHome
    );
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  async function verifyLogin() {
    if (!isProfilePage()) {
      return;
    }

    log("Profile page detected.");
    log("Checking authenticated dashboard...");

    const deadline = Date.now() + VERIFY_TIMEOUT;

    while (Date.now() < deadline) {
      if (isAuthenticatedDashboard()) {
        log("Authenticated learner dashboard verified.");

        // Notify background worker.
        // Background must confirm a pending extension-
        // initiated login before reporting success.
        try {
          const response = await chrome.runtime.sendMessage({
            type: "LOGIN_VERIFIED",
          });

          if (response?.success) {
            log("Successfully logged in to Khan Academy");
          } else {
            log(
              response?.error ||
              "Dashboard verified, but no pending login was confirmed."
            );
          }
        } catch (error) {
          console.error(
            `${PREFIX} Unable to report verification:`,
            error.message
          );
        }

        return;
      }

      await sleep(500);
    }

    console.warn(
      `${PREFIX} Login outcome could not be verified.`
    );
  }

  verifyLogin().catch((error) => {
    console.error(
      `${PREFIX} Verification error:`,
      error.message
    );
  });
})();
