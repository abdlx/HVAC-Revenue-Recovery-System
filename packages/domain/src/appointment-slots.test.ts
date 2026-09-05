import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OfferAppointmentSlots,
  type AppointmentAvailabilityContext,
  type AppointmentSlotRepository,
  type SlotOfferToPersist,
} from "./appointment-slots.js";

const context: AppointmentAvailabilityContext = {
  organizationId: "organization-1",
  callId: "call-1",
  serviceId: "service-1",
  propertyId: "property-1",
  policy: {
    timeZone: "UTC",
    weeklyHours: { MONDAY: [{ start: "09:00", end: "15:00" }] },
    minLeadMinutes: 0,
    maxHorizonDays: 7,
    arrivalWindowMinutes: 120,
    serviceDurationMinutes: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    capacity: 1,
  },
};

test("issues opaque slot tokens and persists only their hashes", async () => {
  let persisted: SlotOfferToPersist[] = [];
  const repository: AppointmentSlotRepository = {
    async loadAvailabilityContext() {
      return context;
    },
    async replaceOffers(_context, offers) {
      persisted = offers;
    },
  };
  let sequence = 0;
  const service = new OfferAppointmentSlots(
    repository,
    { async getBusyIntervals() { return []; } },
    () => new Date("2026-09-07T08:00:00.000Z"),
    () => `slot_test_${++sequence}`,
  );

  const result = await service.execute({
    vapiCallId: "call-1",
    serviceCode: "AC_REPAIR",
    propertyRef: "property-1",
    preferredDate: "2026-09-07",
  });
  assert.equal(result.status, "available");
  assert.ok(result.status === "available");
  assert.equal(result.slots.length, 3);
  assert.equal(result.slots[0]?.slotToken, "slot_test_1");
  assert.equal(
    persisted[0]?.tokenHash,
    createHash("sha256").update("slot_test_1").digest("hex"),
  );
  assert.equal(JSON.stringify(persisted).includes("slot_test_1"), false);
});

test("fails closed without writing slots when CRM schedule is unavailable", async () => {
  let writes = 0;
  const service = new OfferAppointmentSlots(
    {
      async loadAvailabilityContext() { return context; },
      async replaceOffers() { writes += 1; },
    },
    { async getBusyIntervals() { throw new Error("Jobber down"); } },
  );
  assert.deepEqual(
    await service.execute({
      vapiCallId: "call-1",
      serviceCode: "AC_REPAIR",
      propertyRef: "property-1",
    }),
    { status: "unavailable", reason: "CRM_UNAVAILABLE" },
  );
  assert.equal(writes, 0);
});
