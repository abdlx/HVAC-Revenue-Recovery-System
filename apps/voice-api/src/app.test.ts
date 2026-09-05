import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateBooking,
  LookupCustomer,
  OfferAppointmentSlots,
  type AppointmentSlotRepository,
  type BookingAvailabilityVerifier,
  type BookingCrmWriter,
  type BookingRepository,
  type CustomerDirectory,
  type CustomerLookupRepository,
  type HumanEscalationRepository,
  type NormalizedVapiCallEvent,
  type ServiceAreaRepository,
  type VapiCallEventRepository,
  type CrmScheduleReader,
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
  const customerLookupRepository: CustomerLookupRepository = {
    async loadContext(vapiCallId) {
      return vapiCallId === "call-phoenix"
        ? {
            callId: "call-row-phoenix",
            organizationId: "org-phoenix",
            callerPhoneE164: "+16025551234",
          }
        : null;
    },
    async saveMatch(context, match) {
      assert.equal(context.organizationId, "org-phoenix");
      assert.equal(match.externalCustomerId, "jobber-client-1");
      return {
        customerRef: "5fe923dc-abf0-45d1-b634-c42e0e346cec",
        properties: [
          {
            propertyRef: "8370b4d6-e7b1-4183-8222-00ebd616fca4",
            addressSummary: "123 Test Avenue, Phoenix, AZ 85032",
          },
        ],
      };
    },
  };
  const customerDirectory: CustomerDirectory = {
    async findByPhone(input) {
      assert.deepEqual(input, {
        organizationId: "org-phoenix",
        phoneE164: "+16025551234",
      });
      return {
        externalCustomerId: "jobber-client-1",
        displayName: "Jane Doe",
        properties: [
          {
            externalPropertyId: "jobber-property-1",
            address1: "123 Test Avenue",
            city: "Phoenix",
            state: "AZ",
            postalCode: "85032",
            addressSummary: "123 Test Avenue, Phoenix, AZ 85032",
          },
        ],
      };
    },
  };

  return {
    serviceAreaRepository: createRepository(),
    vapiCallEventRepository,
    humanEscalationRepository,
    customerLookup: new LookupCustomer(
      customerLookupRepository,
      customerDirectory,
    ),
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

function createAppointmentServices() {
  const slotToken = `slot_${"a".repeat(32)}`;
  const propertyRef = "8370b4d6-e7b1-4183-8222-00ebd616fca4";
  const customerRef = "5fe923dc-abf0-45d1-b634-c42e0e346cec";
  const appointmentRepository: AppointmentSlotRepository = {
    async loadAvailabilityContext(input) {
      assert.deepEqual(input, {
        vapiCallId: "call-phoenix",
        serviceCode: "AC_REPAIR",
        propertyRef,
        preferredDate: "2026-09-06",
        dayPart: "MORNING",
      });
      return {
        organizationId: "org-phoenix",
        callId: "call-row-phoenix",
        serviceId: "service-1",
        propertyId: propertyRef,
        policy: {
          timeZone: "UTC",
          weeklyHours: { SUNDAY: [{ start: "09:00", end: "12:00" }] },
          blackoutDates: [],
          minLeadMinutes: 0,
          maxHorizonDays: 7,
          arrivalWindowMinutes: 60,
          serviceDurationMinutes: 60,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          capacity: 1,
        },
      };
    },
    async replaceOffers(_context, offers) {
      assert.equal(offers.length, 3);
      assert.doesNotMatch(JSON.stringify(offers), /slot_aaaa/);
    },
  };
  const schedule: CrmScheduleReader = {
    async getBusyIntervals() {
      return [];
    },
  };
  const appointmentSlots = new OfferAppointmentSlots(
    appointmentRepository,
    schedule,
    () => new Date("2026-09-05T12:00:00.000Z"),
    () => slotToken,
  );

  const bookingRepository: BookingRepository = {
    async begin(request) {
      assert.equal(request.vapiCallId, "call-phoenix");
      assert.equal(request.toolCallId, "booking-tool-1");
      return {
        status: "completed",
        result: {
          status: "confirmed",
          bookingId: "3e9aa9fe-c90a-4720-98dd-fef358545d23",
          crmBookingId: "jobber-job-1",
          startsAt: "2026-09-06T09:00:00.000Z",
          endsAt: "2026-09-06T10:00:00.000Z",
        },
      };
    },
    async complete() {},
    async fail() {},
  };
  const availability: BookingAvailabilityVerifier = {
    async isStillAvailable() {
      throw new Error("completed idempotency replay must not re-check availability");
    },
  };
  const crm: BookingCrmWriter = {
    async createBooking() {
      throw new Error("completed idempotency replay must not mutate CRM");
    },
  };
  const createBooking = new CreateBooking(bookingRepository, availability, crm);

  return { appointmentSlots, createBooking, customerRef, propertyRef, slotToken };
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

test("looks up a customer from trusted call identity and returns only local refs", async (t) => {
  const app = await buildApp({
    ...createAppRepositories(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/lookup-customer",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          { id: "lookup-tool-1", name: "lookup_customer", parameters: {} },
        ],
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.json().results[0].result);
  assert.deepEqual(result, {
    status: "found",
    customer_ref: "5fe923dc-abf0-45d1-b634-c42e0e346cec",
    display_name: "Jane Doe",
    properties: [
      {
        property_ref: "8370b4d6-e7b1-4183-8222-00ebd616fca4",
        address: "123 Test Avenue, Phoenix, AZ 85032",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /jobber-/);
});

test("rejects caller-supplied identity in customer lookup", async (t) => {
  const app = await buildApp({
    ...createAppRepositories(),
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/lookup-customer",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          {
            id: "lookup-tool-1",
            name: "lookup_customer",
            parameters: { phone: "+15555550123", organization_id: "other" },
          },
        ],
      },
    },
  });

  const result = JSON.parse(response.json().results[0].result);
  assert.equal(result.error, "invalid_customer_lookup");
  assert.doesNotMatch(JSON.stringify(result), /15555550123|other/);
});

test("returns server-computed appointment slots through the authenticated tool", async (t) => {
  const appointment = createAppointmentServices();
  const app = await buildApp({
    ...createAppRepositories(),
    appointmentSlots: appointment.appointmentSlots,
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/get-available-slots",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          {
            id: "slots-tool-1",
            name: "get_available_slots",
            parameters: {
              service_code: "AC_REPAIR",
              property_ref: appointment.propertyRef,
              preferred_date: "2026-09-06",
              day_part: "MORNING",
            },
          },
        ],
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.json().results[0].result);
  assert.equal(result.status, "available");
  assert.equal(result.slots.length, 3);
  assert.equal(result.slots[0].slotToken, appointment.slotToken);
});

test("passes Vapi call and tool ids into the exactly-once booking boundary", async (t) => {
  const appointment = createAppointmentServices();
  const app = await buildApp({
    ...createAppRepositories(),
    createBooking: appointment.createBooking,
    vapiServerToken: TOKEN,
    logger: false,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/vapi/tools/create-booking",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "call-phoenix" },
        toolCallList: [
          {
            id: "booking-tool-1",
            name: "create_booking",
            parameters: {
              slot_token: appointment.slotToken,
              customer_ref: appointment.customerRef,
              property_ref: appointment.propertyRef,
              service_code: "AC_REPAIR",
              caller_confirmed: true,
              summary: "AC is running but not cooling.",
            },
          },
        ],
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.json().results[0].result);
  assert.equal(result.status, "confirmed");
  assert.equal(result.bookingId, "3e9aa9fe-c90a-4720-98dd-fef358545d23");
});
