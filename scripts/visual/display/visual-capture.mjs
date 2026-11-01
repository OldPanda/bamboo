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
    throw Error("text options layout overflow");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await evaluate(
    "document.getElementById('display-save').scrollIntoView({block:'nearest'}); document.getElementById('display-save').focus()",
  );
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: type === "keyDown" ? "\r" : undefined,
    });
  for (
    let i = 0;
    i < 50 && !(await evaluate("!!globalThis.finishDisplay"));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  if (
    !(await evaluate(
      "document.activeElement.id==='display-save' && document.getElementById('display-save').getAttribute('aria-disabled')==='true'",
    ))
  )
    throw Error("display control lost focus while saving");
  await evaluate("finishDisplay()");
  let restored = false;
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "document.activeElement.id==='display-save' && document.getElementById('display-form').getAttribute('aria-busy')==='false'",
      )
    ) {
      restored = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!restored) throw Error("display control lost focus after saving");
  await evaluate("document.getElementById('settings-dismiss').click()");
  const usable = await evaluate(`(() => {
    const editor=document.getElementById('sql'), table=document.getElementById('grid'), footer=document.querySelector('.table-footer');
    footer.scrollIntoView({block:'end'});
    return getComputedStyle(editor).fontSize==='21px' && getComputedStyle(table).fontSize==='20px' && footer.getBoundingClientRect().bottom<=innerHeight+1 && document.documentElement.scrollWidth<=innerWidth;
  })()`);
  if (!usable) throw Error("data text size or narrow footer reachability");
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
