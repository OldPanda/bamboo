import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  catalogFromRelease,
  packageSuffixes,
} from "../scripts/download-catalog.mjs";
import {
  catalogDecision,
  compareTags,
  verifyReleaseDownloads,
} from "../scripts/release-downloads.mjs";
import {
  githubAPI,
  synchronize,
  verifyDeployment,
} from "../scripts/sync-release.mjs";

function fixture(tag = "v1.2.3") {
  const bytes = Buffer.from("synthetic package");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const bodies = new Map();
  const assets = Object.values(packageSuffixes).flatMap((suffix) => {
    const name = `Bamboo-${tag.slice(1)}-${suffix}`;
    return [
      [name, bytes],
      [`${name}.sha256`, Buffer.from(`${hash}  ${name}\n`)],
    ].map(([name, body]) => {
      const url = `https://github.com/OldPanda/bamboo/releases/download/${tag}/${name}`;
      bodies.set(url, body);
      return {
        name,
        size: body.length,
        state: "uploaded",
        browser_download_url: url,
      };
    });
  });
  return {
    release: { tag_name: tag, assets, draft: false, prerelease: false },
    bodies,
  };
}

test("all five packages require their real lengths and SHA-256 sidecars", async () => {
  const { release, bodies } = fixture();
  const fetcher = async (url, options) => {
    assert(!options.headers, "credentials must never reach download hosts");
    return new Response(bodies.get(url));
  };
  assert.deepEqual(
    await verifyReleaseDownloads(release, fetcher),
    catalogFromRelease(release),
  );
  for (const mutate of [
    (r) => {
      r.draft = true;
    },
    (r) => {
      r.prerelease = true;
    },
    (r) => {
      r.assets.pop();
    },
    (r) => {
      r.assets[0].size++;
    },
    (r) => {
      r.assets[0].size--;
    },
    (r) => {
      r.assets[1].browser_download_url = "https://example.com/hash";
    },
    (r) => {
      r.assets.push(r.assets[0]);
    },
  ]) {
    const changed = structuredClone(release);
    mutate(changed);
    await assert.rejects(verifyReleaseDownloads(changed, fetcher));
  }
  bodies.set(
    release.assets[0].browser_download_url,
    Buffer.from("corrupted package"),
  );
  await assert.rejects(verifyReleaseDownloads(release, fetcher));
  await assert.rejects(
    verifyReleaseDownloads(
      release,
      async () => new Response("", { status: 503 }),
    ),
    /503/,
  );
});

test("version ordering prevents late-run downgrades, is exact and detects asset replacement", () => {
  const catalog = catalogFromRelease(fixture().release);
  assert.equal(catalogDecision(catalog, catalog), "unchanged");
  assert.equal(
    catalogDecision(catalog, catalogFromRelease(fixture("v1.2.2").release)),
    "older",
  );
  assert.equal(
    catalogDecision(catalog, catalogFromRelease(fixture("v1.10.0").release)),
    "update",
  );
  assert.equal(
    compareTags("v9007199254740993.0.0", "v9007199254740992.0.0"),
    1,
  );
  assert.throws(() => compareTags("v01.2.3", "v1.2.3"));
  const edited = structuredClone(catalog);
  edited.packages.macosDmg.size++;
  assert.throws(
    () => catalogDecision(catalog, edited),
    /advertised release changed/,
  );
  edited.packages.macosDmg = null;
  assert.throws(() => catalogDecision(catalog, edited), /five packages/);
});

function harness({
  current = "v1.2.2",
  failedCI = false,
  changeMain = false,
  tamper = false,
  releaseFailure = false,
} = {}) {
  const { release } = fixture();
  const writes = [];
  const branches = new Map();
  const contents = new Map();
  const prs = new Map();
  const runs = new Map();
  let main = "base",
    changed = false;
  const run = {
    repository: { full_name: "OldPanda/bamboo" },
    head_repository: { full_name: "OldPanda/bamboo" },
    path: ".github/workflows/release.yml",
    event: "push",
    status: "completed",
    conclusion: releaseFailure ? "failure" : "success",
    head_branch: "v1.2.3",
    head_sha: "tagsha",
    run_attempt: 1,
  };
  const jobs = [
    "Release quality gate / PR quality gate",
    "Build macOS DMG",
    "Publish GitHub Release",
    ...[
      "Build Windows and Linux packages",
      "Verify hosted Windows and Linux installers",
    ].flatMap((p) =>
      ["ubuntu-22.04", "windows-2025"].map((os) => `${p} / desktop (${os})`),
    ),
  ].map((name) => ({ name, conclusion: "success" }));
  const file = (catalog) => ({
    sha: "blob",
    content: Buffer.from(JSON.stringify(catalog)).toString("base64"),
  });
  const api = async (path, method = "GET", body) => {
    if (method !== "GET") writes.push({ path, method, body });
    if (path === "actions/runs/123") return run;
    if (path.includes("/attempts/1/jobs")) return { jobs };
    if (path.startsWith("commits/")) return { sha: "tagsha" };
    if (path.startsWith("releases/tags/")) return release;
    if (path === "git/ref/heads/main") return { object: { sha: main } };
    if (path === `contents/website/downloads.json?ref=${main}`)
      return file(catalogFromRelease(fixture(current).release));
    if (path.startsWith("git/matching-refs/heads/"))
      return [...branches.keys()].map((branch) => ({
        ref: `refs/heads/${branch}`,
      }));
    if (path === "git/refs") {
      branches.set(body.ref.slice(11), body.sha);
      return {};
    }
    if (path.startsWith("git/ref/heads/"))
      return { object: { sha: branches.get(path.slice(14)) } };
    if (path === "contents/website/downloads.json") {
      const sha = `head-${body.branch}`;
      branches.set(body.branch, sha);
      contents.set(sha, body.content);
      return { commit: { sha } };
    }
    if (path.startsWith("compare/"))
      return {
        status: "ahead",
        commits: [{}],
        files: [
          {
            filename: tamper ? "README.md" : "website/downloads.json",
            status: "modified",
          },
        ],
      };
    if (path.startsWith("contents/"))
      return { content: contents.get(path.split("?ref=")[1]) };
    if (path.startsWith("pulls?"))
      return [...prs.values()].filter((pr) => path.includes(pr.head.ref));
    if (path === "pulls") {
      const pr = {
        number: prs.size + 1,
        state: "open",
        head: { ref: body.head },
        html_url: "https://example.com/pr",
      };
      prs.set(pr.number, pr);
      return pr;
    }
    if (path.endsWith("/dispatches")) {
      runs.set(path.split("/")[2] + body.ref, {
        head_sha: branches.get(body.ref),
        status: "completed",
        conclusion: failedCI ? "failure" : "success",
      });
      return null;
    }
    if (path.includes("/runs?branch=")) {
      const branch = decodeURIComponent(path.split("branch=")[1].split("&")[0]);
      const found = runs.get(path.split("/")[2] + branch);
      if (found && changeMain && !changed) {
        main = "newbase";
        changed = true;
      }
      return { workflow_runs: found ? [found] : [] };
    }
    if (path.endsWith("/merge")) {
      current = "v1.2.3";
      main = "merged";
      return { merged: true, sha: "merged" };
    }
    if (path.startsWith("pulls/") && method === "PATCH") {
      prs.get(Number(path.split("/")[1])).state = "closed";
      return {};
    }
    throw Error(`Unexpected API ${method} ${path}`);
  };
  return {
    api,
    writes,
    run,
    jobs,
    options: {
      api,
      runID: "123",
      dryRun: false,
      verify: async () => catalogFromRelease(release),
      deploy: async () => {},
      wait: async () => {},
    },
  };
}

test("successful sync dispatches both checks and only then merges the exact catalog head", async () => {
  const h = harness();
  assert.equal(await synchronize(h.options), "merged: merged");
  const dispatches = h.writes.filter((w) => w.path.endsWith("/dispatches"));
  assert.equal(dispatches.length, 2);
  const last = h.writes.at(-1);
  assert.equal(last.path, "pulls/1/merge");
  assert(last.body.sha.startsWith("head-automation/website-v1.2.3-base"));
  assert.deepEqual(
    h.writes.filter((w) => w.path.startsWith("contents/")).map((w) => w.path),
    ["contents/website/downloads.json"],
  );
  const count = h.writes.length;
  assert.equal(await synchronize(h.options), "unchanged");
  assert.equal(h.writes.length, count);
});

test("no-op, late release, dry run and failed verification make no remote writes", async () => {
  for (const current of ["v1.2.3", "v2.0.0"]) {
    const h = harness({ current });
    await synchronize(h.options);
    assert.equal(h.writes.length, 0);
  }
  const h = harness();
  await synchronize({ ...h.options, dryRun: true });
  await assert.rejects(
    synchronize({
      ...h.options,
      verify: async () => {
        throw Error("network");
      },
    }),
  );
  assert.equal(h.writes.length, 0);
  const bad = harness({ releaseFailure: true });
  await assert.rejects(synchronize(bad.options));
  assert.equal(bad.writes.length, 0);
});

test("failed CI and a tampered branch cannot merge", async () => {
  for (const option of [{ failedCI: true }, { tamper: true }]) {
    const h = harness(option);
    await assert.rejects(synchronize(h.options));
    assert(!h.writes.some((w) => w.path.endsWith("/merge")));
  }
});

test("foreign runs, moved tags and missing native acceptance cannot write", async () => {
  for (const change of [
    (h) => {
      h.run.head_repository.full_name = "foreign/repo";
    },
    (h) => {
      h.run.head_sha = "different";
    },
    (h) => {
      h.run.event = "pull_request";
    },
    (h) => {
      h.jobs.at(-1).conclusion = "skipped";
    },
  ]) {
    const h = harness();
    change(h);
    await assert.rejects(synchronize(h.options));
    assert.equal(h.writes.length, 0);
  }
});

test("a retry reuses the catalog branch and PR after an interrupted dispatch", async () => {
  const h = harness();
  const interruptedAPI = (path, method, body) => {
    if (path.endsWith("/dispatches")) throw Error("interrupted");
    return h.api(path, method, body);
  };
  await assert.rejects(
    synchronize({ ...h.options, api: interruptedAPI }),
    /interrupted/,
  );
  assert.equal(await synchronize(h.options), "merged: merged");
  assert.equal(h.writes.filter((w) => w.path === "pulls").length, 1);
  assert.equal(
    h.writes.filter((w) => w.path === "contents/website/downloads.json").length,
    1,
  );
});

test("main advancing closes the stale proposal and verifies a fresh branch", async () => {
  const h = harness({ changeMain: true });
  assert.equal(await synchronize(h.options), "merged: merged");
  assert(
    h.writes.some((w) => w.path === "pulls/1" && w.body.state === "closed"),
  );
  assert.equal(h.writes.at(-1).path, "pulls/2/merge");
  assert(h.writes.at(-1).body.sha.endsWith("newbase"));
});

test("API failures are fail-closed and API redirects never forward credentials", async () => {
  const api = githubAPI("synthetic", async (url, options) => {
    assert(url.startsWith("https://api.github.com/repos/OldPanda/bamboo/"));
    assert.equal(options.redirect, "error");
    return new Response("", { status: 403 });
  });
  await assert.rejects(api("git/ref/heads/main"), /403/);
});

test("production confirmation requires Cloudflare's exact commit and both locales", async () => {
  const catalog = catalogFromRelease(fixture().release);
  const html = Object.values(catalog.packages)
    .map(
      (asset) =>
        `${asset.url} ${catalog.tag} · ${(asset.size / 1000000).toFixed(1)} MB`,
    )
    .join(" ");
  const urls = [];
  const api = async () => ({
    check_runs: [
      {
        app: { id: 85455 },
        head_sha: "merged",
        status: "completed",
        conclusion: "success",
      },
    ],
  });
  await verifyDeployment(
    api,
    "merged",
    catalog,
    async () => {
      throw Error("unexpected wait");
    },
    async (url) => {
      urls.push(url);
      return new Response(html);
    },
  );
  assert.deepEqual(urls, [
    "https://getbamboo.app/en/",
    "https://getbamboo.app/zh/",
  ]);
  const stop = async () => {
    throw Error("not deployed");
  };
  await assert.rejects(
    verifyDeployment(api, "wrong-sha", catalog, stop),
    /not deployed/,
  );
  await assert.rejects(
    verifyDeployment(
      api,
      "merged",
      catalog,
      stop,
      async () => new Response("old version"),
    ),
    /not deployed/,
  );
});
