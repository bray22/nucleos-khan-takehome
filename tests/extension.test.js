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

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function mockSessionStorage() {
  const data = {};
  return {
    async set(values) { Object.assign(data, values); },
    async get(key) { return { [key]: data[key] }; },
    async remove(key) { delete data[key]; },
  };
}

test("manifest registers the worker and both login hosts", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(extensionPath, "manifest.json"), "utf8"
  ));
  assert.equal(manifest.background.service_worker, "background.js");
  const script = manifest.content_scripts.find(
    (entry) => entry.js.includes("content.js")
  );
  const verifier = manifest.content_scripts.find(
    (entry) => entry.js.includes("verify.js")
  );
  for (const host of hosts) {
    assert.ok(script.matches.includes(`https://${host}/login*`));
  }
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(script.js.indexOf("toast.js") < script.js.indexOf("content.js"));
  assert.ok(verifier.js.indexOf("toast.js") < verifier.js.indexOf("verify.js"));
  assert.ok(
    verifier.matches.includes("https://www.khanacademy.org/*"),
    "verifier must load before Khan Academy changes routes client-side"
  );
});

test("toast renders exact plain text and accessible status without interpreting HTML", () => {
  let displayed;
  const document = {
    getElementById() { return displayed; },
    createElement() {
      return {
        style: {},
        attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        remove() { displayed = undefined; },
      };
    },
    body: { appendChild(element) { displayed = element; } },
  };
  const context = vm.createContext({ document });
  vm.runInContext(fs.readFileSync(path.join(extensionPath, "toast.js"), "utf8"), context);
  const text = "  Your login or password is incorrect.\n<not-html>  ";
  context.khanShowToast(text);
  assert.equal(displayed.textContent, text);
  assert.equal(displayed.attributes.role, "alert");
  assert.equal(displayed.style.whiteSpace, "pre-wrap");
  context.khanShowToast("Successfully logged in to Khan Academy", true);
  assert.equal(displayed.attributes.role, "status");
  assert.equal(displayed.textContent, "Successfully logged in to Khan Academy");
});

test("session correlation survives worker restart, expires, and is consumed once", async () => {
  const session = mockSessionStorage();
  let now = 1000;
  function startWorker() {
    let listener;
    vm.runInNewContext(backgroundSource, {
      URL,
      Date: { now: () => now },
      chrome: {
        storage: { session },
        runtime: { onMessage: { addListener(value) { listener = value; } } },
      },
    });
    return (type, url = "https://www.khanacademy.org/profile/me/") =>
      new Promise((resolve) => listener(
        { type, url },
        { url, tab: { id: 1 } },
        resolve
      ));
  }
  let send = startWorker();
  assert.equal((await send("LOGIN_ATTEMPTED", "https://www.khanacademy.org/login")).success, true);
  send = startWorker();
  assert.equal((await send("HAS_PENDING_LOGIN")).pending, true);
  const responses = await Promise.all([send("LOGIN_VERIFIED"), send("LOGIN_VERIFIED")]);
  assert.equal(responses.filter((response) => response.success).length, 1);
  await send("LOGIN_ATTEMPTED", "https://www.khanacademy.org/login");
  now += 5 * 60 * 1000 + 1;
  assert.equal((await send("LOGIN_VERIFIED")).success, false);
  assert.equal((await send("HAS_PENDING_LOGIN")).pending, false);
});

test("worker reports session storage failure instead of confirming a login", async () => {
  let listener;
  vm.runInNewContext(backgroundSource, {
    URL,
    chrome: {
      storage: { session: { async set() { throw new Error("Storage unavailable"); } } },
      runtime: { onMessage: { addListener(value) { listener = value; } } },
    },
  });
  const response = await new Promise((resolve) => listener(
    { type: "LOGIN_ATTEMPTED" },
    { url: "https://www.khanacademy.org/login", tab: { id: 1 } },
    resolve
  ));
  assert.equal(response.success, false);
  assert.equal(response.error, "Storage unavailable");
});

test("browser renders the exact error toast and only a correlated dashboard success", async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Entirely local fixture: no Khan Academy request or real credentials.
    await page.route("https://www.khanacademy.org/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Khan Academy</title>
        <input id="username-field"><input id="current-password-field" type="password">
        <button type="submit">Log in</button>
        <div id="log-in-server-error" role="alert"></div>`,
    }));
    await page.goto("https://www.khanacademy.org/login");
    const errorText = "Your login or password is incorrect.\nPlease try again.";
    const logged = [];
    page.on("console", (message) => logged.push(message.text()));
    await page.evaluate((text) => {
      globalThis.chrome = {
        runtime: {
          async sendMessage(message) {
            if (message.type === "GET_CREDENTIALS") {
              return { success: true, email: "test@example.com", password: "wrong-password" };
            }
            return { success: true };
          },
        },
      };
      document.querySelector("button").onclick = () => {
        document.getElementById("log-in-server-error").textContent = text;
      };
    }, errorText);
    await page.addScriptTag({ path: path.join(extensionPath, "toast.js") });
    await page.addScriptTag({ path: path.join(extensionPath, "content.js") });
    await page.locator("#khan-auto-login-toast").waitFor();
    assert.equal(await page.locator("#khan-auto-login-toast").textContent(), errorText);
    assert.ok(logged.includes(errorText));
    assert.equal(await page.locator("#username-field").inputValue(), "test@example.com");

    await page.goto("https://www.khanacademy.org/profile/me/");
    await page.setContent(`<title>Dashboard | Khan Academy</title>
      <h1>My account</h1><h2>My profile</h2><h2>Learner home</h2>`);
    await page.evaluate(() => {
      globalThis.chrome = {
        runtime: {
          async sendMessage(message) {
            return message.type === "HAS_PENDING_LOGIN"
              ? { success: true, pending: true }
              : { success: true };
          },
        },
      };
    });
    await page.addScriptTag({ path: path.join(extensionPath, "toast.js") });
    await page.addScriptTag({ path: path.join(extensionPath, "verify.js") });
    await page.locator("#khan-auto-login-toast").waitFor();
    assert.equal(await page.locator("#khan-auto-login-toast").textContent(),
      "Successfully logged in to Khan Academy");
    assert.equal(await page.locator("#khan-auto-login-toast").getAttribute("role"), "status");

    await page.goto("https://www.khanacademy.org/profile/me/");
    await page.setContent(`<title>Dashboard | Khan Academy</title>
      <h1>My account</h1><h2>My profile</h2><h2>Learner home</h2>`);
    await page.evaluate(() => {
      globalThis.chrome = {
        runtime: { async sendMessage() { return { success: true, pending: false }; } },
      };
    });
    await page.addScriptTag({ path: path.join(extensionPath, "toast.js") });
    await page.addScriptTag({ path: path.join(extensionPath, "verify.js") });
    assert.equal(await page.locator("#khan-auto-login-toast").count(), 0);

    await page.goto("https://www.khanacademy.org/login");
    await page.evaluate(() => {
      let pending = false;
      globalThis.chrome = {
        runtime: {
          async sendMessage(message) {
            if (message.type === "GET_CREDENTIALS") {
              return { success: true, email: "test@example.com", password: "test-password" };
            }
            if (message.type === "LOGIN_ATTEMPTED") {
              pending = true;
            }
            if (message.type === "HAS_PENDING_LOGIN") {
              return { success: true, pending };
            }
            return { success: true };
          },
        },
      };
      document.querySelector("button").onclick = () => {
        history.pushState({}, "", "/profile/me/");
        document.title = "Dashboard | Khan Academy";
        document.body.innerHTML = "<h1>My account</h1><h2>My profile</h2><h2>Learner home</h2>";
      };
    });
    await page.addScriptTag({ path: path.join(extensionPath, "toast.js") });
    await page.addScriptTag({ path: path.join(extensionPath, "verify.js") });
    await page.addScriptTag({ path: path.join(extensionPath, "content.js") });
    await page.locator("#khan-auto-login-toast").waitFor();
    assert.equal(await page.locator("#khan-auto-login-toast").textContent(),
      "Successfully logged in to Khan Academy");
  } finally {
    await browser.close();
  }
});

for (const url of [
  "http://www.khanacademy.org/login",
  "https://www.khanacademy.org/",
  "https://www.khanacademy.org/login-other",
  "https://accounts.khanacademy.org/signup",
  "https://example.com/login",
]) {
  test(`does not detect non-login page ${url}`, async () => {
    let messages = 0;
    const errors = [];
    const context = vm.createContext({
      window: { location: new URL(url) },
      document: {
        querySelector() {
          throw new Error("form lookup should not occur");
        },
      },
      console: { log() {}, error: (...args) => errors.push(args) },
      chrome: {
        runtime: {
          async sendMessage() {
            messages += 1;
          },
        },
      },
    });

    vm.runInContext(contentSource, context);
    await flushTasks();

    assert.equal(messages, 0);
    assert.deepEqual(errors, []);
  });
}

for (const credentials of [
  { email: "", password: "test-password" },
  { email: "   ", password: "test-password" },
  { email: "test@example.com", password: "" },
  { email: null, password: "test-password" },
  { email: "test@example.com", password: 12345678 },
]) {
  test(`rejects invalid credential values ${JSON.stringify(credentials)}`, async () => {
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
            return { success: true, ...credentials };
          },
        },
      },
    });

    vm.runInContext(contentSource, context);
    await flushTasks();

    assert.equal(clicks, 0);
    assert.deepEqual(errors, [
      "[Khan Auto Login] Error: Invalid credential configuration",
    ]);
  });
}

for (const host of hosts) {
  for (const route of ["/login", "/login/?continue=profile"]) {
    test(`detects ${host}${route} and prevents duplicate submission`, async () => {
      let requests = 0;
      let attempts = 0;
      let failures = 0;
      let clicks = 0;
      let authenticationError = null;
      const errors = [];
      const toasts = [];
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
              getClientRects: () => [1],
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
        khanShowToast: (text) => toasts.push(text),
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
      assert.deepEqual(toasts, ["Your login or password is incorrect."]);
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
    khanShowToast() {},
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
  assert.equal(failures, 0);
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

test("worker verifies only a pending login from the same tab", async () => {
  let listener;
  vm.runInNewContext(backgroundSource, {
    URL,
    chrome: {
      storage: { session: mockSessionStorage() },
      runtime: {
        onMessage: { addListener(value) { listener = value; } },
        getURL: (file) => `chrome-extension://test/${file}`,
      },
    },
    fetch() {},
  });

  function send(message, url, tabId) {
    return new Promise((resolve) => {
      listener(message, { url, tab: { id: tabId } }, resolve);
    });
  }

  const loginUrl = "https://accounts.khanacademy.org/login";
  const profileUrl = "https://www.khanacademy.org/profile/me/";
  const verification = {
    type: "LOGIN_VERIFIED",
    url: profileUrl,
  };

  assert.equal(
    (await send({ type: "LOGIN_ATTEMPTED" }, loginUrl, 17)).success,
    true
  );
  assert.equal(
    (await send(verification, profileUrl, 18)).success,
    false
  );
  assert.equal(
    (await send(verification, "https://www.khanacademy.org/", 17)).success,
    true
  );
  assert.equal(
    (await send(verification, profileUrl, 17)).success,
    false
  );

  assert.equal(
    (await send({ type: "LOGIN_ATTEMPTED" }, loginUrl, 17)).success,
    true
  );
  assert.equal(
    (await send({ type: "LOGIN_FAILED" }, loginUrl, 17)).success,
    true
  );
  assert.equal(
    (await send(verification, profileUrl, 17)).success,
    false
  );
});

test("success confirmation survives client-side routing to the dashboard", async () => {
  const logs = [];
  const location = new URL("https://www.khanacademy.org/");
  const document = {
    title: "Khan Academy",
    querySelectorAll() { return []; },
  };
  let sleeps = 0;
  const context = vm.createContext({
    window: { location },
    document,
    khanShowToast() {},
    console: {
      log: (...args) => logs.push(args.join(" ")),
      error() {},
      warn() {},
    },
    setTimeout(callback) {
      Promise.resolve().then(() => {
        sleeps += 1;
        location.pathname = "/profile/me/";
        document.title = "Dashboard | Khan Academy";
        document.querySelectorAll = () => [
          { textContent: "Learner home", getClientRects: () => [1] },
          { textContent: "My account", getClientRects: () => [1] },
          { textContent: "My profile", getClientRects: () => [1] },
        ];
        callback();
      });
      return sleeps;
    },
    chrome: {
      runtime: {
        async sendMessage(message) {
          if (message.type === "HAS_PENDING_LOGIN") {
            return { success: true, pending: true };
          }
          assert.equal(message.type, "LOGIN_VERIFIED");
          return { success: true };
        },
      },
    },
  });

  vm.runInContext(verifySource, context);
  await flushTasks();

  assert.ok(sleeps >= 1);
  assert.ok(
    logs.some((entry) => entry.includes("Successfully logged in to Khan Academy"))
  );
});

for (const correlated of [true, false]) {
  test(
    `dashboard ${correlated ? "shows" : "does not show"} login success when ${correlated ? "correlated" : "already authenticated"}`,
    async () => {
      const logs = [];
      const toasts = [];
      const headings = ["My account", "My profile", "Learner home"]
        .map((textContent) => ({ textContent, getClientRects: () => [1] }));
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
        khanShowToast: (text, success) => toasts.push({ text, success }),
        chrome: {
          runtime: {
            async sendMessage(message) {
              if (message.type === "HAS_PENDING_LOGIN") {
                return { success: true, pending: correlated };
              }
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
      assert.deepEqual(toasts, correlated
        ? [{ text: "Successfully logged in to Khan Academy", success: true }]
        : []);
    }
  );
}
