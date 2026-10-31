/** Release → verified catalog → checked PR → main → existing Pages Git integration. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installationToken } from "./sync-auth.mjs";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  catalogDecision,
  compareTags,
  verifyReleaseDownloads,
} from "./release-downloads.mjs";

const repository = "OldPanda/bamboo";
const catalogPath = "website/downloads.json";
// Read Actions runs belonging to these workflows, not arbitrary same-name checks.
const requiredWorkflows = [
  ["ci.yml", "PR quality gate"],
  ["website.yml", "Website build and browser checks"],
];

/** Bound and paginate repository API collections; truncation is never success. */
async function collection(api, path, key) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const result = await api(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    assert(result.total_count <= 1000, "API collection exceeds 1000 entries");
    items.push(...result[key]);
    if (items.length >= result.total_count) return items;
  }
  throw Error("API pagination exceeded its bound");
}

/** Keep the latest execution of each gate, including gates not rerun this time. */
export async function latestJobs(api, run, names) {
  assert(
    Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0 &&
      run.run_attempt <= 20,
    "Unexpected workflow attempt count",
  );
  const found = new Map();
  for (let attempt = run.run_attempt; attempt >= 1; attempt--) {
    const jobs = await collection(
      api,
      `actions/runs/${run.id}/attempts/${attempt}/jobs`,
      "jobs",
    );
    const seen = new Set();
    for (const job of jobs) {
      assert(
        job.run_id === run.id && job.head_sha === run.head_sha,
        "Foreign workflow job",
      );
      assert(!seen.has(job.name), "Ambiguous workflow job name");
      seen.add(job.name);
      if (!found.has(job.name)) found.set(job.name, job);
    }
    if (names.every((name) => found.has(name))) break;
  }
  return found;
}

/** Resolve only refs/tags, including annotated tags, never a same-named branch. */
export async function tagCommit(api, tag) {
  const ref = await api(`git/ref/tags/${encodeURIComponent(tag)}`);
  assert.equal(ref.ref, `refs/tags/${tag}`, "Unexpected tag ref");
  let object = ref.object;
  const seen = new Set();
  for (let depth = 0; depth < 10; depth++) {
    if (object.type === "commit") return object.sha;
    assert(
      object.type === "tag" && !seen.has(object.sha),
      "Invalid annotated tag",
    );
    seen.add(object.sha);
    object = (await api(`git/tags/${encodeURIComponent(object.sha)}`)).object;
  }
  throw Error("Annotated tag nesting exceeded its bound");
}

/** A replaced pending event must still reconcile every newer successful release run. */
export async function newestSuccessfulRun(api, sourceID) {
  const source = await api(`actions/runs/${sourceID}`);
  let selected = source;
  // Reconcile all retained successes: a later-created older tag must not hide a
  // higher version whose pending workflow_run was replaced by concurrency.
  const runs = await collection(
    api,
    "actions/workflows/release.yml/runs?status=success&event=push",
    "workflow_runs",
  );
  for (const run of runs) {
    if (
      /^v\d+\.\d+\.\d+$/.test(run.head_branch) &&
      (!/^v\d+\.\d+\.\d+$/.test(selected.head_branch) ||
        compareTags(run.head_branch, selected.head_branch) > 0)
    )
      selected = run;
  }
  return selected.id;
}

/** Resolve fresh credentials for each repository request; never send them to downloads. */
export function githubAPI(token, fetcher = fetch) {
  return async (path, method = "GET", body) => {
    const credential = typeof token === "function" ? await token() : token;
    const response = await fetcher(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    assert(response.ok, `GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

/** Bind a successful run to the exact release tag and require every native gate. */
export async function releaseForRun(api, runID) {
  assert(/^\d+$/.test(String(runID)), "A Release run ID is required");
  const run = await api(`actions/runs/${runID}`);
  assert.equal(String(run.id), String(runID), "Unexpected release run ID");
  assert(
    run.repository.full_name === repository &&
      run.head_repository.full_name === repository,
    "Foreign release run",
  );
  assert(
    run.path === ".github/workflows/release.yml" &&
      run.event === "push" &&
      run.status === "completed" &&
      run.conclusion === "success",
    "Release run has not succeeded",
  );
  // Prereleases are intentionally ignored, even if their packaging succeeded.
  if (!/^v\d+\.\d+\.\d+$/.test(run.head_branch)) return null;
  const names = [
    "Release quality gate / PR quality gate",
    "Build macOS DMG",
    "Publish GitHub Release",
    ...[
      "Build Windows and Linux packages",
      "Verify hosted Windows and Linux installers",
    ].flatMap((prefix) =>
      ["ubuntu-22.04", "windows-2025"].map(
        (os) => `${prefix} / desktop (${os})`,
      ),
    ),
  ];
  const jobs = await latestJobs(api, run, names);
  for (const name of names)
    assert(
      jobs.get(name)?.status === "completed" &&
        jobs.get(name)?.conclusion === "success",
      `Missing successful release gate: ${name}`,
    );
  assert.equal(
    await tagCommit(api, run.head_branch),
    run.head_sha,
    "Release tag moved since verification",
  );
  // The tag must already be in main's history. An unreleased side commit that
  // can push tags but cannot merge main must never advertise downloads, even
  // if its own Release run reported success.
  const mainRef = await api("git/ref/heads/main");
  const ancestry = await api(
    `compare/${encodeURIComponent(mainRef.object.sha)}...${encodeURIComponent(
      run.head_sha,
    )}`,
  );
  assert(
    ancestry.status === "behind" || ancestry.status === "identical",
    "Release tag is not reachable from main",
  );
  const release = await api(
    `releases/tags/${encodeURIComponent(run.head_branch)}`,
  );
  assert.equal(release.tag_name, run.head_branch);
  return release;
}

async function mainSnapshot(api) {
  const ref = await api("git/ref/heads/main");
  const file = await api(`contents/${catalogPath}?ref=${ref.object.sha}`);
  return {
    sha: ref.object.sha,
    file,
    catalog: JSON.parse(Buffer.from(file.content, "base64").toString("utf8")),
  };
}

/** Await the newest eligible run of each trusted workflow for this exact PR/base/head. */
export async function pullRequestChecks(api, pr, sha, baseSHA, wait = sleep) {
  const deadline = Date.now() + 75 * 60 * 1000;
  for (;;) {
    const pending = [];
    for (const [workflow, name] of requiredWorkflows) {
      const runs = await collection(
        api,
        `actions/workflows/${workflow}/runs?event=pull_request&head_sha=${sha}`,
        "workflow_runs",
      );
      const candidates = runs.filter(
        (run) =>
          run.path === `.github/workflows/${workflow}` &&
          run.event === "pull_request" &&
          run.head_sha === sha &&
          run.repository?.full_name === repository &&
          run.head_repository?.full_name === repository &&
          run.pull_requests?.some(
            (item) =>
              item.number === pr.number &&
              item.head.sha === sha &&
              item.base.ref === "main" &&
              item.base.sha === baseSHA,
          ),
      );
      const run = candidates.sort((a, b) => b.id - a.id)[0];
      if (!run || run.status !== "completed") {
        pending.push(name);
        continue;
      }
      assert.equal(
        run.conclusion,
        "success",
        `${workflow} failed: ${run.html_url}`,
      );
      const job = (await latestJobs(api, run, [name])).get(name);
      assert(
        job?.status === "completed" && job.conclusion === "success",
        `Missing successful PR gate: ${name}`,
      );
    }
    if (!pending.length) return;
    assert(
      Date.now() < deadline,
      `Timed out waiting for PR checks: ${pending.join(", ")}`,
    );
    await wait(30000);
  }
}

/** Recover the main commit that last changed the catalog, including manual merges. */
async function catalogCommit(api, base) {
  const commits = await api(
    `commits?sha=${base.sha}&path=${encodeURIComponent(catalogPath)}&per_page=1`,
  );
  assert(commits.length === 1, "Cannot find the catalog's main commit");
  const sha = commits[0].sha;
  const file = await api(`contents/${catalogPath}?ref=${sha}`);
  assert.deepEqual(
    JSON.parse(Buffer.from(file.content, "base64").toString("utf8")),
    base.catalog,
    "Catalog recovery commit does not match main",
  );
  return sha;
}

/** Confirm the Git integration deployed this merge and both public locales expose its catalog. */
export async function verifyDeployment(
  api,
  sha,
  catalog,
  wait = sleep,
  fetcher = fetch,
) {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const checks = await api(
      `commits/${sha}/check-runs?check_name=Cloudflare%20Pages&per_page=100`,
    );
    const check = checks.check_runs.find(
      (item) => item.app?.id === 85455 && item.head_sha === sha,
    );
    if (check?.status === "completed") {
      assert.equal(
        check.conclusion,
        "success",
        "Cloudflare Pages deployment failed; retry in Pages after fixing the build",
      );
      let ready = true;
      for (const locale of ["en", "zh"]) {
        const response = await fetcher(`https://getbamboo.app/${locale}/`, {
          signal: AbortSignal.timeout(30000),
        });
        const html = response.ok ? await response.text() : "";
        ready &&= Object.values(catalog.packages).every(
          (asset) =>
            html.includes(asset.url) &&
            html.includes(
              `${catalog.tag} · ${(asset.size / 1000000).toFixed(1)} MB`,
            ),
        );
      }
      if (ready) return;
    }
    await wait(30000);
  }
  throw Error(
    "Catalog merged, but Pages production was not confirmed in 15 minutes; inspect the Git integration and retry deployment",
  );
}

/** Injectable API/wait/verification boundaries allow failure tests without remote writes. */
export async function synchronize({
  api,
  runID,
  dryRun = true,
  verify = verifyReleaseDownloads,
  deploy = verifyDeployment,
  wait = sleep,
}) {
  const release = await releaseForRun(api, runID);
  if (!release) return "prerelease";
  const catalog = await verify(release);
  const content = Buffer.from(JSON.stringify(catalog, null, 2) + "\n").toString(
    "base64",
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const base = await mainSnapshot(api);
    const decision = catalogDecision(base.catalog, catalog);
    if (dryRun || decision === "older")
      return dryRun ? `dry-run: ${decision}` : decision;
    if (decision === "unchanged") {
      await deploy(api, await catalogCommit(api, base), catalog, wait);
      return "unchanged: production verified";
    }
    // A deterministic branch per base makes retries resumable, without force pushes.
    const branch = `automation/website-${catalog.tag}-${base.sha}`;
    const refs = await api(`git/matching-refs/heads/${branch}`);
    if (!refs.some((ref) => ref.ref === `refs/heads/${branch}`)) {
      await api("git/refs", "POST", {
        ref: `refs/heads/${branch}`,
        sha: base.sha,
      });
    }
    let head = (await api(`git/ref/heads/${branch}`)).object.sha;
    if (head === base.sha) {
      const update = await api(`contents/${catalogPath}`, "PUT", {
        branch,
        sha: base.file.sha,
        content,
        message: `chore(website): synchronize ${catalog.tag} downloads`,
      });
      head = update.commit.sha;
    }
    // Do not merge an edited automation branch or any unrelated file.
    const diff = await api(`compare/${base.sha}...${head}`);
    assert(
      diff.status === "ahead" &&
        diff.commits.length === 1 &&
        diff.files.length === 1 &&
        diff.files[0].filename === catalogPath &&
        diff.files[0].status === "modified",
      "Automation branch contains unexpected changes",
    );
    const proposed = await api(`contents/${catalogPath}?ref=${head}`);
    assert.equal(
      Buffer.from(proposed.content, "base64").toString("utf8"),
      Buffer.from(content, "base64").toString("utf8"),
      "Automation catalog was edited",
    );
    const pulls = await api(
      `pulls?state=all&head=OldPanda:${branch}&base=main`,
    );
    let pr = pulls.find((item) => item.head.ref === branch);
    if (!pr)
      pr = await api("pulls", "POST", {
        head: branch,
        base: "main",
        title: `chore(website): synchronize ${catalog.tag} downloads`,
        body: `All five public packages passed SHA-256 and size verification after [Release run](https://github.com/${repository}/actions/runs/${runID}).\n\nOpening this pull request runs the normal CI and Website checks on its head; the sync waits for those required checks and then merges through the protected PR API. Cloudflare Pages deploys main through its existing Git integration.`,
      });
    assert(
      pr.state === "open",
      "Automation PR is closed; inspect before retrying",
    );
    console.log(`Checking ${pr.html_url} at ${head}`);
    await pullRequestChecks(api, pr, head, base.sha, wait);
    const latest = await mainSnapshot(api);
    if (latest.sha !== base.sha) {
      await api(`pulls/${pr.number}`, "PATCH", { state: "closed" });
      continue; // Rebuild the single-file proposal on fresh main and check again.
    }
    // Re-read metadata to catch removal/drafting/replacement during lengthy CI.
    const currentRelease = await releaseForRun(api, runID);
    assert.equal(
      currentRelease.id,
      release.id,
      "Release was replaced during checks",
    );
    const identity = (value) =>
      value.assets.map(
        ({
          id,
          name,
          size,
          state,
          digest,
          updated_at,
          browser_download_url,
        }) => ({
          id,
          name,
          size,
          state,
          digest,
          updated_at,
          browser_download_url,
        }),
      );
    assert.deepEqual(
      identity(currentRelease),
      identity(release),
      "Release assets changed during checks",
    );
    assert(
      !currentRelease.draft && !currentRelease.prerelease,
      "Release is no longer stable",
    );
    const merged = await api(`pulls/${pr.number}/merge`, "PUT", {
      sha: head,
      merge_method: "squash",
    });
    assert(
      merged.merged,
      "GitHub declined the merge; branch protections remain in force",
    );
    console.log(
      `Merged ${pr.html_url}: ${merged.sha}. Pages Git integration owns deployment.`,
    );
    await deploy(api, merged.sha, catalog, wait);
    console.log(
      "Confirmed Cloudflare Pages and both production locale download catalogs.",
    );
    return `merged: ${merged.sha}`;
  }
  throw Error(
    "main kept changing; rerun sync to check a fresh catalog proposal",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Read-only local validation is allowed; writes run only on trusted main in Actions.
  const dryRun = process.env.DRY_RUN !== "false";
  if (!dryRun) {
    assert(
      process.env.GITHUB_ACTIONS === "true" &&
        process.env.GITHUB_REPOSITORY === repository &&
        process.env.GITHUB_REF === "refs/heads/main",
      "Writes require the trusted main workflow",
    );
    const event = JSON.parse(
      await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    assert(
      ["workflow_run", "workflow_dispatch"].includes(
        process.env.GITHUB_EVENT_NAME,
      ),
      "Unexpected event",
    );
    if (process.env.GITHUB_EVENT_NAME === "workflow_run")
      assert.equal(String(event.workflow_run.id), process.env.RELEASE_RUN_ID);
  }
  // Missing App configuration is an error before any write, never a green manual fallback.
  const token = dryRun
    ? process.env.GH_TOKEN
    : installationToken({
        appID: process.env.SYNC_APP_ID,
        installationID: process.env.SYNC_APP_INSTALLATION_ID,
        privateKey: process.env.SYNC_APP_PRIVATE_KEY,
        mask: (value) => console.log(`::add-mask::${value}`),
      });
  console.log(
    await synchronize({
      api: githubAPI(token),
      runID:
        process.env.COALESCE_RELEASES === "true"
          ? await newestSuccessfulRun(
              githubAPI(token),
              process.env.RELEASE_RUN_ID,
            )
          : process.env.RELEASE_RUN_ID,
      dryRun,
    }),
  );
}
