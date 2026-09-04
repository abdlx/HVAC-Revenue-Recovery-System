import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  IntegrationRepository,
  JobberConnectionCredentials,
  PendingOAuthState,
} from "../integration-repository.js";
import { AesGcmTokenCipher } from "../token-cipher.js";
import { JobberAuthorizationService, InvalidJobberOAuthStateError } from "./authorization.js";
import { JobberGraphqlClient } from "./client.js";
import { JobberOAuthClient } from "./oauth.js";
import { JobberAccessTokenManager } from "./token-manager.js";

class MemoryIntegrationRepository implements IntegrationRepository {
  states = new Map<string, PendingOAuthState>();
  consumed = new Set<string>();
  connection: JobberConnectionCredentials | null = null;

  withJobberRefreshLock<T>(
    _organizationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }
  async saveOAuthState(state: PendingOAuthState) {
    this.states.set(state.stateHash, state);
  }
  async consumeOAuthState(stateHash: string, now: Date) {
    const state = this.states.get(stateHash);
    if (!state || this.consumed.has(stateHash) || state.expiresAt <= now) return null;
    this.consumed.add(stateHash);
    return state;
  }
  async upsertJobberConnection(connection: JobberConnectionCredentials) {
    this.connection = connection;
  }
  async loadActiveJobberConnection() {
    return this.connection;
  }
  async rotateJobberTokens(input: {
    organizationId: string;
    expectedTokenVersion: number;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessExpiresAt: Date;
    refreshedAt: Date;
  }) {
    if (!this.connection || this.connection.tokenVersion !== input.expectedTokenVersion) {
      return false;
    }
    this.connection = {
      ...this.connection,
      accessTokenEncrypted: input.accessTokenEncrypted,
      refreshTokenEncrypted: input.refreshTokenEncrypted,
      accessExpiresAt: input.accessExpiresAt,
      tokenVersion: input.expectedTokenVersion + 1,
    };
    return true;
  }
  async disconnectJobber() {
    this.connection = null;
  }
}

test("completes single-use Jobber OAuth state and stores encrypted rotated credentials", async () => {
  const repository = new MemoryIntegrationRepository();
  const cipher = new AesGcmTokenCipher(Buffer.alloc(32, 4), "key-1");
  const now = () => new Date("2026-09-05T12:00:00.000Z");
  const oauthClient = new JobberOAuthClient({
    clientId: "client-1",
    clientSecret: "private-secret",
    redirectUri: "https://app.example.com/jobber/callback",
    now,
    fetch: async () =>
      Response.json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
      }),
  });
  const graphqlClient = new JobberGraphqlClient({
    apiVersion: "2025-04-16",
    fetch: async () =>
      Response.json({
        data: { account: { id: "account-1", name: "Reliable Heating" } },
      }),
  });
  const service = new JobberAuthorizationService(
    oauthClient,
    graphqlClient,
    repository,
    cipher,
    {
      clientId: "client-1",
      redirectUri: "https://app.example.com/jobber/callback",
      scopes: ["read_clients"],
      now,
    },
  );

  const started = await service.begin("organization-1");
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.ok(state);
  assert.ok(repository.states.has(createHash("sha256").update(state).digest("base64url")));

  const completed = await service.complete({ state, code: "authorization-code" });
  assert.equal(completed.externalAccountId, "account-1");
  assert.equal(repository.connection?.organizationId, "organization-1");
  assert.doesNotMatch(repository.connection?.refreshTokenEncrypted ?? "", /refresh-1/);
  assert.equal(
    cipher.decrypt(repository.connection?.refreshTokenEncrypted ?? ""),
    "refresh-1",
  );
  await assert.rejects(
    service.complete({ state, code: "authorization-code" }),
    InvalidJobberOAuthStateError,
  );
});

test("refreshes an expiring token and stores the rotated token before returning", async () => {
  const repository = new MemoryIntegrationRepository();
  const cipher = new AesGcmTokenCipher(Buffer.alloc(32, 5), "key-1");
  repository.connection = {
    organizationId: "organization-1",
    externalAccountId: "account-1",
    accessTokenEncrypted: cipher.encrypt("access-old"),
    refreshTokenEncrypted: cipher.encrypt("refresh-old"),
    accessExpiresAt: new Date("2026-09-05T12:01:00.000Z"),
    scopes: ["read_clients"],
    tokenVersion: 1,
  };
  let refreshCount = 0;
  const oauthClient = new JobberOAuthClient({
    clientId: "client-1",
    clientSecret: "private-secret",
    redirectUri: "https://app.example.com/jobber/callback",
    now: () => new Date("2026-09-05T12:00:00.000Z"),
    fetch: async () => {
      refreshCount += 1;
      return Response.json({
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
      });
    },
  });
  const manager = new JobberAccessTokenManager(
    oauthClient,
    repository,
    cipher,
    () => new Date("2026-09-05T12:00:00.000Z"),
  );

  assert.equal(await manager.getAccessToken("organization-1"), "access-new");
  assert.equal(repository.connection.tokenVersion, 2);
  assert.equal(
    cipher.decrypt(repository.connection.refreshTokenEncrypted),
    "refresh-new",
  );
  assert.equal(await manager.getAccessToken("organization-1"), "access-new");
  assert.equal(refreshCount, 1);
});
