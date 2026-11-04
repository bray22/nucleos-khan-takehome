
"use strict";

const LOGIN_ORIGINS = new Set([
  "https://accounts.khanacademy.org",
  "https://www.khanacademy.org",
]);
const PROFILE_ORIGIN = "https://www.khanacademy.org";
const ATTEMPT_TTL = 60 * 1000;
const pendingLoginAttempts = new Map();

function parseSenderUrl(sender) {
  try {
    return new URL(sender.url || "");
  } catch {
    return null;
  }
}

function isLoginSender(sender) {
  const url = parseSenderUrl(sender);

  return Boolean(
    url &&
    LOGIN_ORIGINS.has(url.origin) &&
    /^\/login\/?$/.test(url.pathname)
  );
}

function isProfileSender(sender) {
  const url = parseSenderUrl(sender);

  return Boolean(
    url &&
    url.origin === PROFILE_ORIGIN &&
    /^\/profile\/me\/?$/.test(url.pathname)
  );
}

function getTabId(sender) {
  return Number.isInteger(sender.tab?.id)
    ? sender.tab.id
    : null;
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type === "LOGIN_ATTEMPTED") {
      const tabId = getTabId(sender);

      if (!isLoginSender(sender) || tabId === null) {
        sendResponse({
          success: false,
          error: "Unable to correlate login attempt",
        });
        return false;
      }

      pendingLoginAttempts.set(tabId, Date.now());
      sendResponse({ success: true });
      return false;
    }

    if (message?.type === "LOGIN_VERIFIED") {
      const tabId = getTabId(sender);

      if (!isProfileSender(sender) || tabId === null) {
        sendResponse({
          success: false,
          error: "Unauthorized login verification",
        });
        return false;
      }

      const attemptedAt = pendingLoginAttempts.get(tabId);

      // Consume the attempt even when it has expired so a later visit in
      // this tab cannot be mistaken for the result of this login.
      pendingLoginAttempts.delete(tabId);

      if (
        typeof attemptedAt !== "number" ||
        Date.now() - attemptedAt > ATTEMPT_TTL
      ) {
        sendResponse({
          success: false,
          error: "No pending login attempt for this tab",
        });
        return false;
      }

      sendResponse({ success: true });
      return false;
    }

    if (message?.type !== "GET_CREDENTIALS") {
      return false;
    }

    // Only respond to the supported login pages.
    if (!isLoginSender(sender)) {
      sendResponse({
        success: false,
        error: "Unauthorized credential request",
      });
      return false;
    }

    (async () => {
      try {
        const configUrl = chrome.runtime.getURL(
          "config.json"
        );

        const response = await fetch(configUrl);

        if (!response.ok) {
          throw new Error(
            "Unable to read extension/config.json"
          );
        }

        const config = await response.json();

        if (!config.email || !config.password) {
          throw new Error(
            "Missing email or password in config.json"
          );
        }

        sendResponse({
          success: true,
          email: config.email,
          password: config.password,
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message,
        });
      }
    })();

    return true;
  }
);
