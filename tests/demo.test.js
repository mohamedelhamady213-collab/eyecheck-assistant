import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEMOS, demoContext } from "../src/demo.js";
import { triage } from "../src/safety.js";
import { EN, AR, t, setLang } from "../src/i18n.js";
import { QUESTIONS, QUESTION_COUNT, TOTAL_STEPS } from "../src/symptoms.js";
test("demo scenarios: deterministic triage levels (no AI involved)", () => {
  assert.equal(demoContext("a", t, triage).report.urgency, "routine");
  assert.equal(demoContext("b", t, triage).report.urgency, "emergency");
  assert.equal(demoContext("c", t, triage).report.urgency, "soon");
  assert.equal(demoContext("zzz", t, triage), null);
});
test("demo contexts are labelled demo, hold no AI output and block reassurance for B and C", () => {
  for (const id of Object.keys(DEMOS)) { const c = demoContext(id, t, triage); assert.equal(c.source, "demo"); assert.equal(c.report.ai_urgency, null); assert.deepEqual(c.report.observations, {}); }
  assert.equal(demoContext("c", t, triage).report.image_quality.overall, "poor"); assert.equal(demoContext("c", t, triage).report.reassurance_blocked, true);
});
test("demo is repeatable (same inputs, same outcome)", () => { assert.equal(demoContext("b", t, triage).report.urgency, demoContext("b", t, triage).report.urgency); });
test("demo strings exist in both languages and demo.js has no network or storage code", () => {
  for (const k of Object.keys(EN).filter((k) => k.startsWith("demo_"))) assert.ok(k in AR, k);
  const src = fs.readFileSync(new URL("../src/demo.js", import.meta.url), "utf8"); assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /fetch|XMLHttp|localStorage|sessionStorage|firebase/i);
});
test("question count has one source of truth", () => {
  assert.equal(QUESTION_COUNT, QUESTIONS.length); assert.equal(TOTAL_STEPS, QUESTIONS.length + 1);
  for (const l of ["en", "ar"]) { setLang(l); assert.ok(t("how2_d").includes(String(QUESTION_COUNT)), l); assert.doesNotMatch(t("how2_d"), /\{questions\}/); }
  setLang("en");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"); assert.doesNotMatch(html, /\b(eleven|twelve)\b/i);
  assert.doesNotMatch(EN.how2_d + EN.hist_persist, /\b(eleven|twelve|30)\b/);
});
test("landing headline copy", () => {
  assert.equal(EN.hero_h1a, "Your Eyes Deserve Smarter Care."); assert.equal(EN.hero_sub, "Hybrid AI. Privacy First. Smarter Eye Health Guidance.");
  assert.equal(AR.hero_h1a, "رعاية أذكى تبدأ بفهم صحة عينيك."); assert.equal(AR.hero_sub, "ذكاء اصطناعي محلي، خصوصية أولًا، وتوجيه صحي أكثر وعيًا.");
});
