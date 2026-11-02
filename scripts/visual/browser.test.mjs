/** Verify lifecycle deadlines and isolated state in the real headless browser. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bounded, openPage, closeBrowser } from "./browser.mjs";

test("deadlines reject stalled operations and preserve actual failures", async () => {
  await assert.rejects(
    bounded(new Promise(() => {}), "fixture", 10),
    /fixture timed out/,
  );
  await assert.rejects(
    bounded(Promise.reject(Error("actual")), "fixture"),
    /actual/,
  );
  assert.equal(await bounded(Promise.resolve(42), "fixture"), 42);
});

test(
  "captures share the process but never page storage",
  { timeout: 30000 },
  async () => {
    const out = await mkdtemp(join(tmpdir(), "bamboo-browser-test-"));
    const server = createServer((_, response) =>
      response.end("<!doctype html><title>Fixture</title>"),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      for (const write of [true, false]) {
        const page = await openPage();
        try {
          await page.send("Page.navigate", {
            url: `http://127.0.0.1:${server.address().port}`,
          });
          let ready = false;
          for (let i = 0; i < 100; i++) {
            const state = await page.send("Runtime.evaluate", {
              expression: "document.title",
              returnByValue: true,
            });
            if (state.result.value === "Fixture") {
              ready = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert(ready);
          const result = await page.send("Runtime.evaluate", {
            expression: write
              ? 'localStorage.setItem("fixture", "old"); localStorage.getItem("fixture")'
              : 'localStorage.getItem("fixture")',
            returnByValue: true,
          });
          assert.equal(result.result.value, write ? "old" : null);
        } finally {
          await page.close();
        }
      }
    } finally {
      await closeBrowser(out);
      await new Promise((resolve) => server.close(resolve));
      await rm(out, { recursive: true, force: true });
    }
  },
);
