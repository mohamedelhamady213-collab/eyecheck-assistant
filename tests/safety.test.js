import test from "node:test";
import assert from "node:assert/strict";
import { triage, scanText } from "../src/safety.js";
const base = { eye: "right", onset: "days", pain: "none", redness: "no", blur: "none", light: "no", flashes: "no", suddenLoss: "no", injury: "no", history: ["none"], diabetes: "none" };
test("no symptoms is routine", () => assert.equal(triage(base).level, "routine"));
test("sudden vision loss is emergency", () => assert.equal(triage({ ...base, suddenLoss: "yes" }).level, "emergency"));
test("chemical/injury is emergency", () => assert.equal(triage({ ...base, injury: "yes" }).level, "emergency"));
test("flashes alone is urgent, flashes with marked blur is emergency", () => {
  assert.equal(triage({ ...base, flashes: "yes" }).level, "urgent");
  assert.equal(triage({ ...base, flashes: "yes", blur: "marked" }).level, "emergency");
});
test("severe pain with redness is emergency; severe pain alone urgent", () => {
  assert.equal(triage({ ...base, pain: "severe", redness: "yes" }).level, "emergency");
  assert.equal(triage({ ...base, pain: "severe" }).level, "urgent");
});
test("contact lens with redness is urgent", () => assert.equal(triage({ ...base, history: ["contact_lens"], redness: "yes" }).level, "urgent"));
test("mild redness only is soon", () => assert.equal(triage({ ...base, redness: "yes" }).level, "soon"));
test("diabetes plus blur is at least soon", () => assert.ok(["soon", "urgent", "emergency"].includes(triage({ ...base, diabetes: "type2", blur: "mild" }).level)));
test("English free text red flags", () => {
  assert.equal(triage(base, "I suddenly lost vision in my left eye").level, "emergency");
  assert.equal(triage(base, "bleach splashed in my eye").level, "emergency");
  assert.equal(triage(base, "a curtain over my sight").level, "emergency");
  assert.equal(triage(base, "I see flashes of light").level, "urgent");
});
test("Arabic free text red flags", () => {
  assert.equal(triage(base, "فقدت البصر فجأة في العين اليمنى").level, "emergency");
  assert.equal(triage(base, "دخل كلور في عيني").level, "emergency");
  assert.equal(triage(base, "ألم شديد في العين").level, "urgent");
  assert.equal(triage(base, "أرى ومضات ضوء").level, "urgent");
  assert.equal(triage(base, "ستارة سوداء أمام عيني").level, "emergency");
});
test("negation in text does not trigger", () => {
  assert.equal(scanText("no flashes and no chemical exposure").length, 0);
  assert.equal(triage(base, "احمرار بسيط بدون ألم شديد").level, "routine");
});
test("the AI cannot lower the level (maxLevel property)", async () => {
  const { maxLevel } = await import("../src/safety.js");
  assert.equal(maxLevel("emergency", "routine"), "emergency");
  assert.equal(maxLevel("routine", "urgent"), "urgent");
});
