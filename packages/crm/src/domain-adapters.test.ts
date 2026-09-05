import assert from "node:assert/strict";
import test from "node:test";
import type { BookingContext } from "@hvac/domain";
import {
  CrmBookingGateway,
  CrmCustomerDirectory,
  CrmScheduleReader,
} from "./domain-adapters.js";
import type { CrmProvider } from "./provider.js";

const context: BookingContext = {
  idempotencyKey: "booking:org-1:call-1:tool-1",
  organizationId: "org-1",
  localBookingId: "booking-1",
  appointmentSlotId: "slot-1",
  externalCustomerId: "client-1",
  externalPropertyId: "property-1",
  serviceCode: "AC_REPAIR",
  capacity: 2,
  startsAt: new Date("2026-09-07T09:00:00.000Z"),
  endsAt: new Date("2026-09-07T10:00:00.000Z"),
  summary: "AC is running but not cooling.",
};

function provider(blocks: Array<{ externalId: string; startsAt: Date; endsAt: Date }> = []) {
  const calls: string[] = [];
  const crm: CrmProvider = {
    async getAccountContext() {
      return { externalAccountId: "account-1", name: "Test HVAC" };
    },
    async findCustomerByPhone(input) {
      calls.push(`customer:${input.organizationId}:${input.phoneE164}`);
      return {
        externalCustomerId: "client-1",
        displayName: "Jane Doe",
        properties: [],
      };
    },
    async getSchedule(input) {
      calls.push(
        `schedule:${input.organizationId}:${input.startsAt.toISOString()}:${input.endsAt.toISOString()}`,
      );
      return blocks;
    },
    async createBooking(input) {
      calls.push(`create:${JSON.stringify(input)}`);
      return { externalBookingId: "job-1" };
    },
    async getBooking() {
      return null;
    },
  };
  return { crm, calls };
}

test("adapts CRM customer matches and schedule blocks to domain ports", async () => {
  const setup = provider([
    {
      externalId: "visit-1",
      startsAt: new Date("2026-09-07T09:00:00.000Z"),
      endsAt: new Date("2026-09-07T10:00:00.000Z"),
    },
  ]);
  const customer = await new CrmCustomerDirectory(setup.crm).findByPhone({
    organizationId: "org-1",
    phoneE164: "+16025551234",
  });
  const schedule = await new CrmScheduleReader(setup.crm).getBusyIntervals({
    organizationId: "org-1",
    startsAt: context.startsAt,
    endsAt: context.endsAt,
  });

  assert.equal(customer?.externalCustomerId, "client-1");
  assert.deepEqual(schedule, [
    { startsAt: context.startsAt, endsAt: context.endsAt },
  ]);
});

test("re-checks capacity and maps confirmed booking fields to the CRM", async () => {
  const setup = provider([
    {
      externalId: "visit-1",
      startsAt: context.startsAt,
      endsAt: context.endsAt,
    },
  ]);
  const gateway = new CrmBookingGateway(setup.crm);
  assert.equal(await gateway.isStillAvailable(context), true);
  assert.deepEqual(await gateway.createBooking(context), { crmBookingId: "job-1" });
  assert.match(setup.calls.at(-1) ?? "", /"title":"AC_REPAIR"/);
  assert.match(setup.calls.at(-1) ?? "", /not cooling/);

  const full = provider([
    {
      externalId: "visit-1",
      startsAt: context.startsAt,
      endsAt: context.endsAt,
    },
    {
      externalId: "visit-2",
      startsAt: context.startsAt,
      endsAt: context.endsAt,
    },
  ]);
  assert.equal(await new CrmBookingGateway(full.crm).isStillAvailable(context), false);
});
