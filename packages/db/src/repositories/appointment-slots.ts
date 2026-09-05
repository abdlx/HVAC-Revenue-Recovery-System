import type {
  AppointmentAvailabilityContext,
  AppointmentSlotRepository,
  LocalTimeRange,
  SlotOfferToPersist,
  Weekday,
} from "@hvac/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  appointmentSlots,
  bookingRules,
  calls,
  organizations,
  properties,
  services,
} from "../schema/index.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const weekdayNames = new Set<Weekday>([
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
]);

function parseWeeklyHours(value: unknown): Partial<Record<Weekday, LocalTimeRange[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("booking rules require a weeklyHours object");
  }
  const result: Partial<Record<Weekday, LocalTimeRange[]>> = {};
  for (const [day, ranges] of Object.entries(value)) {
    if (!weekdayNames.has(day as Weekday) || !Array.isArray(ranges)) {
      throw new Error("booking rules contain invalid weekly hours");
    }
    result[day as Weekday] = ranges.map((range) => {
      if (
        !range ||
        typeof range !== "object" ||
        Array.isArray(range) ||
        typeof (range as Record<string, unknown>).start !== "string" ||
        typeof (range as Record<string, unknown>).end !== "string"
      ) {
        throw new Error("booking rules contain an invalid time range");
      }
      return {
        start: (range as Record<string, string>).start!,
        end: (range as Record<string, string>).end!,
      };
    });
  }
  return result;
}

function parseBlackoutDates(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("booking rules blackoutDates must be a string array");
  }
  return value as string[];
}

export class PostgresAppointmentSlotRepository
  implements AppointmentSlotRepository
{
  constructor(private readonly db: Database) {}

  async loadAvailabilityContext(input: {
    vapiCallId: string;
    serviceCode: string;
    propertyRef: string;
  }): Promise<AppointmentAvailabilityContext | null> {
    if (!uuidPattern.test(input.propertyRef)) return null;
    const [call] = await this.db
      .select({ id: calls.id, organizationId: calls.organizationId })
      .from(calls)
      .where(eq(calls.vapiCallId, input.vapiCallId))
      .limit(1);
    if (!call) return null;

    const [service] = await this.db
      .select({
        id: services.id,
        duration: services.defaultDurationMinutes,
        minLeadMinutes: bookingRules.minLeadMinutes,
        maxHorizonDays: bookingRules.maxHorizonDays,
        arrivalWindowMinutes: bookingRules.arrivalWindowMinutes,
        bufferBeforeMinutes: bookingRules.bufferBeforeMinutes,
        bufferAfterMinutes: bookingRules.bufferAfterMinutes,
        capacity: bookingRules.capacity,
        rulesJson: bookingRules.rulesJson,
        timeZone: organizations.timezone,
      })
      .from(services)
      .innerJoin(bookingRules, eq(bookingRules.serviceId, services.id))
      .innerJoin(organizations, eq(organizations.id, services.organizationId))
      .where(
        and(
          eq(services.organizationId, call.organizationId),
          eq(services.code, input.serviceCode),
          eq(services.active, true),
          eq(services.bookingEnabled, true),
          eq(services.requiresHuman, false),
          eq(bookingRules.organizationId, call.organizationId),
        ),
      )
      .limit(1);
    if (!service) return null;

    const [property] = await this.db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.id, input.propertyRef),
          eq(properties.organizationId, call.organizationId),
        ),
      )
      .limit(1);
    if (!property) return null;

    return {
      organizationId: call.organizationId,
      callId: call.id,
      serviceId: service.id,
      propertyId: property.id,
      policy: {
        timeZone: service.timeZone,
        weeklyHours: parseWeeklyHours(service.rulesJson.weeklyHours),
        blackoutDates: parseBlackoutDates(service.rulesJson.blackoutDates),
        minLeadMinutes: service.minLeadMinutes,
        maxHorizonDays: service.maxHorizonDays,
        arrivalWindowMinutes: service.arrivalWindowMinutes,
        serviceDurationMinutes: service.duration,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        capacity: service.capacity,
      },
    };
  }

  async replaceOffers(
    context: AppointmentAvailabilityContext,
    offers: SlotOfferToPersist[],
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [trusted] = await transaction
        .select({ callId: calls.id })
        .from(calls)
        .innerJoin(
          services,
          and(
            eq(services.id, context.serviceId),
            eq(services.organizationId, calls.organizationId),
          ),
        )
        .innerJoin(
          properties,
          and(
            eq(properties.id, context.propertyId),
            eq(properties.organizationId, calls.organizationId),
          ),
        )
        .where(
          and(
            eq(calls.id, context.callId),
            eq(calls.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!trusted) throw new Error("Appointment slot context is no longer valid");

      await transaction
        .update(appointmentSlots)
        .set({ status: "INVALIDATED" })
        .where(
          and(
            eq(appointmentSlots.callId, context.callId),
            eq(appointmentSlots.serviceId, context.serviceId),
            eq(appointmentSlots.status, "OFFERED"),
          ),
        );
      await transaction.insert(appointmentSlots).values(
        offers.map((offer) => ({
          organizationId: context.organizationId,
          callId: context.callId,
          serviceId: context.serviceId,
          propertyId: context.propertyId,
          startsAt: offer.startsAt,
          endsAt: offer.endsAt,
          expiresAt: offer.expiresAt,
          slotTokenHash: offer.tokenHash,
        })),
      );
    });
  }
}
