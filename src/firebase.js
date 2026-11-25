import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend, getGenerativeModel } from "firebase/ai";

// Firebase web app config comes from Vite env vars (see .env.example).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// App Check (required by Firebase AI Logic). On localhost, a debug token is used.
if (location.hostname === "localhost" && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}
const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
const ai = getAI(app, { backend: new GoogleAIBackend() });

// Hybrid inference with Firebase AI Logic.
// 1) On-device only (Gemini Nano in Chrome): nothing leaves the browser.
export const deviceOnlyModel = getGenerativeModel(ai, { mode: "only_on_device" });
// 2) Cloud Gemini: used only after the user explicitly consents.
export const cloudModel = getGenerativeModel(ai, {
  mode: "only_in_cloud",
  inCloudParams: { model: "gemini-3.8-flash" },
});
// Fallback cloud model if the main one is overloaded.
export const cloudModelLite = getGenerativeModel(ai, {
  mode: "only_in_cloud",
  inCloudParams: { model: "gemini-3.5-flash-lite" },
});
