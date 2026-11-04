
(() => {
  "use strict";

  const PREFIX = "[Khan Auto Login]";
  const LOGIN_HOSTS = [
    "accounts.khanacademy.org",
    "www.khanacademy.org",
  ];
  const ELEMENT_TIMEOUT = 15000;
  const AUTHENTICATION_TIMEOUT = 5 * 60 * 1000;

  // Prevent duplicate initialization in this document.
  if (globalThis.__khanAutoLoginInitialized) {
    return;
  }

  globalThis.__khanAutoLoginInitialized = true;

  function log(message) {
    console.log(`${PREFIX} ${message}`);
  }

  function isLoginPage() {
    return (
      window.location.protocol === "https:" &&
      LOGIN_HOSTS.includes(window.location.hostname) &&
      /^\/login\/?$/.test(window.location.pathname)
    );
  }

  function waitForElement(selector, timeout = ELEMENT_TIMEOUT) {
    const existing = document.querySelector(selector);

    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);

        if (element) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(element);
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(
          new Error(`Timed out waiting for ${selector}`)
        );
      }, timeout);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  function waitForText(selector, timeout) {
    const getText = () => {
      const element = document.querySelector(selector);
      const text = element?.textContent;

      return text?.trim() && element.getClientRects().length > 0
        ? { element, text } : null;
    };
    const existing = getText();

    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const result = getText();

        if (result) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(result);
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Authentication could not be verified."));
      }, timeout);

      observer.observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
  }

  function setInputValue(input, value) {
    // Support React-controlled input fields.
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    );

    if (!descriptor?.set) {
      throw new Error("Native input setter unavailable");
    }

    descriptor.set.call(input, value);

    input.dispatchEvent(
      new Event("input", { bubbles: true })
    );

    input.dispatchEvent(
      new Event("change", { bubbles: true })
    );
  }

  async function getCredentials() {
    const response = await chrome.runtime.sendMessage({
      type: "GET_CREDENTIALS",
    });

    if (!response?.success) {
      throw new Error(
        response?.error || "Unable to load credentials"
      );
    }

    const { email, password } = response;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      throw new Error("Invalid credential configuration");
    }

    return { email, password };
  }

  async function recordLoginAttempt() {
    const response = await chrome.runtime.sendMessage({
      type: "LOGIN_ATTEMPTED",
    });

    if (!response?.success) {
      throw new Error(
        response?.error || "Unable to correlate login attempt"
      );
    }
  }

  async function clearLoginAttempt() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "LOGIN_FAILED",
      });
      if (!response?.success) {
        throw new Error(response?.error || "Unable to clear login attempt");
      }
    } catch (error) {
      console.error(`${PREFIX} Unable to clear login attempt:`, error.message);
    }
  }

  async function watchForAuthenticationFailure() {
    try {
      const { text } = await waitForText(
        "#log-in-server-error[role=\"alert\"]",
        AUTHENTICATION_TIMEOUT
      );

      // This is Khan Academy's own message. Do not prefix, rewrite, or
      // otherwise change its wording.
      console.error(text);
      khanShowToast(text);
      await clearLoginAttempt();
    } catch (error) {
      if (isLoginPage()) {
        console.error(`${PREFIX} ${error.message}`);
        khanShowToast(error.message);
      }
    }
  }

  async function autoLogin() {
    if (!isLoginPage()) {
      return;
    }

    log("Login page detected.");

    // Only one automatic submission per document.
    // Reloading or revisiting the login page creates
    // a new document and permits another attempt.
    if (globalThis.__khanAutoLoginAttempted) {
      log("Login already attempted on this page.");
      return;
    }

    globalThis.__khanAutoLoginAttempted = true;

    let usernameInput;
    let passwordInput;
    let loginButton;

    try {
      [usernameInput, passwordInput, loginButton] =
        await Promise.all([
          waitForElement("#username-field"),
          waitForElement("#current-password-field"),
          waitForElement('button[type="submit"]'),
        ]);
    } catch (error) {
      throw new Error(`Login form unavailable: ${error.message}`);
    }

    log("Login form detected.");

    const { email, password } = await getCredentials();

    setInputValue(usernameInput, email);
    setInputValue(passwordInput, password);

    if (
      usernameInput.value !== email ||
      passwordInput.value !== password
    ) {
      throw new Error("Unable to populate login fields");
    }

    log("Credentials entered.");
    log("Submitting login once...");

    // Record the attempt before navigation destroys this document. The
    // worker associates it with sender.tab.id and only accepts verification
    // from the authenticated dashboard in that same tab.
    await recordLoginAttempt();
    globalThis.khanVerifyLogin?.();

    loginButton.click();

    log("Login submitted. Awaiting verification.");
    await watchForAuthenticationFailure();
  }

  autoLogin().catch((error) => {
    console.error(`${PREFIX} Error:`, error.message);
  });
})();
