import type {
  BookingAvailabilityVerifier,
  BookingContext,
  BookingCrmWriter,
  CustomerDirectory,
  CrmScheduleReader as DomainScheduleReader,
  ExternalCustomerMatch,
} from "@hvac/domain";
import type { CrmProvider } from "./provider.js";

export class CrmCustomerDirectory implements CustomerDirectory {
  constructor(private readonly provider: CrmProvider) {}

  findByPhone(input: {
    organizationId: string;
    phoneE164: string;
  }): Promise<ExternalCustomerMatch | null> {
    return this.provider.findCustomerByPhone(input);
  }
}

export class CrmScheduleReader implements DomainScheduleReader {
  constructor(private readonly provider: CrmProvider) {}

  async getBusyIntervals(input: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    const blocks = await this.provider.getSchedule(input);
    return blocks.map((block) => ({
      startsAt: block.startsAt,
      endsAt: block.endsAt,
    }));
  }
}

export class CrmBookingGateway
  implements BookingAvailabilityVerifier, BookingCrmWriter
{
  constructor(private readonly provider: CrmProvider) {}

  async isStillAvailable(context: BookingContext): Promise<boolean> {
    const blocks = await this.provider.getSchedule({
      organizationId: context.organizationId,
      startsAt: context.startsAt,
      endsAt: context.endsAt,
    });
    const overlapping = blocks.filter(
      (block) =>
        block.startsAt < context.endsAt && block.endsAt > context.startsAt,
    ).length;
    return overlapping < context.capacity;
  }

  async createBooking(context: BookingContext): Promise<{ crmBookingId: string }> {
    const booking = await this.provider.createBooking({
      organizationId: context.organizationId,
      externalCustomerId: context.externalCustomerId,
      externalPropertyId: context.externalPropertyId,
      startsAt: context.startsAt,
      endsAt: context.endsAt,
      title: context.serviceCode,
      instructions: context.summary,
    });
    return { crmBookingId: booking.externalBookingId };
  }
}
