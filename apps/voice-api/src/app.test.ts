import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceAreaRepository } from "@hvac/domain";
import { buildApp } from "./app.js";

const TOKEN = "test-token-that-is-at-least-thirty-two-characters";

function createRepository(): ServiceAreaRepository {
  const callOrganizations = new Map([
    ["call-phoenix", "org-phoenix"],
    ["call-denver", "org-denver"],
  ]);
  const areas = new Set(["org-phoenix:85032", "org-denver:80202"]);

  return {
    async findActiveZipForCall(callId, zipCode) {
      const organizationId = callOrganizations.get(callId);
      if (!organizationId || !areas.has(`${organizationId}:${zipCode}`)) {
        return null;
      }
      return { serviceZone: `${organizationId}-primary`, notesForAgent: null };
    },
    async ping() {
      return true;
    },
  };
}

function requestBody(callId: string, parameters: Record<string, unknown>) {
  return {
    message: {
      type: "tool-calls",
      call: { id: callId },
      toolCallList: [
        { id: "tool-call-1", name: "check_service_area", parameters },
      ],
    },
  };
}

test("rejects tool calls without the configured Vapi bearer token", async (t) => {
  const app = await buildApp({
    repository: createRepository(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/check-service-area",
    payload: requestBody("call-phoenix", { zip_code: "85032" }),
  });

  assert.equal(response.statusCode, 401);
});

test("resolves service area from trusted call context", async (t) => {
  const app = await buildApp({
    repository: createRepository(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/check-service-area",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: requestBody("call-phoenix", { zip_code: "85032" }),
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const result = JSON.parse(body.results[0].result);
  assert.deepEqual(result, {
    serviced: true,
    service_zone: "org-phoenix-primary",
    notes_for_agent: null,
  });
  assert.equal(JSON.stringify(body).includes("organization_id"), false);
});

test("does not allow one tenant call to use another tenant ZIP", async (t) => {
  const app = await buildApp({
    repository: createRepository(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/check-service-area",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: requestBody("call-denver", { zip_code: "85032" }),
  });

  const body = response.json();
  const result = JSON.parse(body.results[0].result);
  assert.equal(result.serviced, false);
});

test("rejects organization IDs smuggled into model arguments", async (t) => {
  const app = await buildApp({
    repository: createRepository(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/check-service-area",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: requestBody("call-denver", {
      zip_code: "85032",
      organization_id: "org-phoenix",
    }),
  });

  const body = response.json();
  const result = JSON.parse(body.results[0].result);
  assert.equal(result.serviced, false);
  assert.match(result.notes_for_agent, /five-digit ZIP/i);
});
