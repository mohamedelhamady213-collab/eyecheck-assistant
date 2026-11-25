// Symptom questionnaire definition, validation and structured summary.
export const QUESTIONS = [
  { id: "eye", type: "single", required: true, options: ["right", "left", "both", "unsure"] },
  { id: "onset", type: "single", required: true, options: ["today", "days", "weeks", "months", "years"] },
  { id: "pain", type: "single", required: true, options: ["none", "mild", "moderate", "severe"] },
  { id: "redness", type: "single", required: true, options: ["no", "yes"] },
  { id: "blur", type: "single", required: true, options: ["none", "mild", "marked"] },
  { id: "light", type: "single", required: true, options: ["no", "yes"] },
  { id: "flashes", type: "single", required: true, options: ["no", "yes"] },
  { id: "suddenLoss", type: "single", required: true, options: ["no", "yes"] },
  { id: "injury", type: "single", required: true, options: ["no", "yes"] },
  { id: "history", type: "multi", required: false, options: ["none", "glaucoma", "cataract", "retina", "dry_eye", "contact_lens", "recent_surgery", "eye_injury"] },
  { id: "diabetes", type: "single", required: true, options: ["none", "type1", "type2", "unsure"] },
];
export const MAX_TEXT = 500;

export function validate(a) {
  const errors = {};
  for (const q of QUESTIONS) {
    const v = a[q.id];
    if (q.type === "single") {
      if (v == null || v === "") { if (q.required) errors[q.id] = "required"; }
      else if (!q.options.includes(v)) errors[q.id] = "invalid";
    } else {
      if (v != null && (!Array.isArray(v) || v.some((x) => !q.options.includes(x)))) errors[q.id] = "invalid";
    }
  }
  const h = a.history || [];
  if (h.includes("none") && h.length > 1) errors.history = "invalid";
  if (a.text != null && String(a.text).length > MAX_TEXT) errors.text = "too_long";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function sanitizeText(s) {
  // strip control chars, collapse whitespace, cap length. Text is only ever rendered via textContent.
  return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, MAX_TEXT);
}

// Compact, language-neutral summary object (values are enum ids, the UI translates them).
export function buildSummary(a) {
  return {
    eye: a.eye, onset: a.onset, pain: a.pain, redness: a.redness, blur: a.blur, light: a.light,
    flashes: a.flashes, suddenLoss: a.suddenLoss, injury: a.injury,
    history: (a.history && a.history.length ? a.history : ["none"]), diabetes: a.diabetes,
    text: sanitizeText(a.text),
  };
}
// English text sent to the model (enum ids only + the user's own text). Used for the prompt and the cloud preview.
export function summaryToText(s) {
  if (!s) return "No symptom answers given.";
  const yn = (v) => (v === "yes" ? "yes" : "no");
  return [
    `Affected eye: ${s.eye}`, `Onset: ${s.onset}`, `Pain: ${s.pain}`, `Redness: ${yn(s.redness)}`, `Blurred vision: ${s.blur}`,
    `Light sensitivity: ${yn(s.light)}`, `New flashes or floaters: ${yn(s.flashes)}`, `Sudden vision loss: ${yn(s.suddenLoss)}`,
    `Recent injury or chemical exposure: ${yn(s.injury)}`, `Eye history: ${(s.history || []).join(", ")}`, `Diabetes: ${s.diabetes}`,
    `Free text from user: ${s.text || "(none)"}`,
  ].join("\n");
}
