// Image checks that run entirely in the browser. They are heuristics about the PHOTO, not about the eye,
// and they say nothing about medical accuracy.
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_BYTES = 15 * 1024 * 1024;
export const MIN_SIDE = 480;
export const OUT_MAX = 1024;

export function checkFile(file) {
  if (!file) return { ok: false, code: "missing" };
  if (!ALLOWED_TYPES.includes(file.type)) return { ok: false, code: "format" };
  if (file.size > MAX_BYTES) return { ok: false, code: "too_big" };
  if (file.size === 0) return { ok: false, code: "empty" };
  return { ok: true };
}
export function scaleSize(w, h, max = OUT_MAX) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// data: RGBA Uint8ClampedArray of an image already scaled to analysis size (e.g. <= 256px).
export function lumaStats({ width, height, data }) {
  const n = width * height, g = new Float32Array(n);
  let sum = 0, dark = 0, bright = 0, glare = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    g[i] = y; sum += y;
    if (y < 40) dark++;
    if (y > 245) glare++;
    if (y > 225) bright++;
  }
  return { gray: g, mean: sum / n, darkFrac: dark / n, brightFrac: bright / n, glareFrac: glare / n };
}
// Variance of the Laplacian: low values mean few edges (blur). Thresholds are heuristic.
export function laplacianVariance(gray, width, height) {
  let s = 0, s2 = 0, c = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
    s += v; s2 += v * v; c++;
  }
  if (!c) return 0;
  const m = s / c; return s2 / c - m * m;
}
export const THRESH = { blurPoor: 25, blurWarn: 60, dark: 55, darkPoor: 35, bright: 205, glareWarn: 0.04, glarePoor: 0.12 };

// meta: { naturalWidth, naturalHeight, rgba:{width,height,data}, face?: "found"|"none"|"unavailable" }
export function assess(meta) {
  const checks = [];
  const side = Math.min(meta.naturalWidth, meta.naturalHeight);
  checks.push({ id: "resolution", status: side >= MIN_SIDE ? "ok" : side >= 320 ? "warn" : "poor", value: side });
  const st = lumaStats(meta.rgba);
  const lv = laplacianVariance(st.gray, meta.rgba.width, meta.rgba.height);
  checks.push({ id: "sharpness", status: lv < THRESH.blurPoor ? "poor" : lv < THRESH.blurWarn ? "warn" : "ok", value: Math.round(lv) });
  checks.push({ id: "lighting", status: st.mean < THRESH.darkPoor ? "poor" : st.mean < THRESH.dark ? "warn" : st.mean > THRESH.bright ? "warn" : "ok", value: Math.round(st.mean) });
  checks.push({ id: "glare", status: st.glareFrac > THRESH.glarePoor ? "poor" : st.glareFrac > THRESH.glareWarn ? "warn" : "ok", value: Math.round(st.glareFrac * 100) });
  checks.push({ id: "eye_region", status: meta.face === "found" ? "ok" : meta.face === "none" ? "warn" : "info", value: meta.face || "unavailable" });
  const poor = checks.some((c) => c.status === "poor");
  const warn = checks.some((c) => c.status === "warn");
  return { overall: poor ? "poor" : warn ? "fair" : "good", retake: poor || warn, checks };
}
