/** Keep same-URL theme navigation from sampling the outgoing flow document. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { flowPageReady } from "../scripts/website-flow-check.mjs";

test("flow polling rejects outgoing, empty and incomplete documents", () => {
  const url = "https://example.test/en/";
  const check = ({
    root = { dataset: {} },
    href = url,
    state = "complete",
    dots = 4,
  } = {}) =>
    runInNewContext(`(${flowPageReady.toString()})(${JSON.stringify(url)})`, {
      document: {
        documentElement: root,
        readyState: state,
        querySelectorAll: () => Array(dots),
      },
      location: { href },
    });
  assert.equal(
    check({ root: { dataset: { flowTestLeaving: "true" } } }),
    false,
    "A complete outgoing document at the same URL is not ready",
  );
  assert.equal(check({ root: null, state: "loading" }), false);
  assert.equal(check({ href: "https://example.test/zh/" }), false);
  assert.equal(check({ state: "loading" }), false);
  assert.equal(check({ dots: 0 }), false);
  assert.equal(check(), true);
});
