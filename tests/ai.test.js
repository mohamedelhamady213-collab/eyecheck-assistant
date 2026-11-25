import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, validateReport, runScreening, runCloudWithConsent, AiError, buildPrompt } from "../src/ai.js";
const good = { image_quality: { overall: "good", issues: [] }, observations: { right: ["Mild redness appears."], left: ["No obvious redness."] }, symptom_summary: "Mild redness.", limitations: ["Photo only."], next_steps: ["Book an exam."], urgency: "soon", uncertainty: "Lighting." };
const opts = { eyes: ["right", "left"], triageLevel: "routine", appQuality: {} };
test("extractJson tolerates prose/markdown fences", () => assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 }));
test("invalid JSON throws invalid_json", () => { assert.throws(() => extractJson("not json"), (e) => e.code === "invalid_json"); assert.throws(() => extractJson("{bad json}"), (e) => e.code === "invalid_json"); });
test("valid report passes and keeps AI urgency", () => { const r = validateReport(good, opts); assert.equal(r.urgency, "soon"); assert.deepEqual(r.missing, []); });
test("AI cannot lower deterministic urgency", () => assert.equal(validateReport({ ...good, urgency: "routine" }, { ...opts, triageLevel: "emergency" }).urgency, "emergency"));
test("AI can raise urgency", () => assert.equal(validateReport({ ...good, urgency: "urgent" }, opts).urgency, "urgent"));
test("invented percentages are removed", () => {
  const r = validateReport({ ...good, observations: { right: ["Glaucoma risk 73% likely", "Mild redness appears."], left: [] } }, opts);
  assert.deepEqual(r.observations.right, ["Mild redness appears."]);
});
test("missing fields are reported, never fabricated", () => {
  const r = validateReport({ urgency: "soon", observations: { right: ["x"], left: ["y"] } }, opts);
  assert.ok(r.missing.includes("limitations") && r.missing.includes("next_steps")); assert.deepEqual(r.limitations, []);
});
test("empty or non-object output throws invalid_schema", () => {
  assert.throws(() => validateReport(null, opts), (e) => e.code === "invalid_schema");
  assert.throws(() => validateReport({ foo: 1 }, opts), (e) => e.code === "invalid_schema");
  assert.throws(() => validateReport([1], opts), (e) => e.code === "invalid_schema");
});
test("poor app-side image quality overrides optimistic AI and blocks reassurance", () => {
  const r = validateReport(good, { ...opts, appQuality: { right: { overall: "poor" } } });
  assert.equal(r.image_quality.overall, "poor"); assert.equal(r.reassurance_blocked, true);
});
test("HTML is stripped from model strings", () => assert.ok(!validateReport({ ...good, symptom_summary: "<img src=x onerror=alert(1)>Hi" }, opts).symptom_summary.includes("<")));
test("prompt forbids diagnosis, mentions Arabic and omits nothing about quality", () => {
  const p = buildPrompt({ summary: { eye: "right", history: ["none"], text: "" }, eyes: ["right"], lang: "ar", quality: { right: { overall: "poor", checks: [{ id: "sharpness", status: "poor" }] } } });
  assert.match(p, /Arabic/); assert.match(p, /Never give percentages/); assert.match(p, /sharpness/);
});
const input = { parts: ["p"] };
test("Nano unavailable: throws nano_unavailable and NEVER calls cloud", async () => {
  let cloud = 0; const engines = { nanoState: async () => "unavailable", runDevice: async () => "{}", runCloud: async () => { cloud++; return { text: "{}" }; } };
  await assert.rejects(runScreening({ input, engines }), (e) => e.code === "nano_unavailable"); assert.equal(cloud, 0);
});
test("Nano init/generate failure: throws nano_failed and NEVER calls cloud", async () => {
  let cloud = 0; const engines = { nanoState: async () => "available", runDevice: async () => { throw new Error("init failed"); }, runCloud: async () => { cloud++; return { text: "{}" }; } };
  await assert.rejects(runScreening({ input, engines }), (e) => e.code === "nano_failed"); assert.equal(cloud, 0);
});
test("Nano success returns on_device result", async () => {
  const engines = { nanoState: async () => "available", runDevice: async () => JSON.stringify(good) };
  const r = await runScreening({ input, engines }); assert.equal(r.source, "on_device"); assert.equal(r.model, "Gemini Nano");
});
test("Nano returns invalid JSON: invalid_json and no cloud call", async () => {
  let cloud = 0; const engines = { nanoState: async () => "available", runDevice: async () => "sorry", runCloud: async () => { cloud++; return { text: "{}" }; } };
  await assert.rejects(runScreening({ input, engines }), (e) => e.code === "invalid_json"); assert.equal(cloud, 0);
});
test("cloud without explicit consent is refused and nothing is sent", async () => {
  let cloud = 0; const engines = { runCloud: async () => { cloud++; return { text: JSON.stringify(good), model: "m" }; } };
  for (const consent of [undefined, null, {}, { granted: false, preview: true }, { granted: true }, { granted: "yes", preview: true }])
    await assert.rejects(runCloudWithConsent({ input, engines, consent }), (e) => e.code === "no_consent");
  assert.equal(cloud, 0);
});
test("cloud with consent after preview works", async () => {
  const engines = { runCloud: async () => ({ text: JSON.stringify(good), model: "gemini-3.8-flash" }) };
  const r = await runCloudWithConsent({ input, engines, consent: { granted: true, preview: true } }); assert.equal(r.source, "in_cloud"); assert.equal(r.model, "gemini-3.8-flash");
});
