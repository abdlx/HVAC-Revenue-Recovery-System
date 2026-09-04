const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";

export interface JobberGraphqlClientOptions {
  apiVersion: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class JobberGraphqlError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "JobberGraphqlError";
  }
}

export class JobberGraphqlClient {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: JobberGraphqlClientOptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.apiVersion)) {
      throw new Error("Jobber apiVersion must use YYYY-MM-DD format");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async request<T>(input: {
    accessToken: string;
    query: string;
    variables?: Record<string, unknown>;
  }): Promise<T> {
    if (!input.accessToken.trim()) throw new Error("accessToken is required");
    if (!input.query.trim()) throw new Error("query is required");

    const response = await this.fetch(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "X-JOBBER-GRAPHQL-VERSION": this.options.apiVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        variables: input.variables ?? {},
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new JobberGraphqlError(
        `Jobber GraphQL request failed with status ${response.status}`,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message?: unknown }>;
    };
    if (payload.errors?.length) {
      const messages = payload.errors
        .map((error) =>
          typeof error.message === "string" ? error.message.slice(0, 200) : "Unknown error",
        )
        .join("; ");
      throw new JobberGraphqlError(`Jobber GraphQL error: ${messages}`, 502);
    }
    if (payload.data === undefined) {
      throw new JobberGraphqlError("Jobber returned no GraphQL data", 502);
    }
    return payload.data;
  }
}
