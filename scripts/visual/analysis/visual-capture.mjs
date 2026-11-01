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
  let result;
  for (let i = 0; i < 100; i++) {
    const r = await send("Runtime.evaluate", {
      expression: `document.getElementById('visual-result')?.textContent`,
      returnByValue: true,
    });
    if (r.result.value) {
      result = JSON.parse(r.result.value);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!result) throw Error("render did not finish");
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
  if (result.dialogOverflow || result.bodyOverflow || !result.reachable)
    throw Error("analysis controls are unreachable or overflow the layout");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
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
  if (
    !(await evaluate(
      "[...document.querySelectorAll('.analysis-table td')].every(cell=>getComputedStyle(cell).fontSize==='20px')",
    ))
  )
    throw Error(
      "analysis data and NULL cells must honor the selected text size",
    );
  await evaluate(
    "globalThis.deferAnalysis=true; document.getElementById('profile-run').scrollIntoView({block:'nearest'}); document.getElementById('profile-run').focus()",
  );
  await enter();
  for (
    let i = 0;
    i < 50 && !(await evaluate("!!globalThis.finishAnalysis"));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  if (
    !(await evaluate(
      "document.getElementById('profile-run').disabled && !document.getElementById('analysis-cancel').disabled && !document.getElementById('analysis-cancel').hidden",
    ))
  )
    throw Error("analysis busy and cancellation controls");
  await evaluate("finishAnalysis()");
  let restored = false;
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "document.getElementById('busy').hidden && document.activeElement.id==='profile-run'",
      )
    ) {
      restored = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!restored) throw Error("analysis keyboard focus after deferred response");
  await evaluate(
    "document.getElementById('pivot-export').click(); document.getElementById('export-json').focus()",
  );
  await enter();
  for (let i = 0; i < 50 && !(await evaluate("!!globalThis.finishPivot")); i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await evaluate("finishPivot()");
  restored = false;
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "document.getElementById('busy').hidden && document.activeElement.id==='pivot-export' && document.getElementById('analysis-dialog').open",
      )
    ) {
      restored = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!restored) throw Error("pivot export keyboard focus");
  console.log(name, JSON.stringify({ ...result, mode, keyboardFocus: true }));
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
