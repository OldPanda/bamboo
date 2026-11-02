import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openPage } from "../browser.mjs";
const [url, out, name, width, height, mode] = process.argv.slice(2);
const page = await openPage();
const send = page.send;
try {
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
    throw Error("export chooser layout overflow");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await evaluate("document.getElementById('export-dismiss').focus()");
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: type === "keyDown" ? "\r" : undefined,
    });
  let restored = false;
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "!document.getElementById('export-dialog').open && document.activeElement.id === 'export'",
      )
    ) {
      restored = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!restored) throw Error("export chooser keyboard focus did not return");
  await evaluate(
    "document.getElementById('export').click(); document.getElementById('export-scope').value='full'; document.getElementById('export-json').focus()",
  );
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: type === "keyDown" ? "\r" : undefined,
    });
  for (let i = 0; i < 50 && !(await evaluate("!!globalThis.finishExport")); i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  if (
    !(await evaluate(
      "!document.getElementById('busy').hidden && document.getElementById('export').disabled",
    ))
  )
    throw Error("export busy state missing");
  await evaluate("finishExport()");
  restored = false;
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "document.getElementById('busy').hidden && !document.getElementById('export').disabled && document.activeElement.id==='export'",
      )
    ) {
      restored = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!restored) throw Error("deferred export lost keyboard focus");
  console.log(name, JSON.stringify({ ...result, mode, keyboardFocus: true }));
} finally {
  await page.close();
}
