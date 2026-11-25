import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EN, AR } from "../src/i18n.js";
import { QUESTIONS } from "../src/symptoms.js";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = ["main.js", "report.js"].map((f) => fs.readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");
test("EN and AR have identical keys", () => { assert.deepEqual(Object.keys(EN).sort(), Object.keys(AR).sort()); });
test("no empty translations", () => { for (const [k, v] of Object.entries(AR)) assert.ok(v && v.length, k); });
test("every data-i18n key in index.html exists", () => {
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]); const attr = [...html.matchAll(/data-i18n-attr="[^:]+:([^"]+)"/g)].map((m) => m[1]);
  for (const k of [...keys, ...attr]) assert.ok(k in EN, "missing " + k);
});
test("every literal t('key') in code exists", () => {
  for (const m of src.matchAll(/\bt\("([a-z_A-Z0-9]+)"\s*[,)]/g)) assert.ok(m[1] in EN, "missing " + m[1]);
});
test("question labels and options are translated", () => {
  for (const q of QUESTIONS) { assert.ok(("q_" + q.id) in EN && ("q_" + q.id) in AR); for (const o of q.options) assert.ok(`qo_${q.id}_${o}` in AR, `qo_${q.id}_${o}`); }
});
test("urgency + safety rule texts exist in Arabic", async () => {
  for (const l of ["routine", "soon", "urgent", "emergency"]) for (const s of ["_t", "_d", ""]) assert.ok(("urg_" + l + s) in AR);
  const safety = fs.readFileSync(new URL("../src/safety.js", import.meta.url), "utf8");
  for (const m of safety.matchAll(/"([rt]_[a-z_]+)"/g)) assert.ok(("why_" + m[1]) in AR, "why_" + m[1]);
});
test("Arabic strings contain Arabic script", () => { for (const k of ["hero_lead", "disc", "q_eye", "priv_cloud"]) assert.match(AR[k], /[\u0600-\u06FF]/); });
test("no external hosts / tracking in index.html except GitHub link", () => {
  const urls = [...html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "").matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]).filter((u) => !u.includes("w3.org"));
  for (const u of urls) assert.ok(u.startsWith("https://github.com/mohamedelhamady213-collab"), u);
});
