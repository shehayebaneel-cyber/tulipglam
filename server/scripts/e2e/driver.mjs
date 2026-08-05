/**
 * A browser, driven over CDP, plus a disposable store to point it at.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * Every suite in this repo asserts against functions or HTTP. None of them has ever pressed the
 * button. The bugs that reached the owner were exactly the ones that only exist in a browser: a
 * mobile drawer 93px tall because `backdrop-filter` made the header a containing block, an Edit
 * column off-screen at every laptop width, a dropdown opening into the taskbar. A typecheck
 * cannot see any of them.
 *
 * ── WHY IT BUILDS ITS OWN DATABASE ─────────────────────────────────────────────────
 *
 * This suite PLACES ORDERS. The production database is shared with localhost, so a suite that
 * checks out against the default connection string would put test orders in the owner's real
 * order list — which has happened once already in this project, via a stray curl.
 *
 * So it refuses to use the ambient DATABASE_URL. It requires a local Postgres and its own
 * database, starts its own API server against it, and tears both down. There is no flag to make
 * it run against anything else, because that flag would eventually get used.
 *
 * ── SKIPPED, NEVER GREEN ───────────────────────────────────────────────────────────
 *
 * Chrome missing, local Postgres missing, or web/dist missing → the suite reports SKIPPED with
 * the reason. It never reports a pass for a browser that did not open. `test-all.mjs` treats a
 * missing summary line as a failure, so a crash cannot masquerade as a skip either.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(HERE, "..", "..");
export const WEB_DIST = path.resolve(SERVER_DIR, "..", "web", "dist");

/** The local cluster this suite requires. Never production, and deliberately not configurable. */
export const LOCAL_PG = {
  host: "127.0.0.1",
  port: Number(process.env.E2E_PG_PORT || 5433),
  user: process.env.E2E_PG_USER || "postgres",
  password: process.env.E2E_PG_PASSWORD || "tulip",
};

export const pgUrl = (dbName) =>
  `postgresql://${LOCAL_PG.user}:${LOCAL_PG.password}@${LOCAL_PG.host}:${LOCAL_PG.port}/${dbName}?sslmode=disable`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

export function findChrome() {
  return CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

/**
 * Everything that must be true before a single assertion can mean anything.
 *
 * Returned as a list of reasons rather than a boolean, so the skip line can say WHICH thing was
 * missing. "skipped" with no reason is how a suite stops running without anyone noticing.
 */
export async function preflight() {
  const missing = [];
  if (!findChrome()) missing.push("Chrome not found (set CHROME_PATH)");
  if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) missing.push("web/dist missing — run `npm run build` in web/");

  // A live TCP connect, not a guess: the cluster has to actually answer.
  const reachable = await new Promise((resolve) => {
    const s = net.connect(LOCAL_PG.port, LOCAL_PG.host);
    const done = (v) => { try { s.destroy(); } catch { /* already gone */ } resolve(v); };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    s.setTimeout(2000, () => done(false));
  });
  if (!reachable) missing.push(`no local Postgres on ${LOCAL_PG.host}:${LOCAL_PG.port} — this suite never touches production`);

  return missing;
}

/** Minimal CDP client over Node's built-in WebSocket. No Playwright, no puppeteer. */
export class Browser {
  constructor(port = 9333) { this.port = port; this.id = 0; this.pending = new Map(); }

  async launch({ width = 1280, height = 900, mobile = false } = {}) {
    const chrome = findChrome();
    this.proc = spawn(chrome, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-dev-shm-usage", "--no-sandbox",
      `--user-data-dir=${(process.env.TEMP || "/tmp")}/tg-e2e-${Date.now()}-${this.port}`,
      `--remote-debugging-port=${this.port}`, "--hide-scrollbars", "about:blank",
    ], { stdio: "ignore" });

    let wsUrl = null;
    for (let i = 0; i < 80 && !wsUrl; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        wsUrl = (await r.json()).webSocketDebuggerUrl;
      } catch { await sleep(250); }
    }
    if (!wsUrl) throw new Error("Chrome never exposed a debugging port");

    this.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
        this.consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description).join(" ") ?? "");
      } else if (m.method === "Runtime.exceptionThrown") {
        this.pageErrors.push(m.params?.exceptionDetails?.exception?.description
          ?? m.params?.exceptionDetails?.text ?? "unknown");
      }
    };

    const { targetId } = await this.raw("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.raw("Target.attachToTarget", { targetId, flatten: true });
    this.sessionId = sessionId;
    this.consoleErrors = [];
    this.pageErrors = [];
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.setViewport({ width, height, mobile });
    return this;
  }

  raw(method, params = {}, sessionId) {
    return new Promise((res, rej) => {
      const n = ++this.id;
      this.pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      this.ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  }

  send(method, params = {}) { return this.raw(method, params, this.sessionId); }

  setViewport({ width, height, mobile = false }) {
    return this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
      screenWidth: width, screenHeight: height,
    });
  }

  async goto(url, { waitFor = null, timeout = 25000 } = {}) {
    await this.send("Page.navigate", { url });
    await sleep(400);
    if (waitFor) await this.waitFor(waitFor, { timeout });
    return this;
  }

  /** Evaluate in the page. Throws page-side exceptions rather than returning undefined. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "eval failed");
    }
    return r.result.value;
  }

  /**
   * Poll for a condition. Every wait in this suite is a poll, never a sleep — a fixed wait is
   * how a harness reports "no rows" for a page that simply had not finished loading, which cost
   * a real debugging detour in this repo already.
   */
  async waitFor(jsExpr, { timeout = 20000, interval = 200, label = "" } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      let ok = false;
      try { ok = await this.eval(`!!(${jsExpr})`); } catch { ok = false; }
      if (ok) return true;
      await sleep(interval);
    }
    throw new Error(`timed out after ${timeout}ms waiting for ${label || jsExpr}`);
  }

  /** Click by CSS selector, or by visible text with `text=`. Returns false if not found. */
  async click(selector, { timeout = 15000 } = {}) {
    const expr = selector.startsWith("text=")
      ? `[...document.querySelectorAll('a,button,[role=button],[role=option],[role=menuitem],label')]
           .find((e) => e.textContent.trim().toLowerCase().includes(${JSON.stringify(selector.slice(5).toLowerCase())}))`
      : `document.querySelector(${JSON.stringify(selector)})`;
    await this.waitFor(expr, { timeout, label: selector });
    return this.eval(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
  }

  /** Set a React-controlled input's value the way React will notice. */
  async fill(selector, value) {
    await this.waitFor(`document.querySelector(${JSON.stringify(selector)})`, { label: selector });
    return this.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        // React tracks the previous value on the DOM node; setting .value directly is ignored on
        // the next render. Going through the prototype setter is what makes onChange fire.
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
  }

  /**
   * Fill the input a given LABEL points at.
   *
   * The checkout's fields carry generated ids (`Field` uses `useId`), so there is no stable
   * selector to hardcode — which is correct for the app and means the suite has to resolve the
   * label the way a screen reader does: find the `<label>`, follow its `for`. A test that can
   * only find the field by CSS would keep passing if the label were ever disconnected from it.
   */
  async fillByLabel(labelText, value) {
    const find = `
      (() => {
        const want = ${JSON.stringify(labelText.toLowerCase())};
        const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().toLowerCase().startsWith(want));
        if (!lab) return null;
        return lab.htmlFor ? document.getElementById(lab.htmlFor) : lab.querySelector('input,select,textarea');
      })()
    `;
    await this.waitFor(find, { label: `label "${labelText}"` });
    return this.eval(`
      (() => {
        const el = ${find};
        if (!el) return false;
        if (el.tagName === 'SELECT') {
          const opt = [...el.options].find((o) => o.textContent.toLowerCase().includes(${JSON.stringify(String(value).toLowerCase())}) && !o.disabled);
          if (!opt) return false;
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
        } else {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
  }

  text(selector = "body") {
    return this.eval(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "")`);
  }

  url() { return this.eval("location.pathname + location.search"); }

  count(selector) { return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`); }

  async shot(dir, name) {
    fs.mkdirSync(dir, { recursive: true });
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  async close() {
    try { this.ws?.close(); } catch { /* already closed */ }
    try { this.proc?.kill(); } catch { /* already dead */ }
  }
}

/**
 * An API server on its own port, against its own database.
 *
 * Boot guards are satisfied with values generated here rather than read from the environment,
 * so this cannot accidentally inherit production's. `COMING_SOON` is left OFF because the suite
 * is exercising the storefront a customer sees after launch; the gate has its own suite.
 */
export async function startServer({ dbName, port, env = {} } = {}) {
  const url = pgUrl(dbName);
  const proc = spawn(process.execPath, ["--import", "tsx", path.join(SERVER_DIR, "src", "index.ts")], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: url,
      PORT: String(port),
      NODE_ENV: "development",
      JWT_SECRET: "e2e-only-jwt-secret-value-0123456789abcdef",
      ADMIN_KEY: "e2e-admin-key-not-the-default",
      COMING_SOON: "false",
      LOYALTY_ENABLED: "true",
      LOYALTY_REDEMPTION_ENABLED: "true",
      LOYALTY_SWEEP_SECRET: "e2e-sweep-secret-0123456789abcdef",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return { proc, base, adminKey: "e2e-admin-key-not-the-default", log: () => out };
    } catch { await sleep(500); }
    if (proc.exitCode !== null) break;
  }
  proc.kill();
  throw new Error(`server on ${port} never became healthy:\n${out.slice(-1500)}`);
}

export function stopServer(server) {
  try { server?.proc?.kill(); } catch { /* already dead */ }
}

/** Tiny assertion recorder with the same output shape as every other suite here. */
export function recorder() {
  const state = { pass: 0, fail: 0, lines: [] };
  return {
    ck(name, ok, extra = "") {
      ok ? state.pass++ : state.fail++;
      const line = `  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : "  " + extra}`;
      state.lines.push(line);
      console.log(line);
      return ok;
    },
    section(t) { console.log(`\n${t}`); },
    get pass() { return state.pass; },
    get fail() { return state.fail; },
  };
}
