import test from "node:test";
import assert from "node:assert/strict";
import { createNanoManager, NANO, NanoBusyError } from "../src/nanostate.js";
import { runScreening, runCloudWithConsent, AiError } from "../src/ai.js";
const mk = (o = {}) => { const c = { init: 0, gen: 0 }; const m = createNanoManager({
  availability: async () => o.avail || "available",
  init: async () => { c.init++; if (o.initFails) throw new Error("init boom"); if (o.noInit) return false; await new Promise((r) => setTimeout(r, 5)); return true; },
  generate: async () => { c.gen++; if (o.genFails) throw new Error("gen boom"); await new Promise((r) => setTimeout(r, 5)); return "{}"; } }); return { m, c }; };
test("supported device: available, then READY only after init", async () => {
  const { m } = mk(); assert.equal(m.get().state, NANO.CHECKING);
  await m.check(); assert.equal(m.get().state, NANO.AVAILABLE);
  await m.ensureInit(); assert.equal(m.get().state, NANO.READY);
});
test("unsupported device: unavailable, run refuses", async () => {
  const { m, c } = mk({ avail: "unavailable" }); await m.check(); assert.equal(m.get().state, NANO.UNAVAILABLE);
  await assert.rejects(m.run([]), /not available/); assert.equal(c.init, 0);
});
test("initialization failure is surfaced and retryable", async () => {
  const { m } = mk({ initFails: true }); await m.check();
  await assert.rejects(m.run([]), /init boom`?/); assert.equal(m.get().state, NANO.INIT_FAILED); assert.equal(m.get().detail, "init boom");
  await assert.rejects(m.run([])); assert.equal(m.initCalls, 2);
});
test("repeated initialization starts the model once", async () => {
  const { m, c } = mk(); await m.check(); await Promise.all([m.ensureInit(), m.ensureInit(), m.ensureInit()]); await m.ensureInit();
  assert.equal(c.init, 1); assert.equal(m.get().state, NANO.READY);
});
test("duplicate requests are rejected while one is running", async () => {
  const { m, c } = mk(); await m.check(); const p = m.run([]); await assert.rejects(m.run([]), NanoBusyError); await p; assert.equal(c.gen, 1);
});
test("interrupted processing ends in request_failed, then can recover", async () => {
  const bad = mk({ genFails: true }); await bad.m.check(); await assert.rejects(bad.m.run([]), /gen boom/); assert.equal(bad.m.get().state, NANO.REQUEST_FAILED); assert.equal(bad.m.busy, false);
});
test("never READY when the SDK has no init step until a request works", async () => {
  const { m } = mk({ noInit: true }); await m.check(); await m.ensureInit(); assert.equal(m.get().state, NANO.AVAILABLE);
  await m.run([]); assert.equal(m.get().state, NANO.READY);
});
test("state is broadcast to every subscriber (single source of truth)", async () => {
  const { m } = mk(); const a = [], b = []; m.subscribe((s) => a.push(s.state)); m.subscribe((s) => b.push(s.state)); await m.check(); await m.run([]);
  assert.deepEqual(a, b); assert.deepEqual(a, ["available", "initializing", "ready", "processing", "ready"]);
});
test("no silent cloud fallback: Nano failure raises, cloud engine never called", async () => {
  let cloud = 0; const { m } = mk({ initFails: true }); await m.check();
  const engines = { nanoState: async () => m.check(), runDevice: (p, o) => m.run(p, o), runCloud: async () => { cloud++; return { text: "{}", model: "x" }; } };
  await assert.rejects(runScreening({ input: { parts: [] }, engines }), (e) => e instanceof AiError && e.code === "nano_failed"); assert.equal(cloud, 0);
});
test("cloud only with explicit consent (cancel = no call, approve = one call)", async () => {
  let cloud = 0; const engines = { runCloud: async () => { cloud++; return { text: '{"urgency":"soon"}', model: "m" }; } };
  await assert.rejects(runCloudWithConsent({ input: { parts: [] }, engines, consent: null }), (e) => e.code === "no_consent");
  await assert.rejects(runCloudWithConsent({ input: { parts: [] }, engines, consent: { granted: false, preview: true } }), (e) => e.code === "no_consent"); assert.equal(cloud, 0);
  await runCloudWithConsent({ input: { parts: [] }, engines, consent: { granted: true, preview: true } }); assert.equal(cloud, 1);
});
