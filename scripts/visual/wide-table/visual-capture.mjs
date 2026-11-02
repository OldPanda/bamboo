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
    const b = document.querySelectorAll('#grid th button')[2047];
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

  result.table = await evaluate(`(() => {
    const table = document.querySelector('#grid'), row = table.tBodies[0].rows[0];
    const expected = new URL(location.href).searchParams.get('font');
    const sizes = [row.cells[1],row.cells[3],row.cells[4]].map(cell=>getComputedStyle(cell).fontSize);
    if (sizes.some(size=>size!==expected+'px')) throw Error('wide cell font mismatch '+sizes);
    const selection = getSelection(), range = document.createRange();
    range.setStart(row.cells[2].firstChild,0); range.setEnd(row.cells[2048].firstChild,25);
    selection.removeAllRanges(); selection.addRange(range);
    const text = selection.toString();
    if (!text.includes('9007199254740993') || !text.includes('12345678901234567890.1234') || !text.includes('cell-1024')) throw Error('cross-column selection lost values');
    selection.removeAllRanges();
    if (!window.find('cell-2046',false,false,true)) throw Error('offscreen browser find failed');
    const found = selection.toString(); selection.removeAllRanges();
    if (found!=='cell-2046') throw Error('browser find selected wrong text');
    return {rows:table.tBodies[0].rows.length,columns:row.cells.length-1,sizes,selectionLength:text.length,find:found};
  })()`);
  if (result.table.rows !== 62 || result.table.columns !== 2048)
    throw Error("wide page lost cells");
  const remote = await send("Runtime.evaluate", {
    expression: "document.querySelector('#grid tbody tr').cells[2048]",
  });
  const node = await send("DOM.describeNode", {
    objectId: remote.result.objectId,
  });
  const ax = await send("Accessibility.getPartialAXTree", {
    backendNodeId: node.node.backendNodeId,
    fetchRelatives: false,
  });
  result.accessibility = ax.nodes.map((n) => ({
    ignored: n.ignored,
    role: n.role?.value,
    name: n.name?.value,
  }));
  if (!result.accessibility.some((n) => !n.ignored && n.role === "cell"))
    throw Error("late column missing native cell semantics");
  await evaluate("document.getElementById('grid-scroll').scrollLeft=0");

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
