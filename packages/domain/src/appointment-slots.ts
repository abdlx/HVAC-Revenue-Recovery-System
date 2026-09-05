import { createHash, randomBytes } from "node:crypto";
import {
  generateAvailableSlots,
  type AvailabilityPolicy,
  type BusyInterval,
  type DayPart,
} from "./availability.js";

export interface AppointmentAvailabilityContext {
  organizationId: string;
  callId: string;
  serviceId: string;
  propertyId: string;
  policy: AvailabilityPolicy;
}

export interface SlotOfferToPersist {
  tokenHash: string;
  startsAt: Date;
  endsAt: Date;
  expiresAt: Date;
}

export interface AppointmentSlotRepository {
  loadAvailabilityContext(input: {
    vapiCallId: string;
    serviceCode: string;
    propertyRef: string;
  }): Promise<AppointmentAvailabilityContext | null>;
  replaceOffers(
    context: AppointmentAvailabilityContext,
    offers: SlotOfferToPersist[],
  ): Promise<void>;
}

export interface CrmScheduleReader {
  getBusyIntervals(input: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<BusyInterval[]>;
}

export interface AppointmentSlotOffer {
  slotToken: string;
  display: string;
  expiresAt: string;
}

export type OfferAppointmentSlotsResult =
  | { status: "available"; slots: AppointmentSlotOffer[] }
  | { status: "unavailable"; reason: "INVALID_CONTEXT" | "NO_AVAILABILITY" | "CRM_UNAVAILABLE" };

function formatSlot(startsAt: Date, endsAt: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time.format(startsAt)}–${time.format(endsAt)}`;
}

export class OfferAppointmentSlots {
  constructor(
    private readonly repository: AppointmentSlotRepository,
    private readonly schedule: CrmScheduleReader,
    private readonly now: () => Date = () => new Date(),
    private readonly issueToken: () => string = () =>
      `slot_${randomBytes(32).toString("base64url")}`,
    private readonly ttlMs = 15 * 60_000,
  ) {}

  async execute(input: {
    vapiCallId: string;
    serviceCode: string;
    propertyRef: string;
    preferredDate?: string;
    dayPart?: DayPart;
  }): Promise<OfferAppointmentSlotsResult> {
    const context = await this.repository.loadAvailabilityContext(input);
    if (!context) return { status: "unavailable", reason: "INVALID_CONTEXT" };
    const now = this.now();
    const horizonEnd = new Date(
      now.getTime() + context.policy.maxHorizonDays * 24 * 60 * 60_000,
    );
    let busyIntervals: BusyInterval[];
    try {
      busyIntervals = await this.schedule.getBusyIntervals({
        organizationId: context.organizationId,
        startsAt: now,
        endsAt: horizonEnd,
      });
    } catch {
      return { status: "unavailable", reason: "CRM_UNAVAILABLE" };
    }

    const slots = generateAvailableSlots({
      policy: context.policy,
      busyIntervals,
      now,
      ...(input.preferredDate ? { preferredDate: input.preferredDate } : {}),
      ...(input.dayPart ? { dayPart: input.dayPart } : {}),
      limit: 3,
    });
    if (!slots.length) return { status: "unavailable", reason: "NO_AVAILABILITY" };

    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const offers = slots.map((slot) => {
      const slotToken = this.issueToken();
      return {
        slotToken,
        persisted: {
          tokenHash: createHash("sha256").update(slotToken).digest("hex"),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          expiresAt,
        },
      };
    });
    await this.repository.replaceOffers(
      context,
      offers.map((offer) => offer.persisted),
    );

    return {
      status: "available",
      slots: offers.map((offer) => ({
        slotToken: offer.slotToken,
        display: formatSlot(
          offer.persisted.startsAt,
          offer.persisted.endsAt,
          context.policy.timeZone,
        ),
        expiresAt: expiresAt.toISOString(),
      })),
    };
  }
}
