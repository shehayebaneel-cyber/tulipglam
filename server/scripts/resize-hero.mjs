/**
 * Produce phone- and tablet-sized versions of the hero photograph.
 *
 *     node scripts/resize-hero.mjs
 *
 * ── WHY THIS USES A BROWSER ────────────────────────────────────────────────────────
 *
 * There is no `sharp`, no ImageMagick and no `pg_dump` on this machine, and adding a native
 * image dependency is a thing the owner would then have to maintain. Chrome is installed and
 * can decode a webp, draw it to a canvas at any size, and re-encode — which is all this needs.
 * It is a slightly odd tool for the job and it produces a correct result with zero new
 * dependencies.
 *
 * ── WHY IT MATTERS ─────────────────────────────────────────────────────────────────
 *
 * The hero is the Largest Contentful Paint element on the homepage: the single image that
 * decides when the store LOOKS loaded. It ships at 1536px wide and 230 KB, to a phone showing
 * it 390 CSS pixels across. On mobile data that is most of a second spent on detail nobody can
 * see. The srcset written by this script lets a phone take the phone-sized file.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9500;
const PUBLIC = path.resolve("../web/public");
const SOURCES = ["hero/hero-tulipglam-lilac.webp", "hero/hero-tulipglam.webp"];
/** 780 covers a 390px phone at 2x — the primary viewport. 1200 covers tablets and small laptops. */
const WIDTHS = [780, 1200];
const QUALITY = 0.82;

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  `--user-data-dir=${path.join(os.tmpdir(), "tg-resize")}`,
  `--remote-debugging-port=${PORT}`, `--allow-file-access-from-files`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
const rpc = (ws, method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const mine = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== mine) return;
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(method + ": " + m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id: mine, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

try {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; }
    catch { await sleep(250); }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  const { targetId } = await rpc(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc(ws, "Target.attachToTarget", { targetId, flatten: true });
  const call = (m, p) => rpc(ws, m, p, sessionId);
  await call("Runtime.enable");

  for (const rel of SOURCES) {
    const src = path.join(PUBLIC, rel);
    if (!fs.existsSync(src)) { console.log(`  ! missing ${rel}`); continue; }
    const b64 = fs.readFileSync(src).toString("base64");
    const original = fs.statSync(src).size;
    console.log(`\n  ${rel}  ${(original / 1024).toFixed(0)} KB`);

    for (const w of WIDTHS) {
      // Decode, draw at the target width, re-encode. Done inside the page so Chrome's own
      // webp encoder does the work.
      const expr = `(async () => {
        const img = new Image();
        img.src = "data:image/webp;base64,${b64}";
        await img.decode();
        const scale = ${w} / img.naturalWidth;
        if (scale >= 1) return JSON.stringify({ skipped: true, natural: img.naturalWidth });
        const c = document.createElement("canvas");
        c.width = ${w};
        c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return JSON.stringify({ data: c.toDataURL("image/webp", ${QUALITY}), w: c.width, h: c.height, natural: img.naturalWidth });
      })()`;
      const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      const out = JSON.parse(res.result.value);
      if (out.skipped) { console.log(`    ${w}px  skipped — source is only ${out.natural}px wide`); continue; }

      const buf = Buffer.from(out.data.split(",")[1], "base64");
      const dest = src.replace(/\.webp$/, `-${w}.webp`);
      fs.writeFileSync(dest, buf);
      console.log(`    ${String(w).padStart(4)}px  ${(buf.length / 1024).toFixed(0).padStart(4)} KB  (${(100 - (buf.length / original) * 100).toFixed(0)}% smaller)  ${path.basename(dest)}`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
}
