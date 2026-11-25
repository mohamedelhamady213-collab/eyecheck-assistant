# EyeCheck Assistant

Privacy-first, AI-assisted **preliminary eye screening** built with **Firebase AI Logic hybrid inference** (Gemini Nano on-device, Gemini in the cloud only with consent).

Live demo: https://mohamedelhamady213-collab.github.io/eyecheck-assistant/

**Not a medical device. Preliminary screening only, not a diagnosis and not clinically validated.** See an eye doctor for any concern.

## What it does
- Add a left and/or right eye photo (upload or camera) and optionally describe symptoms (English or Arabic UI).
- Gemini Nano runs on your device through Firebase AI Logic and returns a screening report: urgency, cards for cataract, glaucoma, diabetic retinopathy and macular degeneration ("possible signs" wording; retinal conditions are marked "not assessable from photo"), per-eye observations, next steps.
- Red-flag urgent section, session history (this browser tab only, thumbnails only), print / save as PDF, eye-care tips, doctor guidance, dark mode.

## Privacy model (what really happens)
- Photos and symptom text are sent to the **on-device** model only (`mode: "only_on_device"`).
- If Gemini Nano is unavailable or fails, the app **fails closed**: nothing is sent. It then shows a preview of exactly what would be sent (photos and symptom text). Only if you click "Send to cloud Gemini" is it sent to cloud Gemini through Firebase AI Logic. You can cancel.
- An optional plain-language explanation sends only the generated text summary (no photos, no symptom text) after a confirmation prompt.
- Cloud calls are protected by Firebase App Check (reCAPTCHA Enterprise).
- Session history lives in `sessionStorage` and is cleared when the tab closes.

## How Firebase AI Logic is used
`src/firebase.js` calls `getAI(app, { backend: new GoogleAIBackend() })` and creates `only_on_device` and `only_in_cloud` models (`gemini-3.8-flash`, with `gemini-3.5-flash-lite` as fallback). `src/main.js` calls `generateContent` with text and inline images at runtime.

## Run locally
Requirements: Node 18+, desktop Chrome (latest) with Gemini Nano and image input available (chrome://on-device-internals).
1. Create a Firebase project, enable Firebase AI Logic (Gemini Developer API), register a web app, set up App Check with reCAPTCHA Enterprise.
2. `cp .env.example .env` and fill the values (`VITE_APPCHECK_DEBUG_TOKEN` is only used on localhost).
3. `npm install && npm run dev`

## Deploy
A GitHub Actions workflow (`.github/workflows/pages.yml`) builds with Vite and deploys to GitHub Pages. Only public web config values are in the build; no debug token.

## License
Apache-2.0

## Notes
- Firebase web config values are not secrets; the reCAPTCHA key is restricted to the allowed domains.
- This is a hackathon demo for general information. Do not use it for medical decisions.
