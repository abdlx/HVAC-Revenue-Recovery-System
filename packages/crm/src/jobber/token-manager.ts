import type { IntegrationRepository } from "../integration-repository.js";
import type { CredentialCipher } from "../token-cipher.js";
import type { JobberOAuthClient } from "./oauth.js";

export class JobberConnectionNotActiveError extends Error {
  constructor(organizationId: string) {
    super(`No active Jobber connection for organization ${organizationId}`);
    this.name = "JobberConnectionNotActiveError";
  }
}

export class JobberAccessTokenManager {
  constructor(
    private readonly oauthClient: JobberOAuthClient,
    private readonly repository: IntegrationRepository,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
    private readonly refreshSkewMs = 5 * 60_000,
  ) {}

  getAccessToken(organizationId: string): Promise<string> {
    return this.repository.withJobberRefreshLock(organizationId, async () => {
      const connection =
        await this.repository.loadActiveJobberConnection(organizationId);
      if (!connection) throw new JobberConnectionNotActiveError(organizationId);

      const now = this.now();
      if (connection.accessExpiresAt.getTime() > now.getTime() + this.refreshSkewMs) {
        return this.cipher.decrypt(connection.accessTokenEncrypted);
      }

      const tokens = await this.oauthClient.refresh(
        this.cipher.decrypt(connection.refreshTokenEncrypted),
      );
      const saved = await this.repository.rotateJobberTokens({
        organizationId,
        expectedTokenVersion: connection.tokenVersion,
        accessTokenEncrypted: this.cipher.encrypt(tokens.accessToken),
        refreshTokenEncrypted: this.cipher.encrypt(tokens.refreshToken),
        accessExpiresAt: tokens.expiresAt,
        refreshedAt: now,
      });
      if (!saved) {
        throw new Error("Jobber token rotation lost its serialized update lock");
      }
      return tokens.accessToken;
    });
  }
}
