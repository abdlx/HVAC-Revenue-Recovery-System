import { createHash } from "node:crypto";
import type {
  BeginBookingResult,
  BookingContext,
  BookingRepository,
  ConfirmedBookingResult,
  CreateBookingRequest,
} from "@hvac/domain";
import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  appointmentSlots,
  bookingRules,
  bookings,
  calls,
  customers,
  idempotencyKeys,
  properties,
  services,
} from "../schema/index.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function completedResult(value: unknown): ConfirmedBookingResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return result.status === "confirmed" &&
    typeof result.bookingId === "string" &&
    typeof result.crmBookingId === "string" &&
    typeof result.startsAt === "string" &&
    typeof result.endsAt === "string"
    ? {
        status: "confirmed",
        bookingId: result.bookingId,
        crmBookingId: result.crmBookingId,
        startsAt: result.startsAt,
        endsAt: result.endsAt,
      }
    : null;
}

function replayResult(existing: {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  responseJson: Record<string, unknown> | null;
  failureCode: string | null;
}, requestHash: string): BeginBookingResult {
  if (existing.requestHash !== requestHash) {
    return { status: "rejected", reason: "REQUEST_MISMATCH" };
  }
  if (existing.status === "PROCESSING") return { status: "in_progress" };
  if (existing.status === "FAILED") {
    return { status: "failed", failureCode: existing.failureCode ?? "BOOKING_FAILED" };
  }
  const result = completedResult(existing.responseJson);
  return result
    ? { status: "completed", result }
    : { status: "failed", failureCode: "IDEMPOTENCY_RESULT_INVALID" };
}

export class PostgresBookingRepository implements BookingRepository {
  constructor(private readonly db: Database) {}

  async begin(
    request: CreateBookingRequest,
    requestHash: string,
    now: Date,
  ): Promise<BeginBookingResult> {
    return this.db.transaction(async (transaction) => {
      const [call] = await transaction
        .select({ id: calls.id, organizationId: calls.organizationId })
        .from(calls)
        .where(eq(calls.vapiCallId, request.vapiCallId))
        .limit(1);
      if (!call) return { status: "rejected", reason: "UNKNOWN_CALL" };

      const idempotencyKey = `booking:${call.organizationId}:${request.vapiCallId}:${request.toolCallId}`;
      const [existing] = await transaction
        .select({
          requestHash: idempotencyKeys.requestHash,
          status: idempotencyKeys.status,
          responseJson: idempotencyKeys.responseJson,
          failureCode: idempotencyKeys.failureCode,
        })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1);
      if (existing) return replayResult(existing, requestHash);

      if (!uuidPattern.test(request.customerRef)) {
        return { status: "rejected", reason: "INVALID_CUSTOMER" };
      }
      if (!uuidPattern.test(request.propertyRef)) {
        return { status: "rejected", reason: "INVALID_PROPERTY" };
      }

      const slotTokenHash = createHash("sha256")
        .update(request.slotToken)
        .digest("hex");
      const [slot] = await transaction
        .select({
          id: appointmentSlots.id,
          status: appointmentSlots.status,
          expiresAt: appointmentSlots.expiresAt,
          startsAt: appointmentSlots.startsAt,
          endsAt: appointmentSlots.endsAt,
          propertyId: appointmentSlots.propertyId,
          serviceId: appointmentSlots.serviceId,
          serviceCode: services.code,
          serviceActive: services.active,
          bookingEnabled: services.bookingEnabled,
          requiresHuman: services.requiresHuman,
          estimatedValue: services.estimatedTicketValue,
          capacity: bookingRules.capacity,
        })
        .from(appointmentSlots)
        .innerJoin(services, eq(services.id, appointmentSlots.serviceId))
        .innerJoin(
          bookingRules,
          and(
            eq(bookingRules.serviceId, services.id),
            eq(bookingRules.organizationId, appointmentSlots.organizationId),
          ),
        )
        .where(
          and(
            eq(appointmentSlots.slotTokenHash, slotTokenHash),
            eq(appointmentSlots.callId, call.id),
            eq(appointmentSlots.organizationId, call.organizationId),
          ),
        )
        .limit(1);
      if (!slot) return { status: "rejected", reason: "INVALID_SLOT" };
      if (slot.expiresAt <= now) return { status: "rejected", reason: "EXPIRED_SLOT" };
      if (slot.status !== "OFFERED") {
        return { status: "rejected", reason: "SLOT_UNAVAILABLE" };
      }
      if (
        slot.serviceCode !== request.serviceCode ||
        !slot.serviceActive ||
        !slot.bookingEnabled ||
        slot.requiresHuman
      ) {
        return { status: "rejected", reason: "INVALID_SERVICE" };
      }
      if (slot.propertyId !== request.propertyRef) {
        return { status: "rejected", reason: "INVALID_PROPERTY" };
      }

      const [property] = await transaction
        .select({
          externalPropertyId: properties.crmPropertyId,
          customerId: properties.customerId,
          externalCustomerId: customers.crmCustomerId,
        })
        .from(properties)
        .innerJoin(customers, eq(customers.id, properties.customerId))
        .where(
          and(
            eq(properties.id, request.propertyRef),
            eq(properties.organizationId, call.organizationId),
            eq(customers.organizationId, call.organizationId),
          ),
        )
        .limit(1);
      if (!property) return { status: "rejected", reason: "INVALID_PROPERTY" };
      if (property.customerId !== request.customerRef) {
        return { status: "rejected", reason: "INVALID_CUSTOMER" };
      }

      const [lock] = await transaction
        .insert(idempotencyKeys)
        .values({
          key: idempotencyKey,
          organizationId: call.organizationId,
          operation: "CREATE_BOOKING",
          requestHash,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
        })
        .onConflictDoNothing({ target: idempotencyKeys.key })
        .returning({ key: idempotencyKeys.key });
      if (!lock) {
        const [raced] = await transaction
          .select({
            requestHash: idempotencyKeys.requestHash,
            status: idempotencyKeys.status,
            responseJson: idempotencyKeys.responseJson,
            failureCode: idempotencyKeys.failureCode,
          })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, idempotencyKey))
          .limit(1);
        return raced
          ? replayResult(raced, requestHash)
          : { status: "in_progress" };
      }

      const [held] = await transaction
        .update(appointmentSlots)
        .set({ status: "HELD" })
        .where(
          and(
            eq(appointmentSlots.id, slot.id),
            eq(appointmentSlots.status, "OFFERED"),
            gt(appointmentSlots.expiresAt, now),
          ),
        )
        .returning({ id: appointmentSlots.id });
      if (!held) {
        await transaction
          .update(idempotencyKeys)
          .set({ status: "FAILED", failureCode: "SLOT_UNAVAILABLE" })
          .where(eq(idempotencyKeys.key, idempotencyKey));
        return { status: "rejected", reason: "SLOT_UNAVAILABLE" };
      }

      const [booking] = await transaction
        .insert(bookings)
        .values({
          organizationId: call.organizationId,
          appointmentSlotId: slot.id,
          crmProvider: "JOBBER",
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          idempotencyKey,
          estimatedValue: slot.estimatedValue,
        })
        .returning({ id: bookings.id });
      if (!booking) throw new Error("Failed to create local booking state");

      const context: BookingContext = {
        idempotencyKey,
        organizationId: call.organizationId,
        localBookingId: booking.id,
        appointmentSlotId: slot.id,
        externalCustomerId: property.externalCustomerId,
        externalPropertyId: property.externalPropertyId,
        serviceCode: slot.serviceCode,
        capacity: slot.capacity,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        summary: request.summary,
      };
      return { status: "acquired", context };
    });
  }

  async complete(
    context: BookingContext,
    crmBookingId: string,
    result: ConfirmedBookingResult,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [confirmed] = await transaction
        .update(bookings)
        .set({
          crmBookingId,
          status: "CONFIRMED",
          failureCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(bookings.id, context.localBookingId),
            eq(bookings.organizationId, context.organizationId),
            eq(bookings.status, "PROCESSING"),
          ),
        )
        .returning({ id: bookings.id });
      if (!confirmed) throw new Error("Booking is no longer in processing state");

      await transaction
        .update(appointmentSlots)
        .set({ status: "CONSUMED" })
        .where(
          and(
            eq(appointmentSlots.id, context.appointmentSlotId),
            eq(appointmentSlots.status, "HELD"),
          ),
        );
      await transaction
        .update(idempotencyKeys)
        .set({
          status: "COMPLETED",
          responseJson: { ...result },
          failureCode: null,
          completedAt: now,
        })
        .where(
          and(
            eq(idempotencyKeys.key, context.idempotencyKey),
            eq(idempotencyKeys.status, "PROCESSING"),
          ),
        );
    });
  }

  async fail(
    context: BookingContext,
    failureCode: string,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction
        .update(bookings)
        .set({ status: "FAILED", failureCode, updatedAt: now })
        .where(
          and(
            eq(bookings.id, context.localBookingId),
            eq(bookings.status, "PROCESSING"),
          ),
        );
      await transaction
        .update(idempotencyKeys)
        .set({ status: "FAILED", failureCode, completedAt: now })
        .where(
          and(
            eq(idempotencyKeys.key, context.idempotencyKey),
            eq(idempotencyKeys.status, "PROCESSING"),
          ),
        );
      if (failureCode === "SLOT_NO_LONGER_AVAILABLE") {
        await transaction
          .update(appointmentSlots)
          .set({ status: "INVALIDATED" })
          .where(eq(appointmentSlots.id, context.appointmentSlotId));
      }
    });
  }
}
