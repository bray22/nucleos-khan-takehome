
(() => {
  "use strict";

  const PREFIX = "[Khan Auto Login]";
  const PROFILE_HOST = "www.khanacademy.org";
  const PROFILE_PATH = "/profile/me/";
  const VERIFY_TIMEOUT = 5 * 60 * 1000;
  let verifying = false;

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
      .filter((element) => element.getClientRects().length > 0)
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
    const pending = await chrome.runtime.sendMessage({ type: "HAS_PENDING_LOGIN" });
    if (!pending?.success) {
      throw new Error(pending?.error || "Unable to check pending login");
    }
    if (!pending.pending) {
      return;
    }
    if (verifying) {
      return;
    }
    verifying = true;
    const deadline = Date.now() + VERIFY_TIMEOUT;
    let profileDetected = false;

    while (Date.now() < deadline) {
      // Khan Academy may reach the dashboard with client-side routing, so
      // the verifier can be injected before /profile/me becomes the path.
      if (!isProfilePage()) {
        await sleep(500);
        continue;
      }

      if (!profileDetected) {
        profileDetected = true;
        log("Profile page detected.");
        log("Checking authenticated dashboard...");
      }

      if (isAuthenticatedDashboard()) {
        log("Authenticated learner dashboard verified.");

        // Notify background worker.
        // Background must confirm a pending extension-
        // initiated login before reporting success.
        try {
          const response = await chrome.runtime.sendMessage({
            type: "LOGIN_VERIFIED",
            url: window.location.href,
          });

          if (response?.success) {
            log("Successfully logged in to Khan Academy");
            khanShowToast("Successfully logged in to Khan Academy", true);
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

    if (profileDetected) {
      console.warn(
        `${PREFIX} Login outcome could not be verified.`
      );
    }
  }

  globalThis.khanVerifyLogin = () => verifyLogin().catch((error) => {
    console.error(`${PREFIX} Verification error:`, error.message);
  });
  globalThis.khanVerifyLogin();
})();
