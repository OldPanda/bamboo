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
  await waitFor("document.querySelectorAll('.library-entry').length===1");
  const initial = await evaluate(
    `({modal:!!document.querySelector('dialog[open]'),editor:!document.querySelector('#sql-panel').hidden,results:!document.querySelector('#data-panel').hidden,role:document.querySelector('#query-library').tagName})`,
  );
  if (
    !initial.modal ||
    !initial.editor ||
    !initial.results ||
    initial.role !== "DIALOG"
  )
    throw Error("Panel blocks work " + JSON.stringify(initial));
  await evaluate(
    "document.querySelector('#library-save').click(); document.querySelector('#library-name').value='Daily <img> total'",
  );
  await enter();
  await waitFor("!!libraryAudit.finish");
  const pending = await evaluate(
    `({id:document.activeElement.id,disabled:document.querySelector('#library-name-submit').disabled,aria:document.querySelector('#library-name-submit').getAttribute('aria-disabled'),calls:libraryAudit.calls})`,
  );
  if (pending.disabled || pending.aria !== "true")
    throw Error("Save focus " + JSON.stringify(pending));
  await enter();
  if ((await evaluate("libraryAudit.calls")) !== 1)
    throw Error("Duplicate save");
  await evaluate(
    "document.querySelector('#library-search').focus();libraryAudit.finish();libraryAudit.finish=null",
  );
  await waitFor(
    "document.querySelector('#library-tab-1').getAttribute('aria-selected')==='true' && document.querySelector('#library-reload').getAttribute('aria-disabled')==='false'",
  );
  if ((await evaluate("document.activeElement.id")) !== "library-search")
    throw Error("Save stole dialog focus");
  await evaluate(
    "document.querySelector('#library-save').click();document.querySelector('#library-name').value='Renamed <img> total'",
  );
  await enter();
  await waitFor("!!libraryAudit.finish");
  await evaluate("libraryAudit.finish();libraryAudit.finish=null");
  await waitFor(
    "document.querySelector('#library-detail-title').textContent==='Renamed <img> total'",
  );
  await evaluate(
    "document.querySelector('#library-current').click();document.querySelector('[data-library-key=other]').click()",
  );
  if (!(await evaluate("document.querySelector('#library-open').disabled")))
    throw Error("Cross-source restore enabled");
  await evaluate(
    "document.querySelector('[data-library-key=one]').click();document.querySelector('#sql').value='SELECT 42 -- unsent draft';document.querySelector('#sql').dispatchEvent(new Event('input'));document.querySelector('#library-open').click()",
  );
  if (
    (await evaluate("document.querySelector('#sql').value")) !==
    "SELECT 42 -- unsent draft"
  )
    throw Error("Overwrote draft without consent");
  await evaluate(
    "document.querySelector('#library-cancel-replace').click();document.querySelector('#library-open').click();document.querySelector('#library-open').click()",
  );
  const opened = await evaluate("document.querySelector('#sql').value");
  if (
    !opened.includes("9223372036854775807") ||
    (await evaluate("libraryAudit.queries")) !== 1
  )
    throw Error("Open ran query or lost SQL");
  if (
    !(await evaluate(
      "!document.querySelector('#query-library').open && document.activeElement.id==='sql'",
    ))
  )
    throw Error("Open did not return to editor");
  await evaluate("document.querySelector('#query-history').click()");
  await waitFor(
    "document.querySelector('#query-library').open && document.querySelector('#library-reload').getAttribute('aria-disabled')==='false'",
  );
  const safe = await evaluate(
    "!document.querySelector('#query-library img') && document.querySelector('#library-preview').textContent.includes('9223372036854775807')",
  );
  if (!safe) throw Error("Unsafe SQL/title");
  await evaluate("document.querySelector('#library-search').focus()");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  if ((await evaluate("document.activeElement.id")) !== "library-current")
    throw Error("Keyboard Tab skipped current-source filter");
  await evaluate(
    "document.querySelector('#library-current').click();document.querySelector('#library-search').focus()",
  );
  const bounds = await evaluate(
    `(()=>{const p=document.querySelector('#query-library');const d=p.getBoundingClientRect();return {left:d.left,right:d.right,width:innerWidth,scroll:p.scrollWidth,client:p.clientWidth}})()`,
  );
  if (
    bounds.left < 0 ||
    bounds.right > bounds.width + 1 ||
    bounds.scroll > bounds.client + 1
  )
    throw Error("Panel overflow " + JSON.stringify(bounds));
  await evaluate("document.querySelector('#library-clear').focus()");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  if (
    !(await evaluate(
      "document.querySelector('#query-library').contains(document.activeElement)",
    ))
  )
    throw Error("Focus escaped dialog");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  if (
    !(await evaluate(
      "!document.querySelector('#query-library').open && document.activeElement.id==='query-history'",
    ))
  )
    throw Error("Escape focus return failed");
  await evaluate("document.querySelector('#query-history').click()");
  await waitFor(
    "document.querySelector('#query-library').open && document.querySelector('#library-reload').getAttribute('aria-disabled')==='false'",
  );
  const result = {
    initial,
    pending,
    bounds,
    safe,
    draftProtected: true,
    openDidNotExecute: true,
    namingAndRename: true,
  };
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
