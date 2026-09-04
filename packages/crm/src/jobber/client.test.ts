import assert from "node:assert/strict";
import test from "node:test";
import { JobberGraphqlClient, JobberGraphqlError } from "./client.js";

test("sends authenticated, versioned Jobber GraphQL requests", async () => {
  const requests: RequestInit[] = [];
  const client = new JobberGraphqlClient({
    apiVersion: "2025-04-16",
    fetch: async (_input, init) => {
      requests.push(init ?? {});
      return Response.json({ data: { account: { id: "account-1" } } });
    },
  });

  const data = await client.request<{ account: { id: string } }>({
    accessToken: "access-1",
    query: "query Account { account { id } }",
  });

  assert.equal(data.account.id, "account-1");
  const headers = requests[0]?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer access-1");
  assert.equal(headers["X-JOBBER-GRAPHQL-VERSION"], "2025-04-16");
});

test("surfaces GraphQL errors without returning partial data", async () => {
  const client = new JobberGraphqlClient({
    apiVersion: "2025-04-16",
    fetch: async () =>
      Response.json({
        data: { account: null },
        errors: [{ message: "Scope is missing" }],
      }),
  });

  await assert.rejects(
    client.request({ accessToken: "access-1", query: "query { account { id } }" }),
    (error: unknown) =>
      error instanceof JobberGraphqlError && error.message.includes("Scope is missing"),
  );
});
