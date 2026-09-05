export interface CrmAccountContext {
  externalAccountId: string;
  name: string;
}

export interface CustomerMatch {
  externalCustomerId: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  properties: Array<{
    externalPropertyId: string;
    address1: string;
    city: string;
    state: string;
    postalCode: string;
    addressSummary: string;
  }>;
}

export interface ScheduledBlock {
  externalId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CreateBookingInput {
  organizationId: string;
  externalCustomerId: string;
  externalPropertyId: string;
  startsAt: Date;
  endsAt: Date;
  title: string;
  instructions: string;
}

export interface BookingRef {
  externalBookingId: string;
}

export interface CrmProvider {
  getAccountContext(organizationId: string): Promise<CrmAccountContext>;
  findCustomerByPhone(input: {
    organizationId: string;
    phoneE164: string;
  }): Promise<CustomerMatch | null>;
  getSchedule(input: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<ScheduledBlock[]>;
  createBooking(input: CreateBookingInput): Promise<BookingRef>;
  getBooking(input: {
    organizationId: string;
    externalBookingId: string;
  }): Promise<BookingRef | null>;
}
