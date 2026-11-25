# EyeCheck Assistant: privacy audit

Scope: the code in this repository at the commit that contains this file. Method: reading the source (`src/*.js`, `index.html`) and running the automated tests listed at the end. This is an engineering self-audit, not a legal or third-party security review.

## 1. What stays on the device

| Data | Where | Notes |
| --- | --- | --- |
| Original eye photos | JS memory only (`state.photos`) | Resized to at most 1024 px and re-encoded as JPEG in a canvas. Never written to localStorage, sessionStorage, IndexedDB, cookies or the Cache API. Gone on reload, "Start over" or tab close. |
| Symptom answers and free text | JS memory only | Same as above. A compact summary (enum ids plus the free text) is stored only inside a saved history entry. |
| Gemini Nano analysis | Chrome, on device | Firebase AI Logic is configured `only_on_device`. If Nano is missing or fails, the app stops and says so. It does not fall back to the cloud by itself. |
| Safety triage | Plain JavaScript (`src/safety.js`) | No AI, no network. |
| Demo Mode | JS memory only | Synthetic scenarios. Not written to history, no AI call, no network call. |

## 2. What is stored locally

| Key | Store | Content | Lifetime |
| --- | --- | --- | --- |
| `eyecheck.history.v2` | `sessionStorage` by default | Report history: date, symptom summary, urgency, AI method, 96x72 JPEG thumbnail of the first photo. Max 20 entries. | Until the tab closes, and never longer than 30 days. |
| `eyecheck.history.v2` | `localStorage`, only after the user ticks "keep my history on this device" | Same records. | Up to 30 days. |
| `eyecheck.persist.consent` | `localStorage` | `"1"` when the user opted in. | Until turned off or deleted. |
| `theme`, `lang` | `localStorage` | Display preferences. | Until "Delete everything". |

Thumbnails are small (tests assert under 20 KB) and are the only image data ever stored. The full photos are not.

## 3. Retention (30 days)

* Enforced in code: `src/history.js` drops records older than 30 days (`TTL_DAYS`), records with an unreadable date, and records dated more than a day in the future.
* Applied on every read, at page load (`purgeExpired()` for both stores) and when the tab becomes visible again.
* Tested: unit tests for session and persistent stores, boundary at exactly 30 days, malformed records; a browser test that seeds a 29-day-old and a 31-day-old record, reloads, and checks only the 29-day-old remains and survives a second reload.
* Limit: the purge runs when the page is opened. If nobody opens the site, an expired record stays in the browser until the next visit. That is how browser storage works without a server.

## 4. What is sent to the cloud, and when

Nothing is sent unless the user presses a cloud button.

1. "Send to cloud Gemini" (after Nano is unavailable or failed). Before sending, the user sees a preview: the eye photos, the symptom answers and free text exactly as they will be sent, and a statement that fixed instructions are included. The Send button stays disabled until a confirmation box is ticked. Payload: a fixed instruction prompt, the symptom summary text, the on-device photo-quality notes, and the JPEG photos that were added. Request goes to Gemini through Firebase AI Logic.
   * Gap: the preview lists the answers, free text and photos, but does not print the fixed instruction text or the short on-device photo-quality notes that are also in the prompt. They contain no personal data, but the preview is not a byte-for-byte copy.
2. "Plain-language explanation". After a confirmation dialog, it sends a short text built from the report: its one-line symptom summary, urgency and limits. No photos, no raw answers, no free text. The wording in the app was corrected in this round, because it used to say "no symptom text", which was not accurate for the one-line summary.

Every cloud send is added to the in-page "what was sent" log (memory only).

Not collected: names, emails, accounts, location, device identifiers, analytics or advertising trackers. The app code sets no cookies (Google reCAPTCHA, see section 5, may set its own).

## 5. Contact with Google at page load

Firebase App Check (reCAPTCHA Enterprise) is enforced on the project and starts when the page loads. That contacts Google's reCAPTCHA service even if the user never uses cloud AI. It sends browser and page signals for abuse protection, not the photos or answers. The Privacy Center states this. The Content Security Policy only allows scripts from this origin and Google's reCAPTCHA hosts.

## 6. Secrets in the frontend

Firebase web configuration values and the reCAPTCHA site key are public identifiers by design and are compiled in at build time. No server secrets or API keys with write power are in the repository. The App Check debug token is read only when the host is `localhost` and is not part of the public build. The repository `.gitignore` excludes `.env`.

## 7. Deleting data

* Per entry: "Delete" in the history list.
* All history: "Clear all".
* Everything: "Delete everything" in the Privacy Center removes history (both stores), the opt-in flag, theme and language, and clears sessionStorage.
* Tested in the browser suite (delete one, clear all, delete everything, and the persistent record).

## 8. Limits the user should know

* Browser storage is not encrypted. Anyone with access to the same browser profile, or malware on the device, can read it.
* Private/incognito windows and clearing browser data remove it earlier.
* Data already sent to cloud Gemini follows Google's terms for the Gemini API. This app cannot delete it from there.
* This is a hackathon prototype. It has no clinical validation and no formal security audit.

## 9. How this was verified

`npm test` (unit tests) and `npm run build:test && npm run test:e2e` (headless Chrome against a mock Firebase build, so no real cloud calls). The e2e suite also asserts that the page makes no external requests in the on-device and demo flows. Real cloud behavior on the live site has to be checked by hand with sample data.
