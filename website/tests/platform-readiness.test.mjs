/** Reproduce the transient empty document seen during macOS CI navigation. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { platformPageReady } from "../scripts/website-platforms-check.mjs";

test("platform polling waits for the new document and initialized download controls", () => {
  const check = ({
    root = { dataset: { downloadReady: "true" } },
    label = { textContent: "Choose a platform" },
    state = "complete",
    search = "?platform-test=1",
  } = {}) =>
    runInNewContext(`(${platformPageReady.toString()})("1")`, {
      document: {
        documentElement: root,
        querySelector: () => label,
        readyState: state,
      },
      location: { search },
      URLSearchParams,
    });
  assert.equal(
    check({ root: null, label: null, state: "loading" }),
    false,
    "Navigation can temporarily have no document element",
  );
  assert.equal(
    check({ root: { dataset: { platformTestLeaving: "true" } } }),
    false,
    "Do not accept the previous page",
  );
  assert.equal(check({ label: null }), false, "Wait for controls to exist");
  assert.equal(
    check({ root: { dataset: {} } }),
    false,
    "Wait for site initialization",
  );
  assert.equal(check({ state: "loading" }), false);
  assert.equal(
    check({ search: "?platform-test=10" }),
    false,
    "Match the exact navigation marker",
  );
  assert.equal(check(), true);
});
