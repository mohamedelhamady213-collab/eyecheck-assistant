import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import puppeteer from "puppeteer-core"; import { makeFixtures, cleanupFixtures } from "./fixtures.mjs";
const dist = path.resolve("dist-test"), fx = (n) => path.resolve("tests/fixtures", n), out = process.argv[2] || "/tmp/shots";
fs.mkdirSync(out, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0]); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "content-type": mime[path.extname(f)] || "x/y" }); r.end(d); } }); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}/`;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
await makeFixtures(b);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(tag, { w, h, lang, theme }) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h });
  await p.evaluateOnNewDocument((l, t) => { localStorage.setItem("lang", l); localStorage.setItem("theme", t); }, lang, theme);
  await p.goto(base, { waitUntil: "networkidle0" });
  const click = (s) => p.$eval(s, (e) => e.click());
  await p.screenshot({ path: `${out}/${tag}-1-home.png` });
  await (await p.$(".slot[data-eye=right] input[type=file]")).uploadFile(fx("sharp.jpg")); await wait(600);
  await p.$eval("#scan", (e) => e.scrollIntoView()); await p.screenshot({ path: `${out}/${tag}-2-photos.png` });
  await click("#p1next"); await click("#q_eye_right"); await p.$eval("#scan", (e) => e.scrollIntoView()); await p.screenshot({ path: `${out}/${tag}-3-wizard.png` });
  for (const q of ["eye","onset","pain","redness","blur","light","flashes","suddenLoss","injury","history","diabetes"]) { const v = { eye: "right", onset: "days", pain: "mild", redness: "yes", blur: "mild", light: "no", flashes: "no", suddenLoss: "no", injury: "no", history: "contact_lens", diabetes: "none" }[q]; await click(`#q_${q}_${v}`); await click("#qNext"); }
  await click("#qNext"); await click("#analyze"); await wait(900);
  await p.$eval("#report", (e) => e.scrollIntoView()); await p.screenshot({ path: `${out}/${tag}-4-report.png`, fullPage: false });
  await p.screenshot({ path: `${out}/${tag}-5-reportfull.png`, fullPage: true, clip: undefined });
  await p.close();
}
await run("desk-en", { w: 1280, h: 800, lang: "en", theme: "light" });
await run("mob-ar-dark", { w: 390, h: 800, lang: "ar", theme: "dark" });
await b.close(); srv.close(); cleanupFixtures();
