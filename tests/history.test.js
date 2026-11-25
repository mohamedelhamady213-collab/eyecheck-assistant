import test from "node:test";
import assert from "node:assert/strict";
import { createHistory, compare, TTL_DAYS, MAX_ENTRIES } from "../src/history.js";
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const entry = (at, u = "soon") => ({ at, summary: { eye: "right", history: ["none"] }, report: { urgency: u, image_quality: { overall: "good" } }, source: "on_device", model: "Gemini Nano", thumb: null });
test("default storage is tab-only (session), never localStorage", () => {
  const s = mem(), l = mem(); const h = createHistory({ session: s, local: l }); h.add(entry(new Date().toISOString()));
  assert.equal(h.list().length, 1); assert.equal(l._m.size, 0); assert.ok(s._m.size > 0);
});
test("persistent storage only after consent", () => {
  const s = mem(), l = mem(); const h = createHistory({ session: s, local: l }); h.add(entry(new Date().toISOString()));
  h.setPersistent(true); assert.ok(l.getItem("eyecheck.history.v2")); assert.equal(h.list().length, 1);
  h.setPersistent(false); assert.equal(l.getItem("eyecheck.history.v2"), null); assert.equal(h.list().length, 1);
});
test("delete one and clear all", () => {
  const h = createHistory({ session: mem(), local: mem() }); const a = h.add(entry(new Date().toISOString())); h.add(entry(new Date().toISOString()));
  h.remove(a); assert.equal(h.list().length, 1); h.clear(); assert.equal(h.list().length, 0);
});
test("session expiration after the TTL", () => {
  let now = Date.now(); const h = createHistory({ session: mem(), local: mem(), now: () => now });
  h.add(entry(new Date(now).toISOString())); assert.equal(h.list().length, 1);
  now += (TTL_DAYS + 1) * 86400000; assert.equal(h.list().length, 0);
});
test("corrupt storage does not crash", () => { const s = mem(); s.setItem("eyecheck.history.v2", "{{{"); assert.deepEqual(createHistory({ session: s, local: mem() }).list(), []); });
test("max entries enforced", () => { const h = createHistory({ session: mem(), local: mem() }); for (let i = 0; i < MAX_ENTRIES + 5; i++) h.add(entry(new Date().toISOString())); assert.equal(h.list().length, MAX_ENTRIES); });
test("compare flags differences without progression wording", () => {
  const rows = compare(entry("a", "urgent"), entry("b", "soon")); assert.equal(rows.find((r) => r.key === "urgency").same, false); assert.equal(rows.find((r) => r.key === "eye").same, true);
});
const DAYMS = 86400000;
test("local (persistent) store: 29-day-old kept, 31-day-old removed, boundary at the TTL", () => {
  const now = Date.now(); const l = mem(), s = mem(); l.setItem("eyecheck.persist.consent", "1");
  l.setItem("eyecheck.history.v2", JSON.stringify([entry(new Date(now - 29 * DAYMS).toISOString()), entry(new Date(now - 31 * DAYMS).toISOString()), entry(new Date(now - TTL_DAYS * DAYMS).toISOString())]));
  const h = createHistory({ session: s, local: l, now: () => now }); assert.equal(h.list().length, 1);
  assert.equal(JSON.parse(l.getItem("eyecheck.history.v2")).length, 1); // rewritten without the expired records
});
test("purgeExpired cleans both stores, drops malformed and far-future records, and removes empty keys", () => {
  const now = Date.now(); const l = mem(), s = mem();
  s.setItem("eyecheck.history.v2", JSON.stringify([entry(new Date(now - 40 * DAYMS).toISOString()), { at: "not-a-date" }, entry(new Date(now + 10 * DAYMS).toISOString())]));
  l.setItem("eyecheck.history.v2", JSON.stringify([entry(new Date(now - 35 * DAYMS).toISOString()), entry(new Date(now - DAYMS).toISOString())]));
  const h = createHistory({ session: s, local: l, now: () => now }); assert.equal(h.purgeExpired(), 4);
  assert.equal(s.getItem("eyecheck.history.v2"), null); assert.equal(JSON.parse(l.getItem("eyecheck.history.v2")).length, 1);
});
test("stored records never contain full photos, only a small thumbnail field", () => {
  const h = createHistory({ session: mem(), local: mem() }); h.add(entry(new Date().toISOString())); const e = h.list()[0];
  assert.ok(!("photos" in e) && !("dataUrl" in e) && !("thumbs" in e));
});
