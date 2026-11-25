import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend, getGenerativeModel } from "firebase/ai";

// Firebase web config comes from build-time env vars (see .env.example). These are public identifiers, not secrets.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// App Check is enforced on the project. The debug token is only honored on localhost and is never in the public build.
if (location.hostname === "localhost" && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}
const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
const ai = getAI(app, { backend: new GoogleAIBackend() });

export const CLOUD_MODEL = "gemini-3.8-flash";
export const CLOUD_LITE = "gemini-3.5-flash-lite";
// Hybrid inference with Firebase AI Logic.
// 1) ONLY_ON_DEVICE: Gemini Nano in Chrome. Nothing leaves the browser, and there is no cloud fallback.
export const deviceOnlyModel = getGenerativeModel(ai, { mode: "only_on_device" });
// 2) ONLY_IN_CLOUD: used exclusively after explicit, informed user consent.
export const cloudModel = getGenerativeModel(ai, { mode: "only_in_cloud", inCloudParams: { model: CLOUD_MODEL } });
export const cloudModelLite = getGenerativeModel(ai, { mode: "only_in_cloud", inCloudParams: { model: CLOUD_LITE } });

export async function nanoAvailability() {
  try {
    if (typeof LanguageModel === "undefined") return "unavailable";
    return await LanguageModel.availability({ expectedInputs: [{ type: "text" }, { type: "image" }] });
  } catch { return "unavailable"; }
}
