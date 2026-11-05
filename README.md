# Nucleos Senior Software Engineer Take-Home

This project contains a headed Playwright registration script and a Chrome
Manifest V3 extension that fills and submits the Khan Academy login form.
Both components require the authenticated learner dashboard before reporting
success. CAPTCHA and email verification remain manual.

## Installation

Prerequisites:

- A current Node.js LTS release (Node.js 22 or newer recommended) and npm.
- Google Chrome with permission to load unpacked extensions.
- Internet access and an email inbox you control.

From the repository root:

```sh
npm ci
npx playwright install chromium
```

Playwright uses its downloaded Chromium for onboarding. The extension is loaded
separately in Chrome; running the onboarding script does not install it.

## Configuration

### Playwright credentials and date of birth

```sh
cp .env.example .env
```

Edit `.env` using the keys in [.env.example](.env.example):

```dotenv
SIGNUP_URL=https://www.khanacademy.org/signup
BIRTH_MONTH=Jul
BIRTH_YEAR=1990
KHAN_EMAIL=your-email@example.com
KHAN_PASSWORD=your-unique-password
```

Use a unique password and an address you control. Set `BIRTH_MONTH` and
`BIRTH_YEAR` to the adult registrant's actual birth month and year. The script
reads all five values through `dotenv`; existing process environment values take
precedence. This script is designed for the adult learner flow, not child or
parent registration.

### Extension credentials

```sh
cp extension/config.example.json extension/config.json
```

For the **first run, keep the deliberately wrong values** copied from
[extension/config.example.json](extension/config.example.json). They should
produce Khan Academy's own error in a toast and console log. Make only one
deliberately failed attempt.

Then replace the local JSON values with the credentials of the **single account
created by the onboarding script**:

```json
{
  "email": "your-email@example.com",
  "password": "your-unique-password"
}
```

The extension does not read `.env`, so configure it separately using that same
account. Do not create a second account for testing.

Both `.env` and `extension/config.json` are ignored by Git. They are still
plaintext local files, not an encrypted secret store. Do not commit, distribute,
or include them in screenshots or shared extension packages.

## Running Playwright

Run from the repository root so `dotenv` finds `.env`:

```sh
npm run onboard
```

The script:

1. Validates credentials and refuses to run if a previous submission marker exists.
2. Opens visible Chromium with a 100 ms action delay.
3. Visits signup, selects necessary cookies if offered, and chooses the
   "Student learning on my own" flow.
4. Selects date of birth, fills credentials, and checks the terms checkbox.
5. Writes `onboarding/.registration-submitted.json` with status `attempted`
   **before** clicking Sign up once.
6. Logs validation messages with configured credentials redacted and leaves
   Chromium open for manual challenges and dashboard confirmation.

Running this command submits a real registration and agrees to the site's terms.
Review the configuration and terms before running. Closing the page ends the
manual-review wait and the script closes its browser. Script errors are printed
with `[Onboarding]` and set a nonzero exit code.

An `attempted` submission marker is a duplicate-attempt guard, **not proof of
account creation**. In the fresh Chromium context, the script waits for
`https://www.khanacademy.org/profile/me` (with an optional trailing slash), the
title `Dashboard | Khan Academy`, visible headings "My account", "My profile",
and "Learner home", and no visible Sign up button. Only then does it write
`status: "verified"` with a timestamp and evidence description, and log:

```text
[Onboarding] Account creation confirmed: authenticated learner dashboard reached.
```

This is UI-based evidence of an authenticated account after the signup submission
in a fresh context, not independent backend or email-verification evidence.
Do not manually sign into a different account in that context. Disappearance of
the signup form alone is never confirmation. Closing before the evidence appears
leaves the marker `attempted`, reports an unconfirmed outcome, and exits nonzero.

If the marker blocks a later run, first inspect the account, inbox, and previous
result. Only remove that specific local marker after confirming a new attempt
is appropriate; do not remove it merely to retry an uncertain submission.

## Loading and running the extension

1. Copy the deliberately wrong example into `extension/config.json` for the
   failure demonstration; correct it only afterward.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**, click **Load unpacked**, and select the
   [extension](extension) folder, not the repository root.
4. In a logged-out tab, navigate directly to
   `https://www.khanacademy.org/login` or
   `https://accounts.khanacademy.org/login`.

Both `/login` and `/login/` are supported, with optional query parameters.
The extension fills the username and password fields and clicks the submit
button once per document. Reloading the page permits another automatic attempt.

On `https://www.khanacademy.org/profile/me` or `/profile/me/`, it checks for the
dashboard title and headings, then asks the worker to correlate the result with
the login attempt in the same tab. A confirmed result shows a green success
toast and logs:

```text
[Khan Auto Login] Successfully logged in to Khan Academy
```

An incorrect-login message from Khan Academy is shown word for word in a red
toast and printed unchanged, including whitespace. Toast text is inserted as
plain text, never HTML, and remains visible until another toast or navigation.
Form,
configuration, and unverified-outcome errors use `[Khan Auto Login]`.
Inspect these messages in the page's DevTools console. Enable **Preserve log**
to retain login-page messages across navigation.

After editing code or configuration, click **Reload** on the extension card and
reload the login tab. For load or worker errors, check the extension card's
**Errors** and **service worker** inspection link. There is no popup or options UI.

## Architecture

| Component | Responsibility |
|---|---|
| [onboarding/create-account.js](onboarding/create-account.js) | Independent Node.js/Playwright registration flow, environment credentials, duplicate-attempt marker, and manual review. |
| [extension/manifest.json](extension/manifest.json) | Registers the MV3 worker and injects scripts on supported login and profile URLs. |
| [extension/content.js](extension/content.js) | Waits for login fields, requests credentials, uses the native input setter plus input/change events for React-controlled fields, records an attempt, submits once, and watches for failure. |
| [extension/background.js](extension/background.js) | Validates message sender URLs, reads local credential configuration, and correlates login attempts by tab ID. |
| [extension/verify.js](extension/verify.js) | Checks the authenticated dashboard and reports a verified result through messaging. |
| [extension/toast.js](extension/toast.js) | Shared accessible plain-text failure and success toast renderer. |

Message flow:

```text
Login content script --> GET_CREDENTIALS --> Background worker --> config.json
Login content script --> LOGIN_ATTEMPTED --> Worker records tab ID and timestamp
Login content script --> Submit Khan Academy form
  Khan Academy error    --> LOGIN_FAILED --> Worker clears pending attempt
  Profile dashboard     --> LOGIN_VERIFIED --> Worker checks and consumes attempt
```

The verifier first requests `HAS_PENDING_LOGIN`. With no pending attempt it
returns without inspecting dashboard contents, polling, showing toasts, or
logging an outcome. It is injected across `www.khanacademy.org` so it can observe
client-side routing after a login; login form interaction remains restricted to
the exact login paths. The login script also starts the verifier after recording
an attempt when both scripts share a document.

### Why credentials are handled by a background service worker

The service worker is the Manifest V3 background execution model. It provides an
extension-owned place to read configuration and enforce sender checks rather
than embedding credentials in the content-script source or exposing the
configuration as a web-accessible resource. Credential responses are limited
to the two allowed HTTPS origins and exact login paths.

It also coordinates messages across navigation: the login document is destroyed
when the profile document loads, so a page-local variable cannot correlate them.
The worker associates an attempt with `sender.tab.id`, accepts verification only
from the supported profile URL in that same tab, and consumes the attempt to
avoid reporting unrelated dashboard visits as login success.

This is separation of responsibilities, not encryption: the content script still
receives credentials and puts them into the site's form. The current worker
stores only tab IDs and timestamps in `chrome.storage.session`, so worker
restarts do not lose pending attempts. Credentials are not stored there.
Attempts expire after five minutes and verification consumes them once.
Session state is cleared when the browser session ends or the extension reloads.

### Permissions

- **`storage`:** required for `chrome.storage.session` to preserve pending login
  correlation across MV3 worker suspension/restarts. Only attempt timestamps are
  stored; no credentials or browsing history are persisted.
- **Content-script site access:** declared through `content_scripts.matches` for
  accounts-host login pages and `www.khanacademy.org` pages. The latter permits
  observing client-side dashboard redirects; verification is gated by a pending
  attempt in that tab.
- No separate `host_permissions`, `tabs`, `scripting`, notification, or cookie
  permissions are requested. Fetching the extension's own configuration file
  does not require remote host access.

## Testing

Run the offline Node.js test suite:

```sh
npm test
```

Or run only extension tests:

```sh
node --test tests/extension.test.js
```

[tests/onboarding.test.js](tests/onboarding.test.js) checks environment credential
usage, duplicate-submission safeguards, and marker handling.
[tests/extension.test.js](tests/extension.test.js) uses Node VM contexts and mocked
DOM/Chrome APIs to exercise URL matching, credential validation, one submission
per document, unavailable forms, authentication errors/timeouts, exact toast
text, and same-tab verification correlation across worker restarts. A headless
Playwright test renders the toasts and fills inputs against locally fulfilled
HTML, with mocked extension messaging. It requires the Chromium installation
from the installation steps above. Onboarding tests also exercise positive and
negative dashboard confirmation evidence.

These are offline regression tests, including a real browser with synthetic
pages, not live account tests. They neither contact Khan Academy nor create an
account, and do not prove that current selectors still match its live UI.

For manual testing, use an account you control: confirm a logged-out login page
submits once, review console output, and check dashboard success. Test incorrect
credentials only deliberately and sparingly, then restore the valid local
configuration. An already-authenticated dashboard visit should not report a
new extension-initiated success. Avoid repeated registration or login attempts.

## CAPTCHA and email verification: manual handling

Neither component solves, bypasses, or outsources CAPTCHA, client challenges,
email verification, or other account checks.

- **Registration:** after the submission, Chromium remains open. Complete any
  challenge interactively, inspect the inbox you control, and follow Khan
  Academy's verification instructions manually. If the email link opens another
  browser, check the account there as well; cookies are not shared with the
  script's Chromium context. If necessary, return to the original Chromium tab
  and navigate to the learner dashboard after completing the account check.
  The script can only confirm evidence in its original tab. Do not submit
  registration a second time simply because verification is pending.
- **Login:** complete any challenge or email-based check yourself in Chrome.
  There is no automatic retry or CAPTCHA-solving logic. Outcome observation
  allows up to five minutes for manual completion. If reporting times out,
  inspect the actual account state rather than treating the timeout as proof
  that credentials were rejected.
- **Challenges before registration submission:** normal action timeouts still
  apply. If a challenge prevents the script from finding the form, it can exit
  and close Chromium; it has no dedicated pause/resume workflow at this stage.
  Resolve access manually and inspect whether a submission marker exists before
  deciding to run again.

## Limitations

- Selectors, English text, dashboard title, and headings are tied to the current
  Khan Academy UI. Localization, layout changes, disabled buttons, or alternate
  flows may require updates.
- Content scripts initialize on matched document loads. Navigation into login
  or profile routes within an existing single-page-app document may require a
  direct navigation or reload.
- Login form waits use 15-second deadlines; login outcome observation and worker
  correlation allow five minutes. A timeout reports an unknown outcome, not
  rejected credentials. Only a site error or consumed/expired correlation clears
  the attempt. A long manual challenge may finish
  successfully without producing the extension's success message.
- Pending attempts survive worker restarts but not an extension reload or browser
  restart. A missing correlation is reported rather than assumed successful.
- Success detection only covers the supported learner profile dashboard and
  its expected title/headings. Redirects to other destinations are not verified.
  Dashboard detection is not independent proof of email verification.
- Onboarding uses a fresh, non-persistent browser context. It does not retain
  sessions after closing or install the extension. Automatic confirmation relies
  on the dashboard UI, not a documented registration API.
- Credentials remain plaintext on disk. This is a local take-home implementation,
  not a production credential-management system.
- Live behavior depends on network access, Khan Academy availability, account
  state, and anti-automation checks. Offline tests cannot guarantee live success.

## AI tooling

An AI assistant using Copilot SDK in VS Code was used for code inspection,
implementation assistance, regression tests, and README drafting. Its suggestions
were checked against the repository and offline tests; those checks are not
evidence of a successful live account creation or login. The walkthrough should
explain the code and these limitations, not attribute correctness to AI.

## Recording and delivery

**[Watch the Chrome extension demo](<Khan Academy Auto Login – Chrome Extension Demo.mp4>).**
A real demonstration is included; offline tests are not a substitute.

Keep the recording at or below four minutes:

1. Show the original onboarding run and its confirmed outcome. If an account
   already exists, use the original footage; do not rerun signup just to record.
   If no footage exists, disclose that limitation rather than fabricate a run.
2. Show one login with the deliberately wrong example configuration, including
   Khan Academy's exact error toast and console log.
3. Off-camera, configure the same created account, reload the extension, and
   show the corrected login with the confirmed success toast and log.

Hide real email addresses, passwords, inbox contents, and token-bearing URLs.
Never show the real configuration or environment files. Commit and push only
non-secret changes, verify reviewer access to the GitHub repository, and reply
to the hiring email with the repository link within the stated deadline.

## With more time

- Extend local browser integration tests to React-controlled inputs, complete
  MV3 worker lifecycle behavior, client-side routing, and registration marker
  persistence.
- Validate live selectors and dashboard evidence during the single-account
  walkthrough; broaden confirmation only when backed by observed authenticated
  signals, never by redirects alone.
- Improve manual challenge handling before the registration form, and support
  complete single-page-app login visits without introducing automatic retries.
- Improve outcome correlation for closed tabs and alternate authenticated
  destinations, and consider a user-managed secure credential store for a
  production implementation.
