export interface ExternalCustomerProperty {
  externalPropertyId: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  addressSummary: string;
}

export interface ExternalCustomerMatch {
  externalCustomerId: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  properties: ExternalCustomerProperty[];
}

export interface CustomerLookupContext {
  callId: string;
  organizationId: string;
  callerPhoneE164: string | null;
}

export interface PersistedCustomerMatch {
  customerRef: string;
  properties: Array<{
    propertyRef: string;
    addressSummary: string;
  }>;
}

export interface CustomerLookupRepository {
  loadContext(vapiCallId: string): Promise<CustomerLookupContext | null>;
  saveMatch(
    context: CustomerLookupContext,
    match: ExternalCustomerMatch,
    now: Date,
  ): Promise<PersistedCustomerMatch | null>;
}

export interface CustomerDirectory {
  findByPhone(input: {
    organizationId: string;
    phoneE164: string;
  }): Promise<ExternalCustomerMatch | null>;
}

export type LookupCustomerResult =
  | {
      status: "found";
      customer_ref: string;
      display_name: string;
      properties: Array<{
        property_ref: string;
        address: string;
      }>;
    }
  | { status: "not_found" }
  | {
      status: "unavailable";
      reason:
        | "UNKNOWN_CALL"
        | "INVALID_CALLER_PHONE"
        | "CRM_UNAVAILABLE"
        | "INVALID_CRM_RESPONSE";
    };

export function normalizeE164(value: string): string | null {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function validMatch(match: ExternalCustomerMatch): boolean {
  return (
    match.externalCustomerId.trim().length > 0 &&
    match.displayName.trim().length > 0 &&
    match.properties.every(
      (property) =>
        property.externalPropertyId.trim().length > 0 &&
        property.address1.trim().length > 0 &&
        property.city.trim().length > 0 &&
        property.state.trim().length > 0 &&
        property.postalCode.trim().length > 0 &&
        property.addressSummary.trim().length > 0,
    )
  );
}

export class LookupCustomer {
  constructor(
    private readonly repository: CustomerLookupRepository,
    private readonly directory: CustomerDirectory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(vapiCallId: string): Promise<LookupCustomerResult> {
    const context = await this.repository.loadContext(vapiCallId);
    if (!context) return { status: "unavailable", reason: "UNKNOWN_CALL" };

    const phoneE164 = context.callerPhoneE164
      ? normalizeE164(context.callerPhoneE164)
      : null;
    if (!phoneE164) {
      return { status: "unavailable", reason: "INVALID_CALLER_PHONE" };
    }

    let match: ExternalCustomerMatch | null;
    try {
      match = await this.directory.findByPhone({
        organizationId: context.organizationId,
        phoneE164,
      });
    } catch {
      return { status: "unavailable", reason: "CRM_UNAVAILABLE" };
    }
    if (!match) return { status: "not_found" };
    if (!validMatch(match)) {
      return { status: "unavailable", reason: "INVALID_CRM_RESPONSE" };
    }

    const persisted = await this.repository.saveMatch(
      { ...context, callerPhoneE164: phoneE164 },
      match,
      this.now(),
    );
    if (!persisted) {
      return { status: "unavailable", reason: "UNKNOWN_CALL" };
    }

    return {
      status: "found",
      customer_ref: persisted.customerRef,
      display_name: match.displayName,
      properties: persisted.properties.map((property) => ({
        property_ref: property.propertyRef,
        address: property.addressSummary,
      })),
    };
  }
}
