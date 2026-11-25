import { onDeviceModel, cloudModel } from "./firebase.js";

const $ = (id) => document.getElementById(id);

const RED_FLAGS = /(sudden|suddenly).*(vision loss|blind|can't see)|severe (eye )?pain|flashes|curtain|chemical|trauma|injur/i;

let deviceReady = false;
async function ensureDeviceModel() {
  if (deviceReady) return;
  try {
    await onDeviceModel.initializeDeviceModel((p) => {
      $("summary").textContent = "Downloading on-device model: " + Math.round(p * 100) + "%";
    });
  } catch (e) {
    console.warn("On-device model unavailable, SDK will fall back to cloud:", e);
  }
  deviceReady = true;
}

async function summarizeOnDevice(text) {
  await ensureDeviceModel();
  const prompt =
    "Rewrite the eye symptoms below as a short neutral list: what, which eye, " +
    "how long, severity. Do not diagnose. Remove names and personal details.\n\n" + text;
  const r = await onDeviceModel.generateContent(prompt);
  return r.response.text();
}

async function explainInCloud(summary) {
  const prompt =
    "You give general eye-health information, never a diagnosis. Based on this " +
    "symptom summary, explain in plain language some common possible causes, " +
    "self-care that is generally safe, and when to see an eye doctor. End with " +
    "a reminder to see a professional.\n\n" + summary;
  const r = await cloudModel.generateContent(prompt);
  return r.response.text();
}

$("analyze").addEventListener("click", async () => {
  const text = $("symptoms").value.trim();
  if (!text) return;
  $("urgent").hidden = !RED_FLAGS.test(text);
  $("summary").textContent = "Summarising on your device...";
  try {
    const summary = await summarizeOnDevice(text);
    $("summary").textContent = summary;
    $("explain").hidden = false;
    $("explain").onclick = async () => {
      if (!$("consent").checked) { $("answer").textContent = "Tick the box to send only the summary above to the cloud."; return; }
      $("answer").textContent = "Thinking...";
      try { $("answer").textContent = await explainInCloud(summary); }
      catch (e) { $("answer").textContent = "Cloud request failed: " + e.message; }
    };
  } catch (e) {
    $("summary").textContent = "Error: " + e.message;
  }
});
