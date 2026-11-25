import test from "node:test";
import assert from "node:assert/strict";
import { validate, sanitizeText, buildSummary, summaryToText, QUESTIONS } from "../src/symptoms.js";
const ok = { eye: "both", onset: "today", pain: "mild", redness: "yes", blur: "none", light: "no", flashes: "no", suddenLoss: "no", injury: "no", history: ["dry_eye"], diabetes: "type2", text: "itchy" };
test("valid answers pass", () => assert.equal(validate(ok).ok, true));
test("missing required answer fails", () => { const { eye, ...rest } = ok; const v = validate(rest); assert.equal(v.ok, false); assert.equal(v.errors.eye, "required"); });
test("invalid option fails", () => assert.equal(validate({ ...ok, pain: "huge" }).errors.pain, "invalid"));
test("none cannot be combined", () => assert.equal(validate({ ...ok, history: ["none", "glaucoma"] }).errors.history, "invalid"));
test("text length enforced", () => assert.equal(validate({ ...ok, text: "x".repeat(501) }).errors.text, "too_long"));
test("sanitize strips control chars and caps", () => { assert.equal(sanitizeText("a\u0000b\u0007c  d"), "abc d"); assert.equal(sanitizeText("y".repeat(900)).length, 500); });
test("summary text contains all answers and handles Arabic text", () => {
  const s = summaryToText(buildSummary({ ...ok, text: "العين اليمنى حمراء منذ ٣ أيام" }));
  assert.match(s, /Pain: mild/); assert.match(s, /العين اليمنى حمراء/); assert.equal(QUESTIONS.length, 11);
});
