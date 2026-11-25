import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import puppeteer from "puppeteer-core";
const dist = path.resolve("dist-test");
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0]); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, {"content-type": f.endsWith(".js")?"text/javascript":f.endsWith(".css")?"text/css":"text/html"}); r.end(d); } }); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}/`;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(tag, w, h, lang, theme, fn) { const p = await b.newPage(); await p.setViewport({ width: w, height: h }); await p.evaluateOnNewDocument((l, t) => { localStorage.setItem("lang", l); localStorage.setItem("theme", t); }, lang, theme); await p.goto(base, { waitUntil: "networkidle0" }); await fn(p); await wait(500); await p.screenshot({ path: `/downloads/shots/${tag}.png` }); await p.close(); }
const c = (p, s) => p.$eval(s, (e) => e.click());
await shot("r2-desk-en-home", 1280, 800, "en", "light", async () => {});
await shot("r2-desk-en-demo-urgent", 1280, 900, "en", "light", async (p) => { await c(p, "[data-demo=b]"); await wait(600); await p.$eval("#report", (e) => e.scrollIntoView()); });
await shot("r2-mob-ar-home", 390, 800, "ar", "dark", async () => {});
await shot("r2-mob-ar-demo-unassessable", 390, 800, "ar", "dark", async (p) => { await c(p, "[data-demo=c]"); await wait(600); await p.$eval("#report", (e) => e.scrollIntoView()); });
await shot("r2-desk-en-demo-picker", 1280, 700, "en", "light", async (p) => { await p.$eval("#demo", (e) => e.scrollIntoView()); });
await b.close(); srv.close();
