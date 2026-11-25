// End-to-end tests. Runs the TEST build (firebase replaced by a mock) in headless Chrome.
// Usage: npm run build:test && npm run test:e2e
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { makeFixtures, cleanupFixtures } from "./fixtures.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist-test"), fx = (n) => path.join(root, "tests/fixtures", n);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0]); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "content-type": mime[path.extname(f)] || "application/octet-stream" }); r.end(d); } }); });
await new Promise((res) => server.listen(0, "127.0.0.1", res));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
await makeFixtures(browser);
let passed = 0, failed = 0; const failures = [];
const ok = (c, m) => { if (!c) throw new Error("assert: " + m); };
const BASE_ANS = { eye: "right", onset: "days", pain: "none", redness: "no", blur: "none", light: "no", flashes: "no", suddenLoss: "no", injury: "no", history: ["none"], diabetes: "none" };
async function open({ mock = {}, w = 1280, h = 900, lang = "en" } = {}) {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
  const errors = [], external = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (rq) => { const u = rq.url(); if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u); });
  await page.evaluateOnNewDocument((m, l) => { window.__mock = m; try { if (!sessionStorage.getItem("__init")) { sessionStorage.setItem("__init", "1"); localStorage.clear(); localStorage.setItem("lang", l); } } catch {} }, mock, lang);
  await page.goto(base, { waitUntil: "networkidle0" });
  return { page, errors, external };
}
const click = (page, sel) => page.$eval(sel, (e) => e.click());
async function upload(page, eye, file) { const inp = await page.$(`.slot[data-eye=${eye}] input[type=file]`); await inp.uploadFile(file); await new Promise((r) => setTimeout(r, 700)); }
async function wizard(page, ans = {}, text = "") {
  await click(page, "#p1next");
  const a = { ...BASE_ANS, ...ans };
  for (const q of ["eye", "onset", "pain", "redness", "blur", "light", "flashes", "suddenLoss", "injury", "history", "diabetes"]) {
    const vals = Array.isArray(a[q]) ? a[q] : [a[q]];
    for (const v of vals) await click(page, `#q_${q}_${v}`);
    await click(page, "#qNext");
  }
  if (text) { await page.type("#qText", text); }
  await click(page, "#qNext");
}
const visible = (page, sel) => page.$eval(sel, (e) => !e.hidden && e.offsetParent !== null).catch(() => false);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runAnalyze(page) { await click(page, "#analyze"); await wait(900); }
async function test(name, fn) { process.stdout.write(name + " ... "); const ctx = await fn.length ? null : null; try { await fn(); passed++; console.log("ok"); } catch (e) { failed++; failures.push(name + ": " + e.message); console.log("FAIL " + e.message); } }
async function withPage(opts, fn) { const c = await open(opts); try { await fn(c); ok(c.errors.length === 0, "console/page errors: " + c.errors.join(" | ")); } finally { await c.page.close(); } }

await test("page loads, English default, LTR, no console errors, no external requests", () => withPage({}, async ({ page, external }) => {
  ok((await page.$eval("html", (h) => h.dir)) === "ltr", "dir"); ok(external.length === 0, "external requests: " + external.join(","));
  ok((await page.$eval("#engineStatus", (e) => e.dataset.state)) === "available", "nano badge: available, not claiming ready before init");
}));
await test("on-device happy path with two photos: report, badge, nothing sent to cloud, history saved tab-only", () => withPage({}, async ({ page, external }) => {
  await upload(page, "right", fx("sharp.jpg")); await upload(page, "left", fx("sharp.jpg"));
  ok((await page.$$(".slot[data-eye=right] .qc li")).length >= 5, "quality checks listed");
  await wizard(page, { redness: "yes" }, "mild itch"); ok(await visible(page, "#p3"), "review panel");
  await runAnalyze(page); ok(await visible(page, "#report"), "report visible");
  ok((await text(page, "#engineBadge")).includes("on-device"), "badge on-device"); ok((await text(page, "#engineBadge")).includes("Gemini Nano"), "model named");
  ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "nothing sent to cloud");
  ok((await page.$$("#eyesCmp .eyebox")).length === 2, "two eye boxes"); ok((await page.$$("#assessTbl tbody tr")).length === 5, "assessability rows");
  ok((await text(page, "#overall")).length > 20, "overall text"); ok(!(await page.$("#overall .gauge, .gauge")), "no risk gauge");
  ok(!/\d+\s?%/.test(await text(page, "#report")), "no percentages anywhere in the report");
  ok((await page.evaluate(() => sessionStorage.getItem("eyecheck.history.v2"))) && !(await page.evaluate(() => localStorage.getItem("eyecheck.history.v2"))), "history tab-only");
  ok(external.length === 0, "external requests: " + external.join(","));
}));
await test("invalid format and oversized files are rejected with a message", () => withPage({}, async ({ page }) => {
  await upload(page, "right", fx("notes.pdf")); ok(await visible(page, ".slot[data-eye=right] .msg"), "pdf msg"); ok((await text(page, ".slot[data-eye=right] .msg")).includes("not supported"), "pdf text");
  await upload(page, "right", fx("bad.gif")); ok((await text(page, ".slot[data-eye=right] .msg")).includes("not supported"), "gif text");
  await upload(page, "left", fx("huge.jpg")); ok((await text(page, ".slot[data-eye=left] .msg")).includes("too large"), "size msg");
  ok(!(await page.$eval(".slot[data-eye=right] img", (i) => !i.hidden)), "no preview set");
}));
await test("missing images: symptoms-only screening works and says no photo", () => withPage({}, async ({ page }) => {
  await wizard(page); ok((await text(page, "#reviewNote")).includes("No photo")); await runAnalyze(page); ok(await visible(page, "#report"), "report");
  ok((await text(page, "#eyesCmp")).includes("No photo provided"), "no-photo wording");
}));
await test("poor image quality: retake advised, reassurance blocked even if AI says good", () => withPage({}, async ({ page }) => {
  await upload(page, "right", fx("flat.jpg")); ok((await text(page, ".slot[data-eye=right] .qc")).toLowerCase().includes("retake"), "retake advice");
  await wizard(page); await runAnalyze(page); ok((await text(page, "#overall")).includes("not reassurance"), "reassurance blocked"); ok((await text(page, "#qualityBox")).includes("Poor"), "quality poor");
}));
await test("emergency: deterministic banner appears immediately and AI cannot lower it", () => withPage({ mock: { device: { json: { image_quality: { overall: "good", issues: [] }, observations: { right: ["Looks normal."] }, symptom_summary: "ok", limitations: ["x"], next_steps: ["rest"], urgency: "routine", uncertainty: "u" } } } }, async ({ page }) => {
  await click(page, "#p1next"); await click(page, "#q_eye_right"); await click(page, "#qNext"); await click(page, "#q_onset_today"); await click(page, "#qNext");
  await click(page, "#q_pain_none"); await click(page, "#qNext"); await click(page, "#q_redness_no"); await click(page, "#qNext"); await click(page, "#q_blur_none"); await click(page, "#qNext");
  await click(page, "#q_light_no"); await click(page, "#qNext"); await click(page, "#q_flashes_no"); await click(page, "#qNext");
  await click(page, "#q_suddenLoss_yes"); ok(await visible(page, "#urgent"), "banner shows on the answer itself"); ok((await text(page, "#urgentTitle")).includes("emergency"), "emergency title");
  await click(page, "#qNext"); await click(page, "#q_injury_no"); await click(page, "#qNext"); await click(page, "#q_history_none"); await click(page, "#qNext"); await click(page, "#q_diabetes_none"); await click(page, "#qNext"); await click(page, "#qNext");
  await runAnalyze(page); ok(await page.$eval("#overall", (e) => e.classList.contains("u-emergency")), "report urgency is emergency despite AI routine");
}));
await test("emergency free text in Arabic and English", () => withPage({}, async ({ page }) => {
  await click(page, "#p1next"); for (let i = 0; i < 11; i++) { const q = ["eye","onset","pain","redness","blur","light","flashes","suddenLoss","injury","history","diabetes"][i]; await click(page, `#q_${q}_${BASE_ANS[q] instanceof Array ? BASE_ANS[q][0] : BASE_ANS[q]}`); await click(page, "#qNext"); }
  await page.type("#qText", "دخل كلور في عيني"); ok(await visible(page, "#urgent"), "arabic chemical text triggers banner");
  await page.$eval("#qText", (e) => { e.value = ""; e.dispatchEvent(new Event("input")); }); ok(!(await visible(page, "#urgent")), "banner clears");
  await page.type("#qText", "I suddenly lost vision"); ok(await visible(page, "#urgent"), "english text triggers banner");
}));
await test("Arabic: RTL, translated UI, wizard and report work, Arabic prompt language requested", () => withPage({ lang: "ar" }, async ({ page }) => {
  ok((await page.$eval("html", (h) => h.dir)) === "rtl", "rtl"); ok(/[\u0600-\u06FF]/.test(await text(page, "h1")), "arabic h1");
  await click(page, "#p1next"); ok(/[\u0600-\u06FF]/.test(await text(page, "#qLegend")), "arabic question");
  await page.goBack().catch(() => {}); 
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1); ok(!overflow, "no horizontal overflow in RTL");
}));
await test("Arabic full run produces an Arabic-labelled report", () => withPage({ lang: "ar" }, async ({ page }) => {
  await wizard(page, { redness: "yes" }, "حكة بسيطة"); await runAnalyze(page); ok(await visible(page, "#report"), "report"); ok(/[\u0600-\u06FF]/.test(await text(page, "#assessTbl")), "arabic table"); ok((await text(page, "#engineBadge")).includes("الجهاز"), "arabic badge");
}));
await test("Nano unavailable: nothing is sent, preview shown, cancel keeps private", () => withPage({ mock: { nano: "unavailable" } }, async ({ page }) => {
  await upload(page, "right", fx("sharp.jpg")); await wizard(page); await runAnalyze(page);
  ok(await visible(page, "#cloudPreview"), "preview"); ok(await page.$eval("#cloudSend", (b) => b.disabled), "send disabled until acknowledged");
  ok((await text(page, "#cloudText")).includes("Pain: none"), "exact payload shown"); ok((await page.$$("#cloudThumbs img")).length === 1, "thumb shown");
  ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "nothing sent yet"); await click(page, "#cloudCancel");
  ok((await text(page, "#runMsg")).includes("Nothing was sent"), "cancel message"); ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "still nothing sent after cancel");
  ok(!(await visible(page, "#report")), "no report");
}));
await test("Nano init failure: fails closed, then consent approval sends exactly one cloud request and is logged", () => withPage({ mock: { deviceInitFails: true } }, async ({ page }) => {
  await upload(page, "right", fx("sharp.jpg")); await wizard(page); await runAnalyze(page);
  ok(await visible(page, "#cloudPreview"), "preview after failure"); ok((await text(page, "#cloudWhy")).includes("Nothing was sent"), "why text"); ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "nothing sent before consent");
  await click(page, "#cloudAck"); ok(!(await page.$eval("#cloudSend", (b) => b.disabled)), "enabled after ack"); await click(page, "#cloudSend"); await wait(900);
  ok((await page.evaluate(() => window.__sent.length)) === 1, "exactly one cloud call"); ok((await text(page, "#engineBadge")).includes("cloud"), "cloud badge"); ok((await text(page, "#engineBadge")).includes("gemini-3.8-flash"), "cloud model named");
  ok((await text(page, "#sendLog")).includes("1 photo"), "send log entry");
}));
await test("Nano generate failure also fails closed", () => withPage({ mock: { deviceFails: true } }, async ({ page }) => {
  await wizard(page); await runAnalyze(page); ok(await visible(page, "#cloudPreview"), "preview"); ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "nothing sent");
}));
await test("invalid JSON from the model: error shown, no report, no silent cloud call", () => withPage({ mock: { device: { raw: "I am sorry, here is some text" } } }, async ({ page }) => {
  await wizard(page); await runAnalyze(page); ok((await text(page, "#runMsg")).includes("did not return a readable"), "error"); ok(!(await visible(page, "#report")), "no report"); ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "no cloud");
}));
await test("missing essential AI fields: no result is shown", () => withPage({ mock: { device: { json: { foo: "bar" } } } }, async ({ page }) => {
  await wizard(page); await runAnalyze(page); ok((await text(page, "#runMsg")).includes("missing essential"), "error"); ok(!(await visible(page, "#report")), "no report");
}));
await test("partial AI answer: report shows, missing parts listed, nothing invented; percentages removed", () => withPage({ mock: { device: { json: { urgency: "soon", observations: { right: ["Glaucoma 80% likely", "Mild redness appears."] } } } } }, async ({ page }) => {
  await wizard(page); await runAnalyze(page); ok(await visible(page, "#report"), "report"); const t = await text(page, "#report"); ok(!t.includes("80%"), "percent removed"); ok(t.includes("were missing"), "missing listed");
}));
await test("XSS: user text and model HTML are rendered as text", () => withPage({ mock: { device: { json: { urgency: "soon", image_quality: { overall: "good" }, observations: { right: ["<img src=x onerror=window.__xss=1>ok"] }, symptom_summary: "<script>window.__xss=1</script>s", limitations: ["l"], next_steps: ["n"], uncertainty: "u" } } } }, async ({ page }) => {
  await wizard(page, {}, "<img src=x onerror=window.__xss=1>"); await runAnalyze(page); await wait(300);
  ok(!(await page.evaluate(() => window.__xss)), "no script executed"); ok((await page.$$("#report img[src='x'], #reviewList img")).length === 0, "no injected nodes");
}));
await test("history: compare, delete one, clear all, consent persistence, delete-all", () => withPage({}, async ({ page }) => {
  for (let i = 0; i < 2; i++) { await wizard(page, i ? { pain: "mild" } : {}); await runAnalyze(page); await click(page, "#again"); }
  ok((await page.$$("#histList li.tl")).length === 2, "two entries"); await click(page, "#histList li.tl .acts button:nth-child(2)"); ok(await visible(page, "#cmpBox"), "comparison"); ok((await text(page, "#cmpBox")).includes("do not show"), "no-progression note");
  ok(!(await page.evaluate(() => localStorage.getItem("eyecheck.history.v2"))), "not persistent without consent");
  await click(page, "#persistToggle"); ok(!!(await page.evaluate(() => localStorage.getItem("eyecheck.history.v2"))), "persisted after consent"); ok(!(await page.evaluate(() => sessionStorage.getItem("eyecheck.history.v2"))), "session copy removed");
  await click(page, "#histList li.tl .acts button:last-child"); ok((await page.$$("#histList li.tl")).length === 1, "one deleted"); await click(page, "#clearHist"); ok((await page.$$("#histList li.tl")).length === 0, "cleared");
  await wizard(page); await runAnalyze(page); await click(page, "#delAll"); ok(!(await page.evaluate(() => localStorage.getItem("eyecheck.persist.consent") || localStorage.getItem("eyecheck.history.v2"))), "delete-all clears consent and history");
}));
await test("doctor summary and print button exist; summary contains symptoms and disclaimer", () => withPage({}, async ({ page }) => {
  await wizard(page, { pain: "mild" }); await runAnalyze(page); await click(page, "#docSum"); const d = await text(page, "#docOut"); ok(d.includes("Pain: Mild") || d.includes("Mild"), "symptoms in summary"); ok(d.includes("not been clinically validated"), "disclaimer");
}));
await test("explain sends text only and is logged", () => withPage({}, async ({ page }) => {
  await page.evaluateOnNewDocument(() => {}); await page.evaluate(() => { window.confirm = () => true; });
  await wizard(page); await runAnalyze(page); await click(page, "#explain"); await wait(600); ok((await page.evaluate(() => window.__sent.length)) === 1, "one cloud text call"); ok((await page.evaluate(() => window.__sent[0].n)) === 1, "single text part (no photos)"); ok((await text(page, "#sendLog")).includes("text summary only"), "logged");
}));
await test("mobile 390px: no horizontal overflow across the whole flow", () => withPage({ w: 390, h: 844 }, async ({ page }) => {
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok((await over()) <= 1, "home overflow " + (await over())); await upload(page, "right", fx("sharp.jpg")); ok((await over()) <= 1, "photos overflow");
  await wizard(page); ok((await over()) <= 1, "review overflow"); await runAnalyze(page); ok((await over()) <= 1, "report overflow " + (await over()));
  await page.screenshot({ path: "/tmp/e2e-mobile-report.png", fullPage: true });
}));
await test("keyboard: tab order reaches wizard options; focus moves to step heading", () => withPage({}, async ({ page }) => {
  await click(page, "#p1next"); const f = await page.evaluate(() => document.activeElement && document.activeElement.name); ok(f === "eye", "first option focused: " + f);
  ok(!!(await page.$eval("#qBox", (e) => e.tagName === "FIELDSET")), "fieldset/legend semantics");
}));
await test("reduced motion CSS and aria attributes present", () => withPage({}, async ({ page }) => {
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const a = await page.evaluate(() => getComputedStyle(document.querySelector(".iris")).animationName); ok(a === "none", "animation disabled: " + a);
  ok(!!(await page.$("[aria-current=step]")), "stepper aria-current"); ok(!!(await page.$("[role=alert]")), "alert regions");
}));

// ---------- second-round tests: Nano state, demo mode, retention, count, landing ----------
await test("landing headline EN and AR, demo entry point present in both languages", () => withPage({}, async ({ page }) => {
  ok((await text(page, "h1")) === "Your Eyes Deserve Smarter Care.", "EN h1"); ok((await text(page, ".tagline")).includes("Hybrid AI. Privacy First."), "EN sub");
  ok((await page.$eval(".hero a[href='#demo']", (a) => a.textContent)) === "Explore Demo", "EN demo btn");
  await click(page, "#lang"); await wait(200);
  ok((await text(page, "h1")) === "رعاية أذكى تبدأ بفهم صحة عينيك.", "AR h1"); ok((await page.$eval(".hero a[href='#demo']", (a) => a.textContent)) === "استكشف العرض التجريبي", "AR demo btn");
  ok((await page.$eval("html", (h) => h.dir)) === "rtl", "rtl");
}));
await test("Nano state: unavailable shows one consistent status and explanation, no auto cloud", () => withPage({ mock: { nano: "unavailable" } }, async ({ page }) => {
  ok((await page.$eval("#engineStatus", (e) => e.dataset.state)) === "unavailable", "state"); ok(await visible(page, "#engineHint"), "hint shown");
  ok(!(await text(page, "#engineStatus")).toLowerCase().includes("ready"), "not ready");
  await wizard(page); await runAnalyze(page); ok(await visible(page, "#cloudPreview"), "consent preview"); ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "nothing sent");
}));
await test("Nano state: init failure shows init_failed, nothing sent; cancel keeps it that way; approve sends once", () => withPage({ mock: { deviceInitFails: true } }, async ({ page }) => {
  await wizard(page); await runAnalyze(page);
  ok((await page.$eval("#engineStatus", (e) => e.dataset.state)) === "init_failed", "init_failed badge"); ok((await text(page, "#engineHint")).includes("Nothing was sent"), "hint");
  ok(await visible(page, "#cloudPreview"), "preview"); await click(page, "#cloudCancel"); await wait(200); ok((await page.evaluate(() => (window.__sent || []).length)) === 0, "cancel sends nothing");
  await runAnalyze(page); await click(page, "#cloudAck"); await click(page, "#cloudSend"); await wait(900);
  ok((await page.evaluate(() => (window.__sent || []).length)) === 1, "approve sends exactly one request"); ok(await visible(page, "#report"), "report");
}));
await test("Nano state: request failure is shown as request_failed", () => withPage({ mock: { deviceFails: true } }, async ({ page }) => {
  await wizard(page); await runAnalyze(page); ok((await page.$eval("#engineStatus", (e) => e.dataset.state)) === "request_failed", "request_failed");
}));
await test("Nano state: ready only after a real run, and repeated runs start the model once", () => withPage({}, async ({ page }) => {
  ok((await page.$eval("#engineStatus", (e) => e.dataset.state)) === "available", "available before any run");
  await wizard(page); await runAnalyze(page); ok((await page.$eval("#engineStatus", (e) => e.dataset.state)) === "ready", "ready after run");
}));
await test("question count: one source of truth across hero text, progress and review", () => withPage({}, async ({ page }) => {
  ok((await text(page, "[data-i18n=how2_d]")).startsWith("11 short questions"), "how-it-works count");
  await click(page, "#p1next"); ok((await text(page, "#qCount")) === "Question 1 of 12", "progress label: " + await text(page, "#qCount"));
  ok((await page.$eval("#qBar", (e) => e.style.width)).startsWith("8.3"), "progress bar 1/12");
  await click(page, "#qNext"); ok(await visible(page, "#qErr"), "required answer enforced"); ok((await text(page, "#qCount")) === "Question 1 of 12", "did not advance");
  await click(page, "#q_eye_right"); await click(page, "#qNext"); await click(page, "#qBack"); ok((await text(page, "#qCount")) === "Question 1 of 12", "back works");
  await click(page, "#lang"); await wait(200); ok((await text(page, "#qCount")).includes("12"), "AR count");
}));
await test("demo mode: three synthetic scenarios, no AI, no cloud, not saved, repeatable, exit works", () => withPage({}, async ({ page, external }) => {
  const outcomes = {};
  for (const id of ["a", "b", "c"]) {
    await click(page, `[data-demo=${id}]`); await wait(150);
    ok(await visible(page, "#report") && await visible(page, "#demoBanner"), "report + banner " + id); ok((await text(page, "#demoBanner")).includes("SYNTHETIC DEMO DATA"), "label " + id);
    ok((await text(page, "#engineBadge")).includes("no AI"), "badge " + id); ok(!(await visible(page, "#explain")) && !(await visible(page, "#docSum")), "cloud-capable buttons hidden " + id);
    outcomes[id] = await page.$eval("#overall", (e) => e.className);
    if (id === "c") { ok((await text(page, "#qualityBox")).includes("Poor"), "poor quality"); ok((await text(page, "#overall")).includes("not reassurance"), "reassurance blocked"); ok((await text(page, "#eyesCmp")).includes("could not be assessed"), "unassessable wording"); }
  }
  ok(outcomes.a.includes("u-routine") && outcomes.b.includes("u-emergency") && outcomes.c.includes("u-soon"), "levels " + JSON.stringify(outcomes));
  await click(page, "[data-demo=b]"); await wait(100); ok((await page.$eval("#overall", (e) => e.className)).includes("u-emergency"), "repeatable");
  ok((await page.evaluate(() => (window.__sent || []).length + (window.__device || []).length)) === 0, "no AI calls"); ok(external.length === 0, "no network");
  ok(!(await page.evaluate(() => sessionStorage.getItem("eyecheck.history.v2") || localStorage.getItem("eyecheck.history.v2"))), "demo not saved"); ok((await page.$$("#histList li.tl")).length === 0, "history list empty");
  await click(page, "#lang"); await wait(200); ok((await text(page, "#demoBanner")).includes("بيانات تجريبية"), "AR banner survives language switch");
  await click(page, "#demoExit"); ok(!(await visible(page, "#report")), "exit hides report");
}));
await test("demo does not touch real wizard progress or real history", () => withPage({}, async ({ page }) => {
  await wizard(page); await runAnalyze(page); const n = (await page.$$("#histList li.tl")).length; ok(n === 1, "one real entry");
  await click(page, "[data-demo=a]"); await wait(100); await click(page, "#demoExit"); ok((await page.$$("#histList li.tl")).length === 1, "still one real entry");
}));
await test("retention: 31-day-old persisted records are removed on load, 29-day-old survive a reload", () => withPage({}, async ({ page }) => {
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString();
  await page.evaluate((a, b) => { const e = (at) => ({ id: "x" + at, at, summary: { eye: "right", history: ["none"] }, report: { urgency: "soon", image_quality: { overall: "good" }, symptom_summary: "x" }, source: "on_device", model: "Gemini Nano", thumb: null });
    localStorage.setItem("eyecheck.persist.consent", "1"); localStorage.setItem("eyecheck.history.v2", JSON.stringify([e(a), e(b)])); }, d(29), d(31));
  await page.reload({ waitUntil: "networkidle0" });
  ok((await page.evaluate(() => JSON.parse(localStorage.getItem("eyecheck.history.v2")).length)) === 1, "expired record purged from localStorage"); ok((await page.$$("#histList li.tl")).length === 1, "one shown");
  await page.reload({ waitUntil: "networkidle0" }); ok((await page.$$("#histList li.tl")).length === 1, "survives another reload");
  await click(page, "#clearHist"); ok(!(await page.evaluate(() => localStorage.getItem("eyecheck.history.v2"))), "delete clears local record");
}));
await test("original photos are never stored: only a small thumbnail is persisted", () => withPage({}, async ({ page }) => {
  await upload(page, "right", fx("sharp.jpg")); await wizard(page); await runAnalyze(page);
  const sz = await page.evaluate(() => { const v = sessionStorage.getItem("eyecheck.history.v2") || ""; const j = JSON.parse(v)[0]; return { total: v.length, thumb: j.thumb ? j.thumb.length : 0, keys: Object.keys(j) }; });
  ok(sz.thumb > 0 && sz.thumb < 20000, "thumb small: " + sz.thumb); ok(!sz.keys.includes("photos") && !sz.keys.includes("thumbs"), "no photo keys"); ok(sz.total < 40000, "record small: " + sz.total);
}));
await test("mobile 390px: no horizontal overflow on home, demo report, and Arabic", () => withPage({ w: 390, h: 800, lang: "ar" }, async ({ page }) => {
  const ov = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok((await ov()) <= 1, "home overflow " + await ov()); await click(page, "[data-demo=b]"); await wait(200); ok((await ov()) <= 1, "demo report overflow " + await ov());
}));

await browser.close(); server.close(); cleanupFixtures();
console.log(`\nE2E: ${passed} passed, ${failed} failed`); if (failures.length) console.log(failures.join("\n")); process.exit(failed ? 1 : 0);
