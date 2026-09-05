import assert from "node:assert/strict";
import test from "node:test";
import {
  generateAvailableSlots,
  type AvailabilityPolicy,
} from "./availability.js";

const policy: AvailabilityPolicy = {
  timeZone: "UTC",
  weeklyHours: { MONDAY: [{ start: "09:00", end: "17:00" }] },
  minLeadMinutes: 0,
  maxHorizonDays: 7,
  arrivalWindowMinutes: 120,
  serviceDurationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  capacity: 1,
};

test("subtracts busy work and returns at most three server-computed slots", () => {
  const slots = generateAvailableSlots({
    policy,
    now: new Date("2026-09-07T08:00:00.000Z"),
    preferredDate: "2026-09-07",
    busyIntervals: [
      {
        startsAt: new Date("2026-09-07T09:00:00.000Z"),
        endsAt: new Date("2026-09-07T11:00:00.000Z"),
      },
    ],
  });

  assert.deepEqual(
    slots.map((slot) => [slot.startsAt.toISOString(), slot.endsAt.toISOString()]),
    [
      ["2026-09-07T11:00:00.000Z", "2026-09-07T13:00:00.000Z"],
      ["2026-09-07T13:00:00.000Z", "2026-09-07T15:00:00.000Z"],
      ["2026-09-07T15:00:00.000Z", "2026-09-07T17:00:00.000Z"],
    ],
  );
});

test("allows overlap below configured simultaneous capacity", () => {
  const slots = generateAvailableSlots({
    policy: { ...policy, capacity: 2 },
    now: new Date("2026-09-07T08:00:00.000Z"),
    preferredDate: "2026-09-07",
    limit: 1,
    busyIntervals: [
      {
        startsAt: new Date("2026-09-07T09:00:00.000Z"),
        endsAt: new Date("2026-09-07T11:00:00.000Z"),
      },
    ],
  });
  assert.equal(slots[0]?.startsAt.toISOString(), "2026-09-07T09:00:00.000Z");
});

test("applies tenant timezone when producing UTC slots", () => {
  const slots = generateAvailableSlots({
    policy: {
      ...policy,
      timeZone: "America/Phoenix",
      weeklyHours: { SATURDAY: [{ start: "09:00", end: "13:00" }] },
    },
    now: new Date("2026-09-05T12:00:00.000Z"),
    preferredDate: "2026-09-05",
    limit: 1,
    busyIntervals: [],
  });
  assert.equal(slots[0]?.startsAt.toISOString(), "2026-09-05T16:00:00.000Z");
});

test("enforces lead time, blackout dates, and day-part preference", () => {
  const slots = generateAvailableSlots({
    policy: {
      ...policy,
      weeklyHours: {
        MONDAY: [{ start: "09:00", end: "17:00" }],
        TUESDAY: [{ start: "09:00", end: "17:00" }],
      },
      blackoutDates: ["2026-09-07"],
      minLeadMinutes: 60,
    },
    now: new Date("2026-09-07T08:30:00.000Z"),
    preferredDate: "2026-09-07",
    dayPart: "AFTERNOON",
    limit: 1,
    busyIntervals: [],
  });
  assert.equal(slots[0]?.startsAt.toISOString(), "2026-09-08T13:00:00.000Z");
});
