/** One headless browser per fixture group; each capture gets a fresh context. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let browser;

/** Bound a protocol/lifecycle operation and release its timer on either outcome. */
export async function bounded(promise, label, milliseconds = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`${label} timed out`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function start() {
  const profile = await mkdtemp(join(tmpdir(), "bamboo-cdp-"));
  const proc = spawn(
    process.env.BAMBOO_CHROME ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  browser = { profile, proc, stderr: "", pending: new Map(), seq: 0 };
  const state = browser;
  const endpoint = await bounded(
    new Promise((resolve, reject) => {
      proc.stderr.on("data", (chunk) => {
        state.stderr = (state.stderr + chunk).slice(-65536);
        const match = state.stderr.match(
          /DevTools listening on (ws:\/\/[^\s]+)/,
        );
        if (match) resolve(match[1]);
      });
      proc.once("error", reject);
      proc.once("exit", (code) => reject(Error(`Browser exited: ${code}`)));
    }),
    "Browser startup",
  );
  state.socket = new WebSocket(endpoint);
  await bounded(
    new Promise((resolve, reject) => {
      state.socket.onopen = resolve;
      state.socket.onerror = reject;
    }),
    "Browser connection",
  );
  state.socket.onmessage = (event) => {
    const response = JSON.parse(event.data);
    if (response.method === "Runtime.exceptionThrown")
      console.error(JSON.stringify(response.params));
    const request = state.pending.get(response.id);
    if (!request) return;
    state.pending.delete(response.id);
    if (response.error) request.reject(Error(JSON.stringify(response.error)));
    else request.resolve(response.result);
  };
  state.socket.onclose = () => {
    for (const request of state.pending.values())
      request.reject(Error("Browser disconnected"));
    state.pending.clear();
  };
  return state;
}

async function call(state, method, params = {}, sessionId) {
  const id = ++state.seq;
  try {
    return await bounded(
      new Promise((resolve, reject) => {
        state.pending.set(id, { resolve, reject });
        state.socket.send(JSON.stringify({ id, method, params, sessionId }));
      }),
      method,
    );
  } finally {
    state.pending.delete(id);
  }
}

/** Open an isolated target; callers must close it even when assertions fail. */
export async function openPage() {
  const state = browser || (await start());
  const { browserContextId } = await call(state, "Target.createBrowserContext");
  try {
    const { targetId } = await call(state, "Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await call(state, "Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    return {
      send: (method, params) => call(state, method, params, sessionId),
      close: () =>
        call(state, "Target.disposeBrowserContext", { browserContextId }),
    };
  } catch (error) {
    await call(state, "Target.disposeBrowserContext", { browserContextId });
    throw error;
  }
}

/** Terminate only our headless child, save diagnostics, and bound cleanup. */
export async function closeBrowser(out) {
  const state = browser;
  browser = undefined;
  if (!state) return;
  state.socket?.close();
  try {
    if (
      state.proc.pid &&
      state.proc.exitCode === null &&
      state.proc.signalCode === null
    ) {
      const exited = new Promise((resolve) => state.proc.once("exit", resolve));
      state.proc.kill("SIGTERM");
      try {
        await bounded(exited, "Browser exit", 2000);
      } catch {
        state.proc.kill("SIGKILL");
        await bounded(exited, "Browser forced exit", 2000);
      }
    }
  } finally {
    await writeFile(join(out, "browser.log"), state.stderr);
    await rm(state.profile, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
