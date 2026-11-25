// Generates synthetic test images (no real eye photos, no binaries in git).
import fs from "node:fs"; import path from "node:path";
export const FX_DIR = path.resolve("tests/fixtures");
export async function makeFixtures(browser) {
  fs.mkdirSync(FX_DIR, { recursive: true });
  const page = await browser.newPage();
  const mk = (kind) => page.evaluate((kind) => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 900; const x = c.getContext("2d");
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    if (kind === "sharp") { for (let i = 0; i < 60; i++) for (let j = 0; j < 45; j++) { x.fillStyle = `hsl(25,${30 + rnd() * 20}%,${55 + rnd() * 30}%)`; x.fillRect(i * 20, j * 20, 20, 20); }
      x.fillStyle = "#fff"; x.beginPath(); x.ellipse(600, 450, 330, 150, 0, 0, 7); x.fill(); x.fillStyle = "#2b5d8a"; x.beginPath(); x.arc(600, 450, 110, 0, 7); x.fill(); x.fillStyle = "#050a10"; x.beginPath(); x.arc(600, 450, 45, 0, 7); x.fill();
      for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${rnd() * 255 | 0},${rnd() * 255 | 0},${rnd() * 255 | 0},.35)`; x.fillRect(rnd() * 1200, rnd() * 900, 3, 3); } }
    if (kind === "flat") { const g = x.createLinearGradient(0, 0, 0, 900); g.addColorStop(0, "#777"); g.addColorStop(1, "#888"); x.fillStyle = g; x.fillRect(0, 0, 1200, 900); }
    return c.toDataURL("image/jpeg", 0.9);
  }, kind);
  for (const k of ["sharp", "flat"]) fs.writeFileSync(path.join(FX_DIR, k + ".jpg"), Buffer.from((await mk(k)).split(",")[1], "base64"));
  await page.close();
  fs.writeFileSync(path.join(FX_DIR, "notes.pdf"), "%PDF-1.4 not an image");
  fs.writeFileSync(path.join(FX_DIR, "bad.gif"), Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"));
  fs.writeFileSync(path.join(FX_DIR, "huge.jpg"), Buffer.alloc(16_500_000, 1));
}
export const cleanupFixtures = () => fs.rmSync(FX_DIR, { recursive: true, force: true });
