
(() => {
  "use strict";

  // Prevent duplicate initialization in the same document.
  if (window.__khanAutoLoginInitialized) {
    return;
  }

  window.__khanAutoLoginInitialized = true;

  function isLoginPage() {
    const validHosts = [
      "www.khanacademy.org",
      "accounts.khanacademy.org",
    ];

    return (
      validHosts.includes(window.location.hostname) &&
      window.location.pathname === "/login"
    );
  }

  function initialize() {
    if (!isLoginPage()) {
      return;
    }

    console.log(
      "[Khan Auto Login] Khan Academy login page detected."
    );

    console.log(
      "[Khan Auto Login] Extension initialized successfully."
    );
  }

  initialize();
})();
