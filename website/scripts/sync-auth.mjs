/** Short-lived, repository-scoped GitHub App credentials for the release sync. */
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";

const permissions = {
  contents: "write",
  pull_requests: "write",
  actions: "read",
  checks: "read",
};

/** Mint on demand and refresh five minutes before expiry, including during long CI waits. */
export function installationToken({
  appID,
  installationID,
  privateKey,
  fetcher = fetch,
  now = Date.now,
  mask = () => {},
}) {
  assert(
    /^\d+$/.test(appID ?? "") &&
      /^\d+$/.test(installationID ?? "") &&
      privateKey,
    "Configure SYNC_APP_ID, SYNC_APP_INSTALLATION_ID and SYNC_APP_PRIVATE_KEY before enabling unattended sync",
  );
  const key = createPrivateKey(privateKey);
  assert.equal(key.asymmetricKeyType, "rsa", "The GitHub App key must be RSA");
  let cached;
  return async () => {
    if (cached && cached.expires > now() + 300000) return cached.token;
    const seconds = Math.floor(now() / 1000);
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: String(appID) })}`;
    const jwt = `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
    mask(jwt);
    const response = await fetcher(
      `https://api.github.com/app/installations/${installationID}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ repository_ids: [1437598384], permissions }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    assert(
      response.ok,
      `GitHub App authentication failed: HTTP ${response.status}`,
    );
    const result = await response.json();
    assert(
      typeof result.token === "string" &&
        /^[A-Za-z0-9_.=-]+$/.test(result.token),
      "Invalid installation token",
    );
    mask(result.token);
    const expires = Date.parse(result.expires_at);
    assert(
      Number.isFinite(expires) && expires > now() + 300000,
      "Installation token expires too soon",
    );
    cached = { token: result.token, expires };
    return cached.token;
  };
}
