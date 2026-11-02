/** Run all captures of a fixture in one browser without sharing page state. */
import { pathToFileURL } from "node:url";
import { bounded, closeBrowser } from "./browser.mjs";
const [script, serialized, timeout] = process.argv.slice(2);
const cases = JSON.parse(serialized);
try {
  for (const [index, args] of cases.entries()) {
    process.argv = [process.execPath, script, ...args];
    console.log(`Capture ${args[2]} starting`);
    await bounded(
      import(`${pathToFileURL(script)}?capture=${index}`),
      `Capture ${args[2]}`,
      Number(timeout) * 1000,
    );
  }
} finally {
  await closeBrowser(cases[0][1]);
}
