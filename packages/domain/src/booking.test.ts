import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateBooking,
  type BeginBookingResult,
  type BookingContext,
  type BookingRepository,
} from "./booking.js";

const context: BookingContext = {
  idempotencyKey: "booking:organization-1:call-1:tool-1",
  organizationId: "organization-1",
  localBookingId: "booking-1",
  appointmentSlotId: "slot-1",
  externalCustomerId: "customer-1",
  externalPropertyId: "property-1",
  serviceCode: "AC_REPAIR",
  capacity: 1,
  startsAt: new Date("2026-09-07T11:00:00.000Z"),
  endsAt: new Date("2026-09-07T13:00:00.000Z"),
  summary: "AC is not cooling",
};

function harness(beginResult: BeginBookingResult = { status: "acquired", context }) {
  const calls: string[] = [];
  const repository: BookingRepository = {
    async begin() {
      calls.push("begin");
      return beginResult;
    },
    async complete() {
      calls.push("complete");
    },
    async fail(_context, code) {
      calls.push(`fail:${code}`);
    },
  };
  const service = new CreateBooking(
    repository,
    {
      async isStillAvailable() {
        calls.push("availability");
        return true;
      },
    },
    {
      async createBooking() {
        calls.push("crm");
        return { crmBookingId: "jobber-job-1" };
      },
    },
    () => new Date("2026-09-05T12:00:00.000Z"),
  );
  return { service, calls };
}

const request = {
  vapiCallId: "call-1",
  toolCallId: "tool-1",
  slotToken: "slot_secret",
  customerRef: "customer-ref",
  propertyRef: "property-ref",
  serviceCode: "AC_REPAIR",
  callerConfirmed: true,
  summary: "AC is not cooling",
};

test("requires explicit caller confirmation before acquiring idempotency", async () => {
  const { service, calls } = harness();
  assert.deepEqual(
    await service.execute({ ...request, callerConfirmed: false }),
    { status: "confirmation_required" },
  );
  assert.deepEqual(calls, []);
});

test("creates and persists a confirmed booking after availability re-check", async () => {
  const { service, calls } = harness();
  const result = await service.execute(request);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(calls, ["begin", "availability", "crm", "complete"]);
});

test("returns a stored completed result without another CRM mutation", async () => {
  const stored = {
    status: "confirmed" as const,
    bookingId: "booking-1",
    crmBookingId: "jobber-job-1",
    startsAt: context.startsAt.toISOString(),
    endsAt: context.endsAt.toISOString(),
  };
  const { service, calls } = harness({ status: "completed", result: stored });
  assert.deepEqual(await service.execute(request), stored);
  assert.deepEqual(calls, ["begin"]);
});

test("fails closed and records an uncertain CRM result", async () => {
  const setup = harness();
  const failingService = new CreateBooking(
    {
      async begin() {
        setup.calls.push("begin");
        return { status: "acquired", context };
      },
      async complete() {
        setup.calls.push("complete");
      },
      async fail(_context, code) {
        setup.calls.push(`fail:${code}`);
      },
    },
    { async isStillAvailable() { return true; } },
    { async createBooking() { throw new Error("timeout"); } },
  );
  assert.deepEqual(await failingService.execute(request), {
    status: "failed",
    reason: "CRM_BOOKING_UNCERTAIN",
  });
  assert.deepEqual(setup.calls, ["begin", "fail:CRM_BOOKING_UNCERTAIN"]);
});
