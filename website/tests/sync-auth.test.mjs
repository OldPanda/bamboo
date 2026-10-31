import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { installationToken } from "../scripts/sync-auth.mjs";
import { githubAPI } from "../scripts/sync-release.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const config = { appID: "123", installationID: "456", privateKey: pem };

test("App JWTs are signed and installation credentials are restricted, masked and refreshed during API use", async () => {
  let time = Date.parse("2026-10-01T00:00:00Z"),
    minted = 0;
  const masked = [],
    sent = [];
  const token = installationToken({
    ...config,
    now: () => time,
    mask: (value) => masked.push(value),
    fetcher: async (url, options) => {
      assert.equal(
        url,
        "https://api.github.com/app/installations/456/access_tokens",
      );
      assert.equal(options.redirect, "error");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), {
        repository_ids: [1437598384],
        permissions: {
          contents: "write",
          pull_requests: "write",
          actions: "read",
          checks: "read",
        },
      });
      const jwt = options.headers.Authorization.slice(7),
        [header, payload, signature] = jwt.split(".");
      assert(
        verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          publicKey,
          Buffer.from(signature, "base64url"),
        ),
      );
      assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
        alg: "RS256",
        typ: "JWT",
      });
      const claims = JSON.parse(Buffer.from(payload, "base64url"));
      assert.equal(claims.iss, "123");
      assert.equal(claims.iat, time / 1000 - 60);
      assert.equal(claims.exp, time / 1000 + 540);
      assert(masked.includes(jwt));
      minted++;
      return Response.json({
        token: `synthetic-${minted}`,
        expires_at: new Date(time + 3600000).toISOString(),
      });
    },
  });
  const api = githubAPI(token, async (url, options) => {
    sent.push(options.headers.Authorization);
    return Response.json({});
  });
  await api("pulls", "POST", {});
  time += 54 * 60000;
  await api("actions/runs/1");
  time += 2 * 60000;
  await api("pulls/1/merge", "PUT", {});
  time += 75 * 60000;
  await api("git/ref/heads/main");
  assert.deepEqual(sent, [
    "Bearer synthetic-1",
    "Bearer synthetic-1",
    "Bearer synthetic-2",
    "Bearer synthetic-3",
  ]);
  assert.equal(minted, 3);
  assert(masked.includes("synthetic-3"));
});

test("missing configuration fails before network or writes; expired credentials are never reused", async () => {
  for (const name of ["appID", "installationID", "privateKey"]) {
    assert.throws(
      () => installationToken({ ...config, [name]: undefined }),
      /Configure SYNC_APP/,
    );
  }
  assert.throws(
    () => installationToken({ ...config, installationID: "../evil" }),
    /Configure/,
  );
  for (const result of [
    { token: "synthetic", expires_at: "invalid" },
    { token: "synthetic", expires_at: "2020-01-01T00:00:00Z" },
  ]) {
    const token = installationToken({
      ...config,
      fetcher: async () => Response.json(result),
    });
    await assert.rejects(token(), /expires too soon/);
  }
  let time = 0,
    requests = 0;
  const token = installationToken({
    ...config,
    now: () => time,
    fetcher: async () =>
      ++requests === 1
        ? Response.json({
            token: "synthetic",
            expires_at: new Date(3600000).toISOString(),
          })
        : new Response("secret server details", { status: 401 }),
  });
  await token();
  time = 3600000;
  await assert.rejects(token(), /^AssertionError.*HTTP 401$/);
  assert.equal(requests, 2);
});
