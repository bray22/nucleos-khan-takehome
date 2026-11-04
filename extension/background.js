
"use strict";

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type !== "GET_CREDENTIALS") {
      return false;
    }

    // Only respond to the supported login pages.
    let senderUrl;

    try {
      senderUrl = new URL(sender.url || "");
    } catch {
      sendResponse({
        success: false,
        error: "Unauthorized credential request",
      });
      return false;
    }

    if (
      ![
        "https://accounts.khanacademy.org",
        "https://www.khanacademy.org",
      ].includes(senderUrl.origin) ||
      !/^\/login\/?$/.test(senderUrl.pathname)
    ) {
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
