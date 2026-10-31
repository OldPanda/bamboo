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
  newestSuccessfulRun,
  latestJobs,
  tagCommit,
  pullRequestChecks,
} from "../scripts/sync-release.mjs";

test("a late pending event reconciles newer successful runs by exact numeric version", async () => {
  const source = {
    id: 1,
    head_branch: "v1.2.3",
    created_at: "2026-10-01T00:00:00Z",
  };
  const api = async (path) =>
    path === "actions/runs/1"
      ? source
      : {
          total_count: 3,
          workflow_runs: [
            { id: 2, head_branch: "v1.9.0" },
            { id: 3, head_branch: "v1.10.0" },
            { id: 4, head_branch: "v2.0.0-rc.1" },
          ],
        };
  assert.equal(await newestSuccessfulRun(api, 1), 3);
  await assert.rejects(
    newestSuccessfulRun(
      async (path) =>
        path === "actions/runs/1"
          ? source
          : { total_count: 1001, workflow_runs: [] },
      1,
    ),
    /1000/,
  );
});

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
  ancestry = "behind",
} = {}) {
  const { release } = fixture();
  const writes = [];
  const branches = new Map();
  const contents = new Map();
  const prs = new Map();
  const state = { ancestry };
  let main = "base",
    changed = false;
  const run = {
    id: 123,
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
  ].map((name) => ({
    name,
    conclusion: "success",
    status: "completed",
    run_id: 123,
    head_sha: "tagsha",
  }));
  const file = (catalog) => ({
    sha: "blob",
    content: Buffer.from(JSON.stringify(catalog)).toString("base64"),
  });
  const api = async (path, method = "GET", body) => {
    if (method !== "GET") writes.push({ path, method, body });
    if (path === "actions/runs/123") return run;
    if (path.startsWith("actions/runs/123/attempts/1/jobs"))
      return { total_count: jobs.length, jobs };
    if (path === "git/ref/tags/v1.2.3")
      return {
        ref: "refs/tags/v1.2.3",
        object: { type: "commit", sha: "tagsha" },
      };
    if (path.startsWith("commits?")) return [{ sha: main }];
    if (path.startsWith("actions/workflows/")) {
      if (changeMain && !changed) {
        main = "newbase";
        changed = true;
      }
      const workflow = path.split("/")[2],
        sha = new URLSearchParams(path.split("?")[1]).get("head_sha");
      const pr = [...prs.values()].find((item) => item.head.sha === sha);
      const checkRun = {
        id: workflow === "ci.yml" ? 2001 : 2002,
        run_attempt: 1,
        path: `.github/workflows/${workflow}`,
        event: "pull_request",
        head_sha: sha,
        repository: { full_name: "OldPanda/bamboo" },
        head_repository: { full_name: "OldPanda/bamboo" },
        pull_requests: [pr],
        status: "completed",
        conclusion: failedCI ? "failure" : "success",
      };
      state[checkRun.id] = checkRun;
      return { total_count: 1, workflow_runs: [checkRun] };
    }
    if (path.startsWith("actions/runs/20")) {
      const id = Number(path.split("/")[2]),
        checkRun = state[id];
      return {
        total_count: 1,
        jobs: [
          {
            name:
              id === 2001
                ? "PR quality gate"
                : "Website build and browser checks",
            run_id: id,
            head_sha: checkRun.head_sha,
            status: "completed",
            conclusion: "success",
          },
        ],
      };
    }
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
    if (path.startsWith("compare/")) {
      if (path.endsWith("...tagsha")) return { status: state.ancestry };
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
    }
    if (path.startsWith("contents/"))
      return { content: contents.get(path.split("?ref=")[1]) };
    if (path.startsWith("pulls?"))
      return [...prs.values()].filter((pr) => path.includes(pr.head.ref));
    if (path === "pulls") {
      const pr = {
        number: prs.size + 1,
        state: "open",
        head: { ref: body.head, sha: branches.get(body.head) },
        base: { ref: "main", sha: main },
        html_url: "https://example.com/pr",
      };
      prs.set(pr.number, pr);
      return pr;
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
    state,
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

test("successful sync waits for pull_request checks and only then merges the exact catalog head", async () => {
  const h = harness();
  assert.equal(await synchronize(h.options), "merged: merged");
  assert.equal(
    h.writes.filter((w) => w.path.endsWith("/dispatches")).length,
    0,
  );
  const last = h.writes.at(-1);
  assert.equal(last.path, "pulls/1/merge");
  assert(last.body.sha.startsWith("head-automation/website-v1.2.3-base"));
  assert.deepEqual(
    h.writes.filter((w) => w.path.startsWith("contents/")).map((w) => w.path),
    ["contents/website/downloads.json"],
  );
  const count = h.writes.length;
  assert.equal(await synchronize(h.options), "unchanged: production verified");
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

test("foreign runs, moved tags, unmerged tags and missing native acceptance cannot write", async () => {
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
    (h) => {
      h.state.ancestry = "ahead";
    },
  ]) {
    const h = harness();
    change(h);
    await assert.rejects(synchronize(h.options));
    assert.equal(h.writes.length, 0);
  }
});

test("a retry reuses the catalog branch and PR after an interrupted check", async () => {
  const h = harness();
  const interruptedAPI = (path, method, body) => {
    if (path.includes("/runs?event=pull_request")) throw Error("interrupted");
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

test("partial reruns retain earlier successful gates but never mask a newer failure", async () => {
  const run = { id: 50, head_sha: "same", run_attempt: 2 };
  const job = (name, conclusion) => ({
    name,
    conclusion,
    status: "completed",
    run_id: 50,
    head_sha: "same",
  });
  let latest = job("acceptance", "success");
  const api = async (path) => {
    const jobs = path.includes("/attempts/2/")
      ? [latest]
      : [job("build", "success"), job("acceptance", "failure")];
    return { total_count: jobs.length, jobs };
  };
  let found = await latestJobs(api, run, ["build", "acceptance"]);
  assert.equal(found.get("build").conclusion, "success");
  assert.equal(found.get("acceptance").conclusion, "success");
  latest = job("build", "failure");
  found = await latestJobs(api, run, ["build", "acceptance"]);
  assert.equal(found.get("build").conclusion, "failure");
  await assert.rejects(
    latestJobs(
      async () => ({
        total_count: 1,
        jobs: [{ ...latest, head_sha: "foreign" }],
      }),
      run,
      ["build"],
    ),
    /Foreign workflow job/,
  );
});

test("job pagination cannot omit the required gate", async () => {
  const run = { id: 50, head_sha: "same", run_attempt: 1 };
  const filler = Array.from({ length: 100 }, (_, i) => ({
    name: `matrix-${i}`,
    run_id: 50,
    head_sha: "same",
  }));
  const found = await latestJobs(
    async (path) => ({
      total_count: 101,
      jobs: path.endsWith("page=1")
        ? filler
        : [
            {
              name: "gate",
              run_id: 50,
              head_sha: "same",
              conclusion: "success",
            },
          ],
    }),
    run,
    ["gate"],
  );
  assert.equal(found.get("gate").conclusion, "success");
});

test("exact tag refs peel annotations and reject missing refs, trees and cycles", async () => {
  assert.equal(
    await tagCommit(
      async (path) =>
        path.startsWith("git/ref/tags/")
          ? {
              ref: "refs/tags/v1.2.3",
              object: { type: "tag", sha: "annotation" },
            }
          : { object: { type: "commit", sha: "commit" } },
      "v1.2.3",
    ),
    "commit",
  );
  for (const object of [
    { type: "tree", sha: "tree" },
    { type: "tag", sha: "cycle" },
  ]) {
    await assert.rejects(
      tagCommit(
        async (path) =>
          path.startsWith("git/ref/tags/")
            ? { ref: "refs/tags/v1.2.3", object }
            : { object },
        "v1.2.3",
      ),
      /Invalid annotated tag/,
    );
  }
  const h = harness();
  const api = (path, method, body) => {
    if (path.startsWith("git/ref/tags/"))
      throw Error("HTTP 404: exact tag missing");
    if (path === "commits/v1.2.3") return { sha: "tagsha" }; // a branch must not stand in for a tag
    return h.api(path, method, body);
  };
  await assert.rejects(synchronize({ ...h.options, api }), /exact tag missing/);
  assert.equal(h.writes.length, 0);
});

test("recovery after merge still checks production without another commit or PR", async () => {
  const h = harness();
  let checks = 0;
  const deploy = async () => {
    checks++;
    throw Error("production still old");
  };
  await assert.rejects(
    synchronize({ ...h.options, deploy }),
    /production still old/,
  );
  const writes = h.writes.length;
  await assert.rejects(
    synchronize({ ...h.options, deploy }),
    /production still old/,
  );
  assert.equal(checks, 2);
  assert.equal(h.writes.length, writes);
  let recovered;
  assert.equal(
    await synchronize({
      ...h.options,
      deploy: async (_api, sha) => {
        recovered = sha;
      },
    }),
    "unchanged: production verified",
  );
  assert.equal(recovered, "merged");
});

test("already-current manual catalog still requires production confirmation; dry run never deploys", async () => {
  const h = harness({ current: "v1.2.3" });
  const deploy = async () => {
    throw Error("manual merge not deployed");
  };
  await assert.rejects(
    synchronize({ ...h.options, deploy }),
    /manual merge not deployed/,
  );
  assert.equal(
    await synchronize({ ...h.options, dryRun: true, deploy }),
    "dry-run: unchanged",
  );
  assert.equal(h.writes.length, 0);
});

test("PR gates reject wrong events, workflows, forks, PRs, heads and bases", async () => {
  const good = {
    id: 20,
    run_attempt: 1,
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    head_sha: "head",
    repository: { full_name: "OldPanda/bamboo" },
    head_repository: { full_name: "OldPanda/bamboo" },
    pull_requests: [
      { number: 7, head: { sha: "head" }, base: { ref: "main", sha: "base" } },
    ],
    status: "completed",
    conclusion: "success",
  };
  for (const mutate of [
    (r) => {
      r.event = "workflow_dispatch";
    },
    (r) => {
      r.path = ".github/workflows/other.yml";
    },
    (r) => {
      r.head_repository.full_name = "fork/bamboo";
    },
    (r) => {
      r.head_sha = "other";
    },
    (r) => {
      r.pull_requests[0].number = 8;
    },
    (r) => {
      r.pull_requests[0].base.sha = "other";
    },
    (r) => {
      r.pull_requests[0].head.sha = "other";
    },
  ]) {
    const wrong = structuredClone(good);
    mutate(wrong);
    const api = async (path) =>
      path === "git/ref/heads/main"
        ? { object: { sha: "base" } }
        : { total_count: 1, workflow_runs: [wrong] };
    await assert.rejects(
      pullRequestChecks(api, { number: 7 }, "head", "base", async () => {
        throw Error("not eligible");
      }),
      /not eligible/,
    );
  }
  const failed = { ...good, id: 21, conclusion: "failure" };
  await assert.rejects(
    pullRequestChecks(
      async (path) =>
        path === "git/ref/heads/main"
          ? { object: { sha: "base" } }
          : { total_count: 2, workflow_runs: [good, failed] },
      { number: 7 },
      "head",
      "base",
    ),
    /ci.yml failed/,
  );
});

test("main advancing before PR checks exist promptly rebuilds instead of waiting for an obsolete base", async () => {
  const paths = [];
  assert.equal(
    await pullRequestChecks(
      async (path) => {
        paths.push(path);
        return { object: { sha: "newbase" } };
      },
      { number: 7 },
      "head",
      "oldbase",
      async () => {
        throw Error("must not wait");
      },
    ),
    false,
  );
  assert.deepEqual(paths, ["git/ref/heads/main"]);
});
