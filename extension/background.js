
"use strict";

const LOGIN_ORIGINS = new Set([
  "https://accounts.khanacademy.org",
  "https://www.khanacademy.org",
]);
const PROFILE_ORIGIN = "https://www.khanacademy.org";
const ATTEMPT_TTL = 5 * 60 * 1000;
const tabOperations = new Map();

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

function isProfileSender(sender, currentUrl) {
  const senderUrl = parseSenderUrl(sender);
  let profileUrl;

  try {
    profileUrl = new URL(currentUrl || sender.url || "");
  } catch {
    return false;
  }

  return Boolean(
    senderUrl &&
    senderUrl.origin === PROFILE_ORIGIN &&
    profileUrl.origin === PROFILE_ORIGIN &&
    /^\/profile\/me\/?$/.test(profileUrl.pathname)
  );
}

function getTabId(sender) {
  return Number.isInteger(sender.tab?.id)
    ? sender.tab.id
    : null;
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if ([
      "LOGIN_ATTEMPTED", "LOGIN_FAILED", "LOGIN_VERIFIED", "HAS_PENDING_LOGIN",
    ].includes(message?.type)) {
      const tabId = getTabId(sender);
      const isVerifier = message.type === "LOGIN_VERIFIED" ||
        message.type === "HAS_PENDING_LOGIN";
      const senderUrl = parseSenderUrl(sender);
      const authorized = isVerifier
        ? senderUrl?.origin === PROFILE_ORIGIN &&
          (message.type === "HAS_PENDING_LOGIN" ||
            isProfileSender(sender, message.url))
        : isLoginSender(sender);

      if (!authorized || tabId === null) {
        sendResponse({
          success: false,
          error: "Unauthorized login outcome request",
        });
        return false;
      }

      const key = `login-attempt-${tabId}`;
      // Serialize consumption within a tab so two verifiers cannot report success.
      const operation = (tabOperations.get(tabId) || Promise.resolve()).then(async () => {
        if (message.type === "LOGIN_ATTEMPTED") {
          await chrome.storage.session.set({ [key]: Date.now() });
          return { success: true };
        }
        const stored = await chrome.storage.session.get(key);
        const attemptedAt = stored[key];
        const pending = typeof attemptedAt === "number" &&
          Date.now() >= attemptedAt && Date.now() - attemptedAt <= ATTEMPT_TTL;
        if (message.type === "LOGIN_FAILED" || message.type === "LOGIN_VERIFIED" || !pending) {
          await chrome.storage.session.remove(key);
        }
        if (message.type === "HAS_PENDING_LOGIN") {
          return { success: true, pending };
        }
        if (message.type === "LOGIN_VERIFIED" && !pending) {
          return { success: false, error: "No pending login attempt for this tab" };
        }
        return { success: true };
      });
      const completed = operation.then(sendResponse, (error) => {
        sendResponse({ success: false, error: error.message });
      }).finally(() => {
        if (tabOperations.get(tabId) === completed) {
          tabOperations.delete(tabId);
        }
      });
      tabOperations.set(tabId, completed);
      return true;
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
