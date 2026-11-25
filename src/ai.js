// Prompt building and strict validation of model output. No network code here.
import { LEVELS, maxLevel } from "./safety.js";
import { summaryToText } from "./symptoms.js";

export class AiError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

export const NOT_ASSESSABLE = ["glaucoma", "diabetic_retinopathy", "amd", "retinal_detachment"]; // fixed by the app, never by the model
export const QUALITY_VALUES = ["good", "fair", "poor", "not_an_eye", "no_image"];

export function buildPrompt({ summary, eyes, lang, quality }) {
  const q = Object.entries(quality || {}).map(([e, v]) => `${e}: app check says ${v.overall}${v.checks ? " (" + v.checks.filter((c) => c.status === "warn" || c.status === "poor").map((c) => c.id).join(", ") + ")" : ""}`).join("; ");
  return [
    "You are an assistant that gives PRELIMINARY, NON-DIAGNOSTIC information about external eye photos and a symptom summary. You are not a doctor and must not diagnose.",
    "Rules:",
    "- Describe only what is visibly present in the photo (for example redness, discharge, lid swelling, visible asymmetry, cloudiness of the clear front of the eye). Use cautious words such as 'appears' and 'possible'.",
    "- An external photo cannot show the retina or optic nerve. Never comment on glaucoma, diabetic retinopathy, macular degeneration or retinal detachment from the photo.",
    "- Never give percentages, probabilities, scores or confidence numbers. Never say a condition is present or absent.",
    "- If an image is blurry, dark, glared, cropped, or not an eye, say so in image_quality and do not reassure the user.",
    "- If something is uncertain, say it is uncertain.",
    "- The urgency field is your suggestion only. Use routine, soon, urgent or emergency. When in doubt choose the more cautious option.",
    "Reply with ONLY compact JSON (no markdown) in exactly this shape:",
    '{"image_quality":{"overall":"good|fair|poor|not_an_eye|no_image","issues":["..."]},',
    '"observations":{"left":["..."],"right":["..."]},',
    '"symptom_summary":"1-2 sentences","limitations":["..."],"next_steps":["..."],',
    '"urgency":"routine|soon|urgent|emergency","uncertainty":"one sentence on what is uncertain"}',
    "Include observations only for eyes that were provided. Keep each string under 160 characters.",
    lang === "ar" ? "Write every string value in simple Modern Standard Arabic. Keep the JSON keys and the enum values (good, fair, poor, routine, soon, urgent, emergency ...) in English." : "Write in English.",
    "Photos provided: " + (eyes.length ? eyes.join(", ") : "none") + ".",
    q ? "On-device photo checks: " + q + "." : "",
    "Symptom summary from the user:",
    summaryToText(summary),
  ].filter(Boolean).join("\n");
}

export function extractJson(text) {
  const t = String(text || "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new AiError("invalid_json", "No JSON object in model output");
  try { return JSON.parse(t.slice(s, e + 1)); } catch { throw new AiError("invalid_json", "Model output was not valid JSON"); }
}

const PCT = /\b\d{1,3}(\.\d+)?\s?(%|percent|٪)|probabilit|confidence (of|score)|\bscore of\b|نسبة \d+|احتمال(ية)? \d+/i;
function cleanStr(v, max = 220) {
  if (typeof v !== "string") return null;
  let s = v.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  if (!s) return null;
  if (PCT.test(s)) return null; // invented numbers are dropped, not displayed
  return s;
}
function cleanList(v, maxItems = 6) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanStr(x)).filter(Boolean).slice(0, maxItems);
}

// Validates + normalizes. Throws AiError("invalid_schema") when essential content is missing.
// Never fabricates content: missing optional parts stay empty and are reported in `missing`.
export function validateReport(raw, { eyes = [], triageLevel = "routine", appQuality = {} } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AiError("invalid_schema", "Not an object");
  const missing = [];
  const iq = raw.image_quality && typeof raw.image_quality === "object" ? raw.image_quality : null;
  let overall = iq && QUALITY_VALUES.includes(iq.overall) ? iq.overall : null;
  if (!overall) missing.push("image_quality");
  const obsRaw = raw.observations && typeof raw.observations === "object" ? raw.observations : null;
  if (!obsRaw) missing.push("observations");
  const observations = {};
  for (const e of eyes) observations[e] = cleanList(obsRaw && obsRaw[e]);
  if (obsRaw && eyes.length && eyes.every((e) => !observations[e].length) && overall !== "poor" && overall !== "not_an_eye") missing.push("observations_empty");
  const summary = cleanStr(raw.symptom_summary, 400);
  if (!summary) missing.push("symptom_summary");
  const limitations = cleanList(raw.limitations);
  if (!limitations.length) missing.push("limitations");
  const nextSteps = cleanList(raw.next_steps);
  if (!nextSteps.length) missing.push("next_steps");
  const aiUrgency = LEVELS.includes(raw.urgency) ? raw.urgency : null;
  if (!aiUrgency) missing.push("urgency");
  const uncertainty = cleanStr(raw.uncertainty, 300);
  if (!uncertainty) missing.push("uncertainty");
  // Essential: urgency or (observations when photos were sent). Otherwise the report is unusable.
  if (!aiUrgency && !obsRaw) throw new AiError("invalid_schema", "Missing essential fields: " + missing.join(", "));
  // Poor app-side quality always wins over a more optimistic model opinion.
  const appPoor = Object.values(appQuality).some((q) => q && q.overall === "poor");
  if (appPoor && (overall === "good" || overall === "fair" || !overall)) overall = "poor";
  const urgency = maxLevel(triageLevel, aiUrgency || "routine"); // model can never lower the deterministic level
  return {
    image_quality: { overall: overall || "unknown", issues: cleanList(iq && iq.issues) },
    observations, symptom_summary: summary, limitations, next_steps: nextSteps,
    ai_urgency: aiUrgency, urgency, uncertainty, missing,
    reassurance_blocked: appPoor || overall === "poor" || overall === "not_an_eye" || overall === "no_image",
  };
}

// Orchestration with injected engines so every branch is testable without Firebase.
// engines: { nanoState(): Promise<string>, runDevice(parts, onProgress), runCloud(parts) } each returns text.
export async function runScreening({ input, engines, onProgress }) {
  const st = await engines.nanoState();
  if (st === "unavailable") throw new AiError("nano_unavailable", "Gemini Nano is not available");
  let text;
  try { text = await engines.runDevice(input.parts, onProgress); }
  catch (e) { throw new AiError("nano_failed", e && e.message ? e.message : "on-device failure"); }
  return { source: "on_device", model: "Gemini Nano", raw: extractJson(text) };
}
// Cloud is a separate function: callers must obtain consent first. `consent` must be an explicit object created by the UI.
export async function runCloudWithConsent({ input, engines, consent }) {
  if (!consent || consent.granted !== true || consent.preview !== true) throw new AiError("no_consent", "Cloud consent missing");
  const { text, model } = await engines.runCloud(input.parts);
  return { source: "in_cloud", model, raw: extractJson(text) };
}
