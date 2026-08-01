/**
 * Measure the storefront the way a Lebanese customer meets it.
 *
 *     node scripts/perf.mjs http://localhost:5330/
 *
 * Drives Chrome over the DevTools protocol at a 390px viewport with the network throttled to
 * something like a mid-range phone on mobile data: 1.6 Mbps down, 150 ms round trip. Reports
 * First Contentful Paint, Largest Contentful Paint, total bytes, and the heaviest requests —
 * because on that connection the number that decides how the shop FEELS is bytes before paint.
 *
 * No dependencies: Node 22+ ships a global WebSocket.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const url = process.argv[2] ?? "http://localhost:5330/";
const LABEL = process.argv[3] ?? "";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9400 + Math.floor(Math.random() * 90);

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  `--user-data-dir=${path.join(os.tmpdir(), `tg-perf-${PORT}`)}`,
  `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "about:blank",
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

  await call("Page.enable");
  await call("Network.enable");
  await call("Performance.enable");

  // A mid-range Android on Lebanese mobile data, not a laptop on fibre.
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setCPUThrottlingRate", { rate: 4 });
  await call("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  await call("Network.setCacheDisabled", { cacheDisabled: true }); // first visit is what matters

  const requests = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.responseReceived") {
      requests.set(m.params.requestId, { url: m.params.response.url, type: m.params.type, bytes: 0 });
    }
    if (m.method === "Network.loadingFinished") {
      const r = requests.get(m.params.requestId);
      if (r) r.bytes = m.params.encodedDataLength;
    }
  });

  const t0 = Date.now();
  await call("Page.navigate", { url });
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 45000);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === "Page.loadEventFired") { ws.removeEventListener("message", onMsg); clearTimeout(t); resolve(); }
    };
    ws.addEventListener("message", onMsg);
  });
  await sleep(3000); // let the SPA fetch /api/site and paint its first real content

  const paints = JSON.parse((await call("Runtime.evaluate", {
    expression: `JSON.stringify({
      fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime || null,
      lcp: (performance.getEntriesByType('largest-contentful-paint').pop()||{}).startTime || null,
      dcl: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
      load: performance.timing.loadEventEnd - performance.timing.navigationStart
    })`, returnByValue: true,
  })).result.value);

  const all = [...requests.values()];
  const total = all.reduce((n, r) => n + r.bytes, 0);
  const byType = {};
  for (const r of all) byType[r.type] = (byType[r.type] ?? 0) + r.bytes;

  const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
  const ms = (v) => (v === null ? "—" : `${Math.round(v)} ms`);

  console.log(`\n═══ ${LABEL || url} ═══`);
  console.log(`  390px · 4x CPU throttle · 1.6 Mbps / 150 ms RTT · cold cache\n`);
  console.log(`  First contentful paint .... ${ms(paints.fcp)}`);
  console.log(`  Largest contentful paint .. ${ms(paints.lcp)}`);
  console.log(`  DOM content loaded ........ ${paints.dcl} ms`);
  console.log(`  Load event ................ ${paints.load} ms`);
  console.log(`  Wall clock to settle ...... ${Date.now() - t0} ms\n`);
  console.log(`  Total transferred ......... ${kb(total)} across ${all.length} requests`);
  for (const [t, b] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(12)} ${kb(b).padStart(9)}`);
  }
  console.log(`\n  Heaviest requests:`);
  for (const r of all.sort((a, b) => b.bytes - a.bytes).slice(0, 8)) {
    console.log(`    ${kb(r.bytes).padStart(9)}  ${r.url.replace(/^https?:\/\//, "").slice(0, 72)}`);
  }
  const thirdParty = all.filter((r) => !r.url.includes("localhost") && !r.url.startsWith("data:") && !r.url.includes("tulipglam.com"));
  console.log(`\n  Third-party requests ...... ${thirdParty.length}${thirdParty.length ? " (" + [...new Set(thirdParty.map((r) => new URL(r.url).host))].join(", ") + ")" : ""}`);
  console.log();
  ws.close();
} finally {
  chrome.kill();
}
