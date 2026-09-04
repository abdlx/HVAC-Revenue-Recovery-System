import { createHash } from "node:crypto";
import type { IntegrationRepository } from "../integration-repository.js";
import type { CredentialCipher } from "../token-cipher.js";
import type { JobberGraphqlClient } from "./client.js";
import {
  createJobberAuthorizationRequest,
  type JobberOAuthClient,
} from "./oauth.js";

const ACCOUNT_QUERY = `query HvacRecoveryAccount {
  account {
    id
    name
  }
}`;

export interface JobberAuthorizationServiceOptions {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  now?: () => Date;
}

export class InvalidJobberOAuthStateError extends Error {
  constructor() {
    super("Jobber OAuth state is invalid, expired, or already used");
    this.name = "InvalidJobberOAuthStateError";
  }
}

export class JobberAuthorizationService {
  private readonly now: () => Date;

  constructor(
    private readonly oauthClient: JobberOAuthClient,
    private readonly graphqlClient: JobberGraphqlClient,
    private readonly repository: IntegrationRepository,
    private readonly cipher: CredentialCipher,
    private readonly options: JobberAuthorizationServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async begin(organizationId: string): Promise<{ authorizationUrl: string }> {
    const request = createJobberAuthorizationRequest({
      clientId: this.options.clientId,
      redirectUri: this.options.redirectUri,
      now: this.now(),
    });
    await this.repository.saveOAuthState({
      stateHash: request.stateHash,
      organizationId,
      codeVerifierEncrypted: this.cipher.encrypt(request.codeVerifier),
      redirectUri: this.options.redirectUri,
      expiresAt: request.expiresAt,
    });
    return { authorizationUrl: request.authorizationUrl };
  }

  async complete(input: { state: string; code: string }): Promise<{
    organizationId: string;
    externalAccountId: string;
    accountName: string;
  }> {
    const stateHash = createHash("sha256").update(input.state).digest("base64url");
    const state = await this.repository.consumeOAuthState(stateHash, this.now());
    if (!state || state.redirectUri !== this.options.redirectUri) {
      throw new InvalidJobberOAuthStateError();
    }

    const tokens = await this.oauthClient.exchangeCode(
      input.code,
      this.cipher.decrypt(state.codeVerifierEncrypted),
    );
    const account = await this.graphqlClient.request<{
      account: { id: string; name: string };
    }>({
      accessToken: tokens.accessToken,
      query: ACCOUNT_QUERY,
    });
    if (!account.account?.id || !account.account.name) {
      throw new Error("Jobber returned an invalid account context");
    }

    await this.repository.upsertJobberConnection({
      organizationId: state.organizationId,
      externalAccountId: account.account.id,
      accessTokenEncrypted: this.cipher.encrypt(tokens.accessToken),
      refreshTokenEncrypted: this.cipher.encrypt(tokens.refreshToken),
      accessExpiresAt: tokens.expiresAt,
      scopes: [...this.options.scopes],
      tokenVersion: 1,
    });
    return {
      organizationId: state.organizationId,
      externalAccountId: account.account.id,
      accountName: account.account.name,
    };
  }
}
