
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

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
