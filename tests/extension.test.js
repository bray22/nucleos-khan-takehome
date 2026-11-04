const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");

const extensionPath = path.join(__dirname, "../extension");
const contentSource = fs.readFileSync(
  path.join(extensionPath, "content.js"), "utf8"
);
const backgroundSource = fs.readFileSync(
  path.join(extensionPath, "background.js"), "utf8"
);
const verifySource = fs.readFileSync(
  path.join(extensionPath, "verify.js"), "utf8"
);
const hosts = ["www.khanacademy.org", "accounts.khanacademy.org"];

test("manifest registers the worker and both login hosts", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(extensionPath, "manifest.json"), "utf8"
  ));
  assert.equal(manifest.background.service_worker, "background.js");
  const script = manifest.content_scripts.find(
    (entry) => entry.js.includes("content.js")
  );
  for (const host of hosts) {
    assert.ok(script.matches.includes(`https://${host}/login*`));
  }
});

for (const host of hosts) {
  for (const route of ["/login", "/login/?continue=profile"]) {
    test(`login submits once on ${host}${route}`, async () => {
      let requests = 0;
      let attempts = 0;
      let failures = 0;
      let clicks = 0;
      let authenticationError = null;
      const errors = [];
      class Input {
        set value(value) { this.currentValue = value; }
        get value() { return this.currentValue; }
        dispatchEvent() {}
      }
      const username = new Input();
      const password = new Input();
      const elements = {
        "#username-field": username,
        "#current-password-field": password,
        'button[type="submit"]': {
          click() {
            clicks += 1;
            authenticationError = {
              textContent: "Your login or password is incorrect.",
            };
          },
        },
      };
      const context = vm.createContext({
        window: { location: new URL(`https://${host}${route}`) },
        document: {
          querySelector: (selector) => selector.startsWith("#log-in-server-error")
            ? authenticationError
            : elements[selector],
        },
        HTMLInputElement: Input,
        Event: class {},
        console: { log() {}, error: (...args) => errors.push(args) },
        chrome: {
          runtime: {
            async sendMessage(message) {
              if (message.type === "GET_CREDENTIALS") {
                requests += 1;
                return { success: true, email: "test@example.com", password: "test-password" };
              }
              if (message.type === "LOGIN_ATTEMPTED") {
                attempts += 1;
              } else {
                assert.equal(message.type, "LOGIN_FAILED");
                failures += 1;
              }
              return { success: true };
            },
          },
        },
      });
      vm.runInContext(contentSource, context);
      await new Promise((resolve) => setImmediate(resolve));
      vm.runInContext(contentSource, context);
      assert.equal(username.value, "test@example.com");
      assert.equal(password.value, "test-password");
      assert.equal(requests, 1);
      assert.equal(attempts, 1);
      assert.equal(failures, 1);
      assert.equal(clicks, 1);
      assert.deepEqual(errors, [["Your login or password is incorrect."]]);
    });
  }
}

test("worker accepts only supported login URLs", async () => {
  let listener;
  let fetches = 0;
  vm.runInNewContext(backgroundSource, {
    URL,
    chrome: {
      runtime: {
        onMessage: { addListener(value) { listener = value; } },
        getURL: (file) => `chrome-extension://test/${file}`,
      },
    },
    async fetch() {
      fetches += 1;
      return {
        ok: true,
        async json() {
          return { email: "test@example.com", password: "test-password" };
        },
      };
    },
  });
  for (const host of hosts) {
    for (const route of ["/login", "/login/?continue=profile"]) {
      const response = await new Promise((resolve) => {
        assert.equal(listener(
          { type: "GET_CREDENTIALS" },
          { url: `https://${host}${route}` },
          resolve
        ), true);
      });
      assert.equal(response.success, true);
    }
  }
  assert.equal(fetches, 4);
  for (const url of [
    undefined,
    "invalid-url",
    "http://www.khanacademy.org/login",
    "https://www.khanacademy.org/profile/me",
    "https://accounts.khanacademy.org/login-other",
    "https://accounts.khanacademy.org.evil.example/login",
  ]) {
    let response;
    assert.equal(listener(
      { type: "GET_CREDENTIALS" },
      { url },
      (value) => { response = value; }
    ), false);
    assert.equal(response.success, false);
    assert.equal(response.error, "Unauthorized credential request");
  }
  assert.equal(fetches, 4);
});

test("missing credentials prevent submission and report the error", async () => {
  let clicks = 0;
  const errors = [];
  class Input {
    set value(value) { this.currentValue = value; }
    get value() { return this.currentValue; }
    dispatchEvent() {}
  }
  const elements = {
    "#username-field": new Input(),
    "#current-password-field": new Input(),
    'button[type="submit"]': { click() { clicks += 1; } },
  };
  const context = vm.createContext({
    window: { location: new URL("https://www.khanacademy.org/login") },
    document: { querySelector: (selector) => elements[selector] },
    HTMLInputElement: Input,
    Event: class {},
    console: { log() {}, error: (...args) => errors.push(args.join(" ")) },
    chrome: {
      runtime: {
        async sendMessage(message) {
          assert.equal(message.type, "GET_CREDENTIALS");
          return { success: false, error: "Missing email or password in config.json" };
        },
      },
    },
  });

  vm.runInContext(contentSource, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(clicks, 0);
  assert.deepEqual(errors, [
    "[Khan Auto Login] Error: Missing email or password in config.json",
  ]);
});

test("unavailable login form times out without submitting", async () => {
  const errors = [];
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const context = vm.createContext({
    window: { location: new URL("https://www.khanacademy.org/login") },
    document: {
      documentElement: {},
      querySelector() { return null; },
    },
    MutationObserver,
    setTimeout(callback) {
      Promise.resolve().then(callback);
      return 1;
    },
    clearTimeout() {},
    console: { log() {}, error: (...args) => errors.push(args.join(" ")) },
    chrome: { runtime: { async sendMessage() { throw new Error("unexpected"); } } },
  });

  vm.runInContext(contentSource, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Login form unavailable: Timed out waiting for/);
});

test("unverified authentication is reported after one submission", async () => {
  let clicks = 0;
  let failures = 0;
  const errors = [];
  class Input {
    set value(value) { this.currentValue = value; }
    get value() { return this.currentValue; }
    dispatchEvent() {}
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const elements = {
    "#username-field": new Input(),
    "#current-password-field": new Input(),
    'button[type="submit"]': { click() { clicks += 1; } },
  };
  const context = vm.createContext({
    window: { location: new URL("https://www.khanacademy.org/login") },
    document: {
      documentElement: {},
      querySelector: (selector) => elements[selector],
    },
    HTMLInputElement: Input,
    Event: class {},
    MutationObserver,
    setTimeout(callback) {
      Promise.resolve().then(callback);
      return 1;
    },
    clearTimeout() {},
    console: { log() {}, error: (...args) => errors.push(args.join(" ")) },
    chrome: {
      runtime: {
        async sendMessage(message) {
          if (message.type === "GET_CREDENTIALS") {
            return { success: true, email: "test@example.com", password: "test-password" };
          }
          if (message.type === "LOGIN_ATTEMPTED") {
            return { success: true };
          }
          assert.equal(message.type, "LOGIN_FAILED");
          failures += 1;
          return { success: true };
        },
      },
    },
  });

  vm.runInContext(contentSource, context);
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext(contentSource, context);

  assert.equal(clicks, 1);
  assert.equal(failures, 1);
  assert.deepEqual(errors, [
    "[Khan Auto Login] Authentication could not be verified.",
  ]);
});

test("worker reports missing credentials", async () => {
  let listener;
  vm.runInNewContext(backgroundSource, {
    URL,
    chrome: {
      runtime: {
        onMessage: { addListener(value) { listener = value; } },
        getURL: (file) => `chrome-extension://test/${file}`,
      },
    },
    async fetch() {
      return { ok: true, async json() { return {}; } };
    },
  });

  const response = await new Promise((resolve) => {
    listener(
      { type: "GET_CREDENTIALS" },
      { url: "https://www.khanacademy.org/login" },
      resolve
    );
  });

  assert.equal(response.success, false);
  assert.equal(response.error, "Missing email or password in config.json");
});

test("worker verifies only a pending login from the same tab", () => {
  let listener;
  vm.runInNewContext(backgroundSource, {
    URL,
    chrome: {
      runtime: {
        onMessage: { addListener(value) { listener = value; } },
        getURL: (file) => `chrome-extension://test/${file}`,
      },
    },
    fetch() {},
  });

  function send(message, url, tabId) {
    let response;
    listener(message, { url, tab: { id: tabId } }, (value) => {
      response = value;
    });
    return response;
  }

  const loginUrl = "https://accounts.khanacademy.org/login";
  const profileUrl = "https://www.khanacademy.org/profile/me/";

  assert.equal(
    send({ type: "LOGIN_ATTEMPTED" }, loginUrl, 17).success,
    true
  );
  assert.equal(
    send({ type: "LOGIN_VERIFIED" }, profileUrl, 18).success,
    false
  );
  assert.equal(
    send({ type: "LOGIN_VERIFIED" }, profileUrl, 17).success,
    true
  );
  assert.equal(
    send({ type: "LOGIN_VERIFIED" }, profileUrl, 17).success,
    false
  );

  assert.equal(
    send({ type: "LOGIN_ATTEMPTED" }, loginUrl, 17).success,
    true
  );
  assert.equal(
    send({ type: "LOGIN_FAILED" }, loginUrl, 17).success,
    true
  );
  assert.equal(
    send({ type: "LOGIN_VERIFIED" }, profileUrl, 17).success,
    false
  );
});

for (const correlated of [true, false]) {
  test(
    `dashboard ${correlated ? "shows" : "does not show"} login success when ${correlated ? "correlated" : "already authenticated"}`,
    async () => {
      const logs = [];
      const headings = ["My account", "My profile", "Learner home"]
        .map((textContent) => ({ textContent }));
      const context = vm.createContext({
        window: { location: new URL("https://www.khanacademy.org/profile/me/") },
        document: {
          title: "Dashboard | Khan Academy",
          querySelectorAll() { return headings; },
        },
        console: {
          log: (...args) => logs.push(args.join(" ")),
          error() {},
          warn() {},
        },
        setTimeout,
        chrome: {
          runtime: {
            async sendMessage(message) {
              assert.equal(message.type, "LOGIN_VERIFIED");
              return correlated
                ? { success: true }
                : { success: false, error: "No pending login attempt for this tab" };
            },
          },
        },
      });

      vm.runInContext(verifySource, context);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(
        logs.some((entry) => entry.includes("Successfully logged in to Khan Academy")),
        correlated
      );
    }
  );
}
