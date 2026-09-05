export const weekdays = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

export type Weekday = (typeof weekdays)[number];
export type DayPart = "ANY" | "MORNING" | "AFTERNOON" | "EVENING";

export interface LocalTimeRange {
  start: string;
  end: string;
}

export interface AvailabilityPolicy {
  timeZone: string;
  weeklyHours: Partial<Record<Weekday, LocalTimeRange[]>>;
  blackoutDates?: string[];
  minLeadMinutes: number;
  maxHorizonDays: number;
  arrivalWindowMinutes: number;
  serviceDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  capacity: number;
}

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
}

export interface AvailabilityRequest {
  policy: AvailabilityPolicy;
  busyIntervals: BusyInterval[];
  now: Date;
  preferredDate?: string;
  dayPart?: DayPart;
  limit?: number;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function dateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

function localDate(date: Date, timeZone: string): string {
  const parts = dateParts(date, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addLocalDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateTimeToUtc(
  localDateValue: string,
  localTime: string,
  timeZone: string,
): Date | null {
  const [year, month, day] = localDateValue.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const desired = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
  );
  let candidate = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = dateParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += desired - represented;
  }
  const result = new Date(candidate);
  const actual = dateParts(result, timeZone);
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== day ||
    actual.hour !== hour ||
    actual.minute !== minute
  ) {
    return null;
  }
  return result;
}

function weekdayForDate(value: string): Weekday {
  const [year, month, day] = value.split("-").map(Number);
  return weekdays[new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()]!;
}

function matchesDayPart(date: Date, timeZone: string, dayPart: DayPart): boolean {
  if (dayPart === "ANY") return true;
  const hour = dateParts(date, timeZone).hour;
  if (dayPart === "MORNING") return hour < 12;
  if (dayPart === "AFTERNOON") return hour >= 12 && hour < 17;
  return hour >= 17;
}

function overlaps(leftStart: number, leftEnd: number, right: BusyInterval): boolean {
  return leftStart < right.endsAt.getTime() && leftEnd > right.startsAt.getTime();
}

function validatePolicy(policy: AvailabilityPolicy): void {
  new Intl.DateTimeFormat("en-US", { timeZone: policy.timeZone }).format();
  requireNonNegativeInteger(policy.minLeadMinutes, "minLeadMinutes");
  requirePositiveInteger(policy.maxHorizonDays, "maxHorizonDays");
  requirePositiveInteger(policy.arrivalWindowMinutes, "arrivalWindowMinutes");
  requirePositiveInteger(policy.serviceDurationMinutes, "serviceDurationMinutes");
  requireNonNegativeInteger(policy.bufferBeforeMinutes, "bufferBeforeMinutes");
  requireNonNegativeInteger(policy.bufferAfterMinutes, "bufferAfterMinutes");
  requirePositiveInteger(policy.capacity, "capacity");
  for (const ranges of Object.values(policy.weeklyHours)) {
    for (const range of ranges ?? []) {
      if (!timePattern.test(range.start) || !timePattern.test(range.end)) {
        throw new Error("Weekly hours must use HH:mm local time");
      }
    }
  }
}

export function generateAvailableSlots(request: AvailabilityRequest): AvailableSlot[] {
  validatePolicy(request.policy);
  const limit = request.limit ?? 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) {
    throw new Error("Availability result limit must be between one and three");
  }
  if (request.preferredDate && !datePattern.test(request.preferredDate)) {
    throw new Error("preferredDate must use YYYY-MM-DD format");
  }
  for (const busy of request.busyIntervals) {
    if (busy.endsAt <= busy.startsAt) {
      throw new Error("Busy intervals must end after they start");
    }
  }

  const dayPart = request.dayPart ?? "ANY";
  const firstDate = request.preferredDate ?? localDate(request.now, request.policy.timeZone);
  const minimumStart =
    request.now.getTime() + request.policy.minLeadMinutes * 60_000;
  const maximumStart =
    request.now.getTime() + request.policy.maxHorizonDays * 24 * 60 * 60_000;
  const blackouts = new Set(request.policy.blackoutDates ?? []);
  const slots: AvailableSlot[] = [];

  for (let dayOffset = 0; dayOffset <= request.policy.maxHorizonDays; dayOffset += 1) {
    const candidateDate = addLocalDays(firstDate, dayOffset);
    if (blackouts.has(candidateDate)) continue;
    const ranges = request.policy.weeklyHours[weekdayForDate(candidateDate)] ?? [];

    for (const range of ranges) {
      const rangeStart = localDateTimeToUtc(
        candidateDate,
        range.start,
        request.policy.timeZone,
      );
      const rangeEnd = localDateTimeToUtc(
        candidateDate,
        range.end,
        request.policy.timeZone,
      );
      if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) continue;

      for (
        let startsAtMs = rangeStart.getTime();
        startsAtMs < rangeEnd.getTime();
        startsAtMs += request.policy.arrivalWindowMinutes * 60_000
      ) {
        const endsAtMs = startsAtMs + request.policy.arrivalWindowMinutes * 60_000;
        const occupiedStart =
          startsAtMs - request.policy.bufferBeforeMinutes * 60_000;
        const occupiedEnd =
          startsAtMs +
          (request.policy.serviceDurationMinutes + request.policy.bufferAfterMinutes) *
            60_000;
        if (
          startsAtMs < minimumStart ||
          startsAtMs > maximumStart ||
          endsAtMs > rangeEnd.getTime() ||
          occupiedStart < rangeStart.getTime() ||
          occupiedEnd > rangeEnd.getTime()
        ) {
          continue;
        }

        const startsAt = new Date(startsAtMs);
        if (!matchesDayPart(startsAt, request.policy.timeZone, dayPart)) continue;
        const concurrent = request.busyIntervals.filter((busy) =>
          overlaps(occupiedStart, occupiedEnd, busy),
        ).length;
        if (concurrent >= request.policy.capacity) continue;

        slots.push({ startsAt, endsAt: new Date(endsAtMs) });
        if (slots.length === limit) return slots;
      }
    }
  }
  return slots;
}
