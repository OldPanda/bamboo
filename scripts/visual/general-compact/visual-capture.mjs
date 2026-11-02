import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openPage } from "../browser.mjs";
const [url, out, name, width, height, mode] = process.argv.slice(2);
const page = await openPage();
const send = page.send;
try {
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
  if (
    result.dialogOverflow ||
    result.bodyOverflow ||
    !result.panelVisible ||
    !result.stable ||
    !result.closeStable ||
    !result.scrolls
  )
    throw Error("layout overflow");
  await send("Runtime.evaluate", {
    expression: "document.getElementById('settings-dismiss').click()",
  });
  const reminder = await send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.getElementById('update-reminder');
      const r = button.getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const settings = document.getElementById('settings').getBoundingClientRect();
      return !button.hidden && !button.disabled && r.width > 0 && r.height >= 36 &&
        r.left >= sidebar.left && r.right <= sidebar.right &&
        r.bottom <= settings.top && settings.bottom <= innerHeight &&
        r.top > innerHeight / 2;
    })()`,
    returnByValue: true,
  });
  if (!reminder.result.value)
    throw Error("update reminder is not visible at sidebar bottom");
  const reminderShot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(out, name + "-reminder.png"),
    Buffer.from(reminderShot.data, "base64"),
  );
  console.log(name, JSON.stringify({ ...result, mode, reminderVisible: true }));
} finally {
  await page.close();
}
