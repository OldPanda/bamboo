/** Format native WKWebView smoke bodies without changing their execution wrapper. */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { format } from "prettier";

const write = process.argv.includes("--write");
for (const name of (await readdir("scripts")).filter((name) =>
  name.endsWith("-smoke.js"),
)) {
  const path = `scripts/${name}`;
  const source = await readFile(path, "utf8");
  // These files are passed to an async native evaluation function, not imported.
  const wrapped = await format(`async function nativeSmoke() {\n${source}\n}`, {
    parser: "babel",
  });
  const body = wrapped
    .slice(wrapped.indexOf("\n") + 1, wrapped.lastIndexOf("}"))
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");
  if (body !== source) {
    if (write) await writeFile(path, body);
    else {
      console.error(`Needs formatting: ${path}`);
      process.exitCode = 1;
    }
  }
}
