import test from "node:test";
import assert from "node:assert/strict";
import { checkFile, assess, scaleSize, laplacianVariance, lumaStats } from "../src/imagequality.js";
const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return { width: w, height: h, data: d }; };
test("file validation: formats, size, empty, missing", () => {
  assert.equal(checkFile({ type: "image/jpeg", size: 1000 }).ok, true);
  assert.equal(checkFile({ type: "application/pdf", size: 1000 }).code, "format");
  assert.equal(checkFile({ type: "image/gif", size: 1000 }).code, "format");
  assert.equal(checkFile({ type: "image/png", size: 16 * 1024 * 1024 }).code, "too_big");
  assert.equal(checkFile({ type: "image/png", size: 0 }).code, "empty");
  assert.equal(checkFile(null).code, "missing");
});
test("scaleSize keeps aspect ratio and never upscales", () => {
  assert.deepEqual(scaleSize(4000, 2000), { w: 1024, h: 512 }); assert.deepEqual(scaleSize(500, 400), { w: 500, h: 400 });
});
const sharp = img(128, 128, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 200 : 60);
const flat = img(128, 128, () => 120);
test("flat image is flagged as blurry, textured one is sharp", () => {
  const a = assess({ naturalWidth: 1200, naturalHeight: 900, rgba: flat }), b = assess({ naturalWidth: 1200, naturalHeight: 900, rgba: sharp });
  assert.equal(a.checks.find((c) => c.id === "sharpness").status, "poor"); assert.equal(b.checks.find((c) => c.id === "sharpness").status, "ok");
  assert.equal(a.overall, "poor"); assert.equal(a.retake, true);
});
test("dark and overexposed images are flagged", () => {
  const dark = assess({ naturalWidth: 1200, naturalHeight: 900, rgba: img(128, 128, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? 30 : 10)) });
  assert.equal(dark.checks.find((c) => c.id === "lighting").status, "poor");
  const glare = assess({ naturalWidth: 1200, naturalHeight: 900, rgba: img(128, 128, (x) => (x < 40 ? 255 : 100 + (x % 7) * 20)) });
  assert.notEqual(glare.checks.find((c) => c.id === "glare").status, "ok");
});
test("low resolution is flagged and eye-region check is info when unavailable", () => {
  const r = assess({ naturalWidth: 200, naturalHeight: 150, rgba: sharp }); assert.equal(r.checks.find((c) => c.id === "resolution").status, "poor");
  assert.equal(r.checks.find((c) => c.id === "eye_region").status, "info");
});
test("good photo is not marked as medically accurate (only 'good' photo quality)", () => {
  const r = assess({ naturalWidth: 1200, naturalHeight: 900, rgba: sharp, face: "found" }); assert.equal(r.overall, "good"); assert.equal(r.retake, false);
});
