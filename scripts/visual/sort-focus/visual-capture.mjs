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
  await page.close();
}
