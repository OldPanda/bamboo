import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [url, out, name, width, height, mode] = process.argv.slice(2);
const profile = await mkdtemp(join(tmpdir(), "bamboo-cdp-"));
const proc = spawn(
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
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let data = "";
    const timeout = setTimeout(
      () => reject(Error("browser startup timeout")),
      10000,
    );
    proc.stderr.on("data", (b) => {
      data += b;
      const m = data.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    });
    proc.on("error", reject);
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = (e) => {
    const r = JSON.parse(e.data);
    if (pending.has(r.id)) {
      const [resolve, reject] = pending.get(r.id);
      pending.delete(r.id);
      if (r.error) {
        reject(Error(JSON.stringify(r.error)));
      } else {
        resolve(r.result);
      }
    }
  };
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, [resolve, reject]);
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params) => call(method, params, sessionId);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", {
    width: +width,
    height: +height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: mode }],
  });
  await send("Page.navigate", { url });
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (reply.exceptionDetails)
      throw Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Timed out: " + expression);
  };
  const enter = async () => {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        text: type === "keyDown" ? "\r" : undefined,
      });
  };
  await waitFor("document.body?.dataset.sortReady === 'true'");
  const state = () =>
    evaluate(`(() => {
    const b = document.querySelectorAll('#grid th button')[1];
    return {focused:document.activeElement===b, disabled:b.disabled,
      ariaDisabled:b.getAttribute('aria-disabled'), direction:b.closest('th').getAttribute('aria-sort'),
      calls:sortAudit.calls, active:document.activeElement.id};
  })()`);
  const result = { cycles: [] };
  for (const direction of ["ascending", "descending"]) {
    await enter();
    await waitFor("!!globalThis.sortAudit.finish");
    const pending = await state();
    // A real browser blurs a native disabled button; jsdom does not model it.
    if (!pending.focused || pending.disabled || pending.ariaDisabled !== "true")
      throw Error(
        "Header lost focus while query was pending: " + JSON.stringify(pending),
      );
    await enter();
    if ((await state()).calls !== pending.calls)
      throw Error("Busy header started another query");
    await evaluate("sortAudit.finish(); sortAudit.finish=null");
    await waitFor("document.getElementById('busy').hidden");
    const complete = await state();
    if (
      !complete.focused ||
      complete.direction !== direction ||
      complete.ariaDisabled !== "false"
    )
      throw Error("Sorted header state: " + JSON.stringify(complete));
    result.cycles.push({ pending, complete });
  }
  await enter();
  await waitFor("!!globalThis.sortAudit.finish");
  await evaluate(
    "document.getElementById('grid-scroll').focus(); sortAudit.finish(); sortAudit.finish=null",
  );
  await waitFor("document.getElementById('busy').hidden");
  result.movedFocus = (await state()).active === "grid-scroll";
  if (!result.movedFocus)
    throw Error("Sorting reclaimed focus from the scroll region");
  const scheme = await send("Runtime.evaluate", {
    expression: `matchMedia('(prefers-color-scheme: dark)').matches`,
    returnByValue: true,
  });
  if (scheme.result.value !== (mode === "dark")) throw Error("scheme mismatch");
  await new Promise((r) => setTimeout(r, 150));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, name + ".png"), Buffer.from(shot.data, "base64"));
  await writeFile(
    join(out, name + ".json"),
    JSON.stringify(
      { ...result, mode, headless: true, mockedIPC: true },
      null,
      2,
    ),
  );
  console.log(name, JSON.stringify({ ...result, mode }));
} finally {
  socket?.close();
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    if (proc.exitCode !== null) resolve();
    else proc.once("exit", resolve);
  });
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
