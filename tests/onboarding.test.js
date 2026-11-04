
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { isRegistrationConfirmed, waitForRegistrationConfirmation } =
  require("../onboarding/create-account.js");

const scriptPath = path.join(
  __dirname,
  "../onboarding/create-account.js"
);

const markerPath = path.join(
  __dirname,
  "../onboarding/.registration-submitted.json"
);

test("registration script uses environment credentials", () => {
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /process\.env\.KHAN_EMAIL/);
  assert.match(source, /process\.env\.KHAN_PASSWORD/);
});

test("registration script guards against repeat submissions", () => {
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /existsSync\(SUBMISSION_MARKER\)/);
  assert.match(source, /flag:\s*"wx"/);
});

test("registration marker is ignored by Git", () => {
  const gitignore = fs.readFileSync(
    path.join(__dirname, "../.gitignore"),
    "utf8"
  );

  assert.ok(
    gitignore.includes("onboarding/.registration-submitted.json")
  );
});

test("registration marker records a verified result when present", () => {
  if (!fs.existsSync(markerPath)) {
    return;
  }

  const marker = JSON.parse(
    fs.readFileSync(markerPath, "utf8")
  );

  assert.ok(
    ["attempted", "verified"].includes(marker.status)
  );
});

const dashboard = {
  url: "https://www.khanacademy.org/profile/me/",
  title: "Dashboard | Khan Academy",
  headings: ["My account", "My profile", "Learner home"],
  signupVisible: false,
};

test("registration requires all authenticated dashboard signals", () => {
  assert.equal(isRegistrationConfirmed(dashboard), true);
  for (const snapshot of [
    { ...dashboard, url: "https://www.khanacademy.org/signup" },
    { ...dashboard, url: "https://example.com/profile/me/" },
    { ...dashboard, title: "Khan Academy" },
    { ...dashboard, headings: ["My account", "My profile"] },
    { ...dashboard, signupVisible: true },
  ]) {
    assert.equal(isRegistrationConfirmed(snapshot), false);
  }
});

test("registration confirmation observes the dashboard without resubmitting", async () => {
  let observations = 0;
  const confirmed = await waitForRegistrationConfirmation({
    isClosed: () => false,
    async evaluate() { observations += 1; return dashboard; },
  });
  assert.equal(confirmed, true);
  assert.equal(observations, 1);
});

test("closing Chromium without dashboard evidence remains unconfirmed", async () => {
  assert.equal(await waitForRegistrationConfirmation({ isClosed: () => true }), false);
});

test("registration observation errors are not mistaken for success", async () => {
  await assert.rejects(waitForRegistrationConfirmation({
    isClosed: () => false,
    async evaluate() { throw new Error("Browser unavailable"); },
  }), /Browser unavailable/);
});
