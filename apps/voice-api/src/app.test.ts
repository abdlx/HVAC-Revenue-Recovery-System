import assert from "node:assert/strict";
import test from "node:test";
import type {
  HumanEscalationRepository,
  NormalizedVapiCallEvent,
  ServiceAreaRepository,
  VapiCallEventRepository,
} from "@hvac/domain";
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

function createAppRepositories(options?: {
  events?: NormalizedVapiCallEvent[];
  unknownCallContext?: boolean;
}) {
  const seenEvents = new Set<string>();
  const vapiCallEventRepository: VapiCallEventRepository = {
    async ingestVapiEvent(event) {
      options?.events?.push(event);
      if (options?.unknownCallContext) {
        return { status: "unknown_call_context" };
      }
      if (seenEvents.has(event.providerEventId)) {
        return { status: "duplicate", callId: "call-row-1" };
      }
      seenEvents.add(event.providerEventId);
      return { status: "accepted", callId: "call-row-1" };
    },
  };
  const humanEscalationRepository: HumanEscalationRepository = {
    async resolveAndRecordHumanRequest() {
      return {
        action: "TRANSFER",
        destination: { type: "number", value: "+16025550100" },
        notesForAgent: "Tell the caller you are transferring them now.",
      };
    },
  };

  return {
    serviceAreaRepository: createRepository(),
    vapiCallEventRepository,
    humanEscalationRepository,
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
    ...createAppRepositories(),
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
    ...createAppRepositories(),
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

test("accepts the current Vapi arguments field for tool inputs", async (t) => {
  const app = await buildApp({
    ...createAppRepositories(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/check-service-area",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          {
            id: "tool-call-arguments",
            name: "check_service_area",
            arguments: { zip_code: "85032" },
          },
        ],
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.json().results[0].result);
  assert.equal(result.serviced, true);
});

test("does not allow one tenant call to use another tenant ZIP", async (t) => {
  const app = await buildApp({
    ...createAppRepositories(),
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
    ...createAppRepositories(),
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

test("normalizes and idempotently acknowledges Vapi end-of-call events", async (t) => {
  const events: NormalizedVapiCallEvent[] = [];
  const app = await buildApp({
    ...createAppRepositories({ events }),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const payload = {
    message: {
      type: "end-of-call-report",
      timestamp: "2026-09-04T20:00:05.000Z",
      startedAt: "2026-09-04T20:00:00.000Z",
      endedAt: "2026-09-04T20:00:05.000Z",
      endedReason: "customer-ended-call",
      call: {
        id: "call-phoenix",
        assistantId: "assistant-phoenix",
        customer: { number: "+16025551234" },
      },
      artifact: { transcript: "AI: Hello. User: I need service." },
      analysis: { summary: "Caller requested HVAC service." },
    },
  };

  const first = await app.inject({
    method: "POST",
    url: "/v1/webhooks/vapi",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload,
  });
  const second = await app.inject({
    method: "POST",
    url: "/v1/webhooks/vapi",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload,
  });

  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { accepted: true, duplicate: false });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { accepted: true, duplicate: true });
  assert.equal(events.length, 2);
  assert.equal(events[0]?.vapiCallId, "call-phoenix");
  assert.equal(events[0]?.providerAssistantId, "assistant-phoenix");
  assert.equal(events[0]?.providerPhoneNumberId, null);
  assert.equal(events[0]?.callerPhoneE164, "+16025551234");
  assert.equal(events[0]?.endedAt?.toISOString(), "2026-09-04T20:00:05.000Z");
  assert.equal(events[0]?.endedReason, "customer-ended-call");
  assert.match(events[0]?.transcript ?? "", /need service/);
  assert.equal(events[0]?.providerEventId, events[1]?.providerEventId);
});

test("acknowledges but rejects Vapi events without trusted call context", async (t) => {
  const app = await buildApp({
    ...createAppRepositories({ unknownCallContext: true }),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/vapi",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "status-update",
        status: "in-progress",
        call: { id: "unknown-call", assistantId: "unknown-assistant" },
      },
    },
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), {
    accepted: false,
    reason: "unknown_call_context",
  });
});

test("returns only the server-approved human transfer destination", async (t) => {
  const app = await buildApp({
    ...createAppRepositories(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/request-human",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          {
            id: "human-tool-1",
            name: "request_human",
            parameters: {
              reason_code: "CUSTOMER_REQUESTED_HUMAN",
              priority: "NORMAL",
            },
          },
        ],
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.json().results[0].result);
  assert.deepEqual(result, {
    action: "TRANSFER",
    destination: { type: "number", value: "+16025550100" },
    notes_for_agent: "Tell the caller you are transferring them now.",
  });
});

test("rejects caller-supplied transfer destinations", async (t) => {
  const app = await buildApp({
    ...createAppRepositories(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/request-human",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          {
            id: "human-tool-1",
            name: "request_human",
            parameters: {
              reason_code: "CUSTOMER_REQUESTED_HUMAN",
              priority: "NORMAL",
              phone_number: "+15555550123",
            },
          },
        ],
      },
    },
  });

  const result = JSON.parse(response.json().results[0].result);
  assert.equal(result.error, "invalid_human_request");
  assert.equal(JSON.stringify(result).includes("+15555550123"), false);
});
