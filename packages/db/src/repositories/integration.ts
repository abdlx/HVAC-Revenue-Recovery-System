import type {
  IntegrationRepository,
  JobberConnectionCredentials,
  PendingOAuthState,
} from "@hvac/crm";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  integrationAccounts,
  integrationOauthStates,
} from "../schema/index.js";

export class PostgresIntegrationRepository implements IntegrationRepository {
  constructor(private readonly db: Database) {}

  async withJobberRefreshLock<T>(
    organizationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`jobber-refresh:${organizationId}`}, 0))`,
      );
      return operation();
    });
  }

  async saveOAuthState(state: PendingOAuthState): Promise<void> {
    await this.db.insert(integrationOauthStates).values({
      ...state,
      provider: "JOBBER",
    });
  }

  async consumeOAuthState(
    stateHash: string,
    now: Date,
  ): Promise<PendingOAuthState | null> {
    return this.db.transaction(async (transaction) => {
      const [state] = await transaction
        .select({
          stateHash: integrationOauthStates.stateHash,
          organizationId: integrationOauthStates.organizationId,
          codeVerifierEncrypted: integrationOauthStates.codeVerifierEncrypted,
          redirectUri: integrationOauthStates.redirectUri,
          expiresAt: integrationOauthStates.expiresAt,
        })
        .from(integrationOauthStates)
        .where(
          and(
            eq(integrationOauthStates.stateHash, stateHash),
            eq(integrationOauthStates.provider, "JOBBER"),
            isNull(integrationOauthStates.consumedAt),
            gt(integrationOauthStates.expiresAt, now),
          ),
        )
        .limit(1);
      if (!state) return null;

      const [consumed] = await transaction
        .update(integrationOauthStates)
        .set({ consumedAt: now })
        .where(
          and(
            eq(integrationOauthStates.stateHash, stateHash),
            isNull(integrationOauthStates.consumedAt),
          ),
        )
        .returning({ stateHash: integrationOauthStates.stateHash });
      return consumed ? state : null;
    });
  }

  async upsertJobberConnection(
    connection: JobberConnectionCredentials,
  ): Promise<void> {
    const values = {
      externalAccountId: connection.externalAccountId,
      accessTokenEncrypted: connection.accessTokenEncrypted,
      refreshTokenEncrypted: connection.refreshTokenEncrypted,
      accessExpiresAt: connection.accessExpiresAt,
      scopesJson: connection.scopes,
      tokenVersion: connection.tokenVersion,
      lastRefreshAt: new Date(),
      status: "ACTIVE" as const,
      updatedAt: new Date(),
    };
    await this.db
      .insert(integrationAccounts)
      .values({
        organizationId: connection.organizationId,
        provider: "JOBBER",
        ...values,
      })
      .onConflictDoUpdate({
        target: [integrationAccounts.organizationId, integrationAccounts.provider],
        set: values,
      });
  }

  async loadActiveJobberConnection(
    organizationId: string,
  ): Promise<JobberConnectionCredentials | null> {
    const [connection] = await this.db
      .select({
        organizationId: integrationAccounts.organizationId,
        externalAccountId: integrationAccounts.externalAccountId,
        accessTokenEncrypted: integrationAccounts.accessTokenEncrypted,
        refreshTokenEncrypted: integrationAccounts.refreshTokenEncrypted,
        accessExpiresAt: integrationAccounts.accessExpiresAt,
        scopes: integrationAccounts.scopesJson,
        tokenVersion: integrationAccounts.tokenVersion,
      })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.organizationId, organizationId),
          eq(integrationAccounts.provider, "JOBBER"),
          eq(integrationAccounts.status, "ACTIVE"),
        ),
      )
      .limit(1);

    if (
      !connection?.accessTokenEncrypted ||
      !connection.refreshTokenEncrypted ||
      !connection.accessExpiresAt
    ) {
      return null;
    }
    return {
      ...connection,
      accessTokenEncrypted: connection.accessTokenEncrypted,
      refreshTokenEncrypted: connection.refreshTokenEncrypted,
      accessExpiresAt: connection.accessExpiresAt,
    };
  }

  async rotateJobberTokens(input: {
    organizationId: string;
    expectedTokenVersion: number;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessExpiresAt: Date;
    refreshedAt: Date;
  }): Promise<boolean> {
    const [updated] = await this.db
      .update(integrationAccounts)
      .set({
        accessTokenEncrypted: input.accessTokenEncrypted,
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        accessExpiresAt: input.accessExpiresAt,
        tokenVersion: input.expectedTokenVersion + 1,
        lastRefreshAt: input.refreshedAt,
        updatedAt: input.refreshedAt,
      })
      .where(
        and(
          eq(integrationAccounts.organizationId, input.organizationId),
          eq(integrationAccounts.provider, "JOBBER"),
          eq(integrationAccounts.status, "ACTIVE"),
          eq(integrationAccounts.tokenVersion, input.expectedTokenVersion),
        ),
      )
      .returning({ id: integrationAccounts.id });
    return Boolean(updated);
  }

  async disconnectJobber(organizationId: string): Promise<void> {
    await this.db
      .update(integrationAccounts)
      .set({
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        accessExpiresAt: null,
        status: "DISCONNECTED",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationAccounts.organizationId, organizationId),
          eq(integrationAccounts.provider, "JOBBER"),
        ),
      );
  }
}
