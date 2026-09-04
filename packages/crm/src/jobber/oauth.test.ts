import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createJobberAuthorizationRequest,
  JobberOAuthClient,
  JobberOAuthError,
} from "./oauth.js";

test("creates a Jobber authorization URL with state and S256 PKCE", () => {
  const codeVerifier = "v".repeat(64);
  const request = createJobberAuthorizationRequest({
    clientId: "client-1",
    redirectUri: "https://app.example.com/jobber/callback",
    state: "state-1",
    codeVerifier,
    now: new Date("2026-09-05T12:00:00.000Z"),
  });
  const url = new URL(request.authorizationUrl);

  assert.equal(url.origin, "https://api.getjobber.com");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(codeVerifier).digest("base64url"),
  );
  assert.equal(request.expiresAt.toISOString(), "2026-09-05T12:10:00.000Z");
});

test("exchanges an authorization code without exposing the secret in the URL", async () => {
  const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
  const client = new JobberOAuthClient({
    clientId: "client-1",
    clientSecret: "private-secret",
    redirectUri: "https://app.example.com/jobber/callback",
    now: () => new Date("2026-09-05T12:00:00.000Z"),
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
      });
    },
  });

  const tokens = await client.exchangeCode("code-1", "v".repeat(64));
  assert.equal(tokens.refreshToken, "refresh-1");
  assert.equal(tokens.expiresAt.toISOString(), "2026-09-05T13:00:00.000Z");
  assert.equal(requests[0]?.input, "https://api.getjobber.com/api/oauth/token");
  assert.doesNotMatch(requests[0]?.input ?? "", /private-secret/);
  const body = requests[0]?.init?.body as URLSearchParams;
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_secret"), "private-secret");
  assert.equal(body.get("code_verifier"), "v".repeat(64));
});

test("uses and returns the rotated refresh token", async () => {
  const client = new JobberOAuthClient({
    clientId: "client-1",
    clientSecret: "private-secret",
    redirectUri: "https://app.example.com/jobber/callback",
    fetch: async (_input, init) => {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("refresh_token"), "refresh-old");
      return Response.json({
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
      });
    },
  });

  const tokens = await client.refresh("refresh-old");
  assert.equal(tokens.refreshToken, "refresh-new");
});

test("sanitizes OAuth failures", async () => {
  const client = new JobberOAuthClient({
    clientId: "client-1",
    clientSecret: "private-secret",
    redirectUri: "https://app.example.com/jobber/callback",
    fetch: async () => new Response("refresh-old leaked", { status: 401 }),
  });
  await assert.rejects(
    client.refresh("refresh-old"),
    (error: unknown) =>
      error instanceof JobberOAuthError &&
      error.statusCode === 401 &&
      !error.message.includes("refresh-old"),
  );
});
