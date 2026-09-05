import { createHash } from "node:crypto";

export interface CreateBookingRequest {
  vapiCallId: string;
  toolCallId: string;
  slotToken: string;
  customerRef: string;
  propertyRef: string;
  serviceCode: string;
  callerConfirmed: boolean;
  summary: string;
}

export interface BookingContext {
  idempotencyKey: string;
  organizationId: string;
  localBookingId: string;
  appointmentSlotId: string;
  externalCustomerId: string;
  externalPropertyId: string;
  serviceCode: string;
  capacity: number;
  startsAt: Date;
  endsAt: Date;
  summary: string;
}

export interface ConfirmedBookingResult {
  status: "confirmed";
  bookingId: string;
  crmBookingId: string;
  startsAt: string;
  endsAt: string;
}

export type BeginBookingResult =
  | { status: "acquired"; context: BookingContext }
  | { status: "completed"; result: ConfirmedBookingResult }
  | { status: "in_progress" }
  | { status: "failed"; failureCode: string }
  | {
      status: "rejected";
      reason:
        | "UNKNOWN_CALL"
        | "INVALID_SLOT"
        | "EXPIRED_SLOT"
        | "SLOT_UNAVAILABLE"
        | "INVALID_CUSTOMER"
        | "INVALID_PROPERTY"
        | "INVALID_SERVICE"
        | "REQUEST_MISMATCH";
    };

export interface BookingRepository {
  begin(request: CreateBookingRequest, requestHash: string, now: Date): Promise<BeginBookingResult>;
  complete(
    context: BookingContext,
    crmBookingId: string,
    result: ConfirmedBookingResult,
    now: Date,
  ): Promise<void>;
  fail(context: BookingContext, failureCode: string, now: Date): Promise<void>;
}

export interface BookingAvailabilityVerifier {
  isStillAvailable(context: BookingContext): Promise<boolean>;
}

export interface BookingCrmWriter {
  createBooking(context: BookingContext): Promise<{ crmBookingId: string }>;
}

export type CreateBookingResult =
  | ConfirmedBookingResult
  | { status: "confirmation_required" }
  | { status: "in_progress" }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function bookingRequestHash(request: CreateBookingRequest): string {
  return createHash("sha256").update(stableJson(request)).digest("hex");
}

export class CreateBooking {
  constructor(
    private readonly repository: BookingRepository,
    private readonly availability: BookingAvailabilityVerifier,
    private readonly crm: BookingCrmWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(request: CreateBookingRequest): Promise<CreateBookingResult> {
    if (!request.callerConfirmed) return { status: "confirmation_required" };
    const now = this.now();
    const begun = await this.repository.begin(request, bookingRequestHash(request), now);

    if (begun.status === "completed") return begun.result;
    if (begun.status === "in_progress") return { status: "in_progress" };
    if (begun.status === "failed") {
      return { status: "failed", reason: begun.failureCode };
    }
    if (begun.status === "rejected") {
      return { status: "unavailable", reason: begun.reason };
    }

    const context = begun.context;
    try {
      if (!(await this.availability.isStillAvailable(context))) {
        await this.repository.fail(context, "SLOT_NO_LONGER_AVAILABLE", now);
        return { status: "unavailable", reason: "SLOT_NO_LONGER_AVAILABLE" };
      }

      const created = await this.crm.createBooking(context);
      const result: ConfirmedBookingResult = {
        status: "confirmed",
        bookingId: context.localBookingId,
        crmBookingId: created.crmBookingId,
        startsAt: context.startsAt.toISOString(),
        endsAt: context.endsAt.toISOString(),
      };
      await this.repository.complete(context, created.crmBookingId, result, this.now());
      return result;
    } catch {
      await this.repository.fail(context, "CRM_BOOKING_UNCERTAIN", this.now());
      return { status: "failed", reason: "CRM_BOOKING_UNCERTAIN" };
    }
  }
}
