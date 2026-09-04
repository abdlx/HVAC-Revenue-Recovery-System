import { createHash, randomBytes } from "node:crypto";

const JOBBER_AUTHORIZATION_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

export interface JobberOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

export interface JobberAuthorizationRequest {
  authorizationUrl: string;
  state: string;
  stateHash: string;
  codeVerifier: string;
  expiresAt: Date;
}

export interface JobberTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresAt: Date;
}

export class JobberOAuthError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "JobberOAuthError";
  }
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function requiredValue(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value;
}

export function createJobberAuthorizationRequest(input: {
  clientId: string;
  redirectUri: string;
  now?: Date;
  state?: string;
  codeVerifier?: string;
}): JobberAuthorizationRequest {
  const state = input.state ?? randomBytes(32).toString("base64url");
  const codeVerifier = input.codeVerifier ?? randomBytes(64).toString("base64url");
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    throw new Error("PKCE code verifier must contain 43 to 128 characters");
  }

  const url = new URL(JOBBER_AUTHORIZATION_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requiredValue(input.clientId, "clientId"));
  url.searchParams.set("redirect_uri", requiredValue(input.redirectUri, "redirectUri"));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", sha256Base64Url(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return {
    authorizationUrl: url.toString(),
    state,
    stateHash: sha256Base64Url(state),
    codeVerifier,
    expiresAt: new Date((input.now ?? new Date()).getTime() + 10 * 60_000),
  };
}

export class JobberOAuthClient {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: JobberOAuthOptions) {
    requiredValue(options.clientId, "clientId");
    requiredValue(options.clientSecret, "clientSecret");
    requiredValue(options.redirectUri, "redirectUri");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.now = options.now ?? (() => new Date());
  }

  exchangeCode(code: string, codeVerifier: string): Promise<JobberTokens> {
    return this.request({
      grant_type: "authorization_code",
      code: requiredValue(code, "code"),
      redirect_uri: this.options.redirectUri,
      code_verifier: requiredValue(codeVerifier, "codeVerifier"),
    });
  }

  refresh(refreshToken: string): Promise<JobberTokens> {
    return this.request({
      grant_type: "refresh_token",
      refresh_token: requiredValue(refreshToken, "refreshToken"),
    });
  }

  private async request(parameters: Record<string, string>): Promise<JobberTokens> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      ...parameters,
    });
    const response = await this.fetch(JOBBER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new JobberOAuthError(
        `Jobber OAuth request failed with status ${response.status}`,
        response.status,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (
      typeof payload.access_token !== "string" ||
      typeof payload.refresh_token !== "string" ||
      typeof payload.expires_in !== "number" ||
      payload.expires_in <= 0
    ) {
      throw new JobberOAuthError("Jobber returned an invalid token response", 502);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: "Bearer",
      expiresAt: new Date(this.now().getTime() + payload.expires_in * 1_000),
    };
  }
}
