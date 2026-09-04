export interface PendingOAuthState {
  stateHash: string;
  organizationId: string;
  codeVerifierEncrypted: string;
  redirectUri: string;
  expiresAt: Date;
}

export interface JobberConnectionCredentials {
  organizationId: string;
  externalAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessExpiresAt: Date;
  scopes: string[];
  tokenVersion: number;
}

export interface IntegrationRepository {
  withJobberRefreshLock<T>(
    organizationId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  saveOAuthState(state: PendingOAuthState): Promise<void>;
  consumeOAuthState(stateHash: string, now: Date): Promise<PendingOAuthState | null>;
  upsertJobberConnection(connection: JobberConnectionCredentials): Promise<void>;
  loadActiveJobberConnection(
    organizationId: string,
  ): Promise<JobberConnectionCredentials | null>;
  rotateJobberTokens(input: {
    organizationId: string;
    expectedTokenVersion: number;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessExpiresAt: Date;
    refreshedAt: Date;
  }): Promise<boolean>;
  disconnectJobber(organizationId: string): Promise<void>;
}
