// TEST BUILD ONLY (vite --mode test). Replaces src/firebase.js so end-to-end tests can run without network.
// Behaviour is driven by window.__mock, set by the test runner before the page loads.
const cfg = () => window.__mock || {};
const log = (kind, parts) => { (window.__sent = window.__sent || []).push({ kind, n: Array.isArray(parts) ? parts.length : 1 }); };
const reply = (c) => {
  if (c.raw != null) return c.raw;
  return JSON.stringify(c.json || {
    image_quality: { overall: "good", issues: [] }, observations: { right: ["The white of the eye appears mildly red."], left: ["No obvious redness appears in this photo."] },
    symptom_summary: "Mild redness reported without pain.", limitations: ["A photo cannot show the retina."], next_steps: ["Book an eye exam if it lasts more than a few days."],
    urgency: "soon", uncertainty: "Lighting in the photo limits what can be described." });
};
export const CLOUD_MODEL = "gemini-3.8-flash", CLOUD_LITE = "gemini-3.5-flash-lite";
export const deviceOnlyModel = {
  async initializeDeviceModel(cb) { if (cfg().deviceInitFails) throw new Error("model init failed"); cb && cb(0.5); },
  async generateContent(parts) { if (cfg().deviceFails) throw new Error("device generate failed"); (window.__device = window.__device || []).push(parts.length); return { response: { text: () => reply(cfg().device || {}) } }; },
};
export const cloudModel = { async generateContent(parts) { log("cloud", parts); if (cfg().cloudFails) throw new Error("cloud boom"); return { response: { text: () => reply(cfg().cloud || {}) } }; } };
export const cloudModelLite = cloudModel;
export async function nanoAvailability() { return cfg().nano || "available"; }
