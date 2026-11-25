# EyeCheck Assistant

Privacy-first eye-health information assistant built with **Firebase AI Logic hybrid inference**.

**Not a medical device. Informational only, not a diagnosis.** See an eye doctor for any concern.

## Value proposition
Eye symptoms are personal. EyeCheck first runs Gemini Nano **on your device** (Chrome desktop) to turn your free text into a short, anonymous summary. Only if you opt in is that summary (never your original text) sent to cloud Gemini for a plain-language explanation and guidance on when to seek care. Built on the author's earlier AI eye-disease classification project.

## How Firebase AI Logic is used
`src/firebase.js` creates `getAI(app, {backend: new GoogleAIBackend()})` and two models: `mode: "prefer_on_device"` (on-device Gemini Nano with cloud fallback) and `mode: "only_in_cloud"` (opt-in explanation). `src/main.js` calls `generateContent` on both at runtime.

## Run
Requirements: Node 18+, desktop Chrome (latest) with Gemini Nano. If on-device is not available the SDK falls back to cloud.
1. Chrome desktop with Gemini Nano available (chrome://on-device-internals).
2. Create a Firebase project, enable Firebase AI Logic (Gemini Developer API), register a web app.
3. `cp .env.example .env` and fill the values.
4. `npm install && npm run dev`

## License
Apache-2.0

## Notes
- Original symptom text never leaves the device unless Gemini Nano is unavailable and the SDK falls back to cloud; the optional explanation step sends only the generated summary and requires a checkbox.
- Firebase web config keys are not secrets; restrict the API key by HTTP referrer in Google Cloud console.
- Build: `npm run build` outputs `dist/` (deployable with Firebase Hosting).
