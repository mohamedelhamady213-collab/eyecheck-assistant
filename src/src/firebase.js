import { initializeApp } from "firebase/app";
import { getAI, GoogleAIBackend, getGenerativeModel } from "firebase/ai";

// Fill with your Firebase web app config (Firebase console > Project settings).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const ai = getAI(app, { backend: new GoogleAIBackend() });

// Hybrid inference: on-device Gemini Nano first, cloud Gemini as fallback.
export const onDeviceModel = getGenerativeModel(ai, {
  mode: "prefer_on_device",
  inCloudParams: { model: "gemini-2.5-flash-lite" },
});

// Cloud-only model for the optional, opt-in explanation step.
export const cloudModel = getGenerativeModel(ai, {
  mode: "only_in_cloud",
  inCloudParams: { model: "gemini-2.5-flash" },
});
