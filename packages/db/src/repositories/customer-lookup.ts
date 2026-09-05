import type {
  CustomerLookupContext,
  CustomerLookupRepository,
  ExternalCustomerMatch,
  PersistedCustomerMatch,
} from "@hvac/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { calls, customers, properties } from "../schema/index.js";

export class PostgresCustomerLookupRepository
  implements CustomerLookupRepository
{
  constructor(private readonly db: Database) {}

  async loadContext(vapiCallId: string): Promise<CustomerLookupContext | null> {
    const [context] = await this.db
      .select({
        callId: calls.id,
        organizationId: calls.organizationId,
        callerPhoneE164: calls.callerPhoneE164,
      })
      .from(calls)
      .where(eq(calls.vapiCallId, vapiCallId))
      .limit(1);

    return context
      ? {
          callId: context.callId,
          organizationId: context.organizationId,
          callerPhoneE164: context.callerPhoneE164,
        }
      : null;
  }

  async saveMatch(
    context: CustomerLookupContext,
    match: ExternalCustomerMatch,
    now: Date,
  ): Promise<PersistedCustomerMatch | null> {
    const callerPhoneE164 = context.callerPhoneE164;
    if (!callerPhoneE164) return null;
    return this.db.transaction(async (transaction) => {
      const [trustedCall] = await transaction
        .select({ id: calls.id })
        .from(calls)
        .where(
          and(
            eq(calls.id, context.callId),
            eq(calls.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!trustedCall) return null;

      const [customer] = await transaction
        .insert(customers)
        .values({
          organizationId: context.organizationId,
          crmProvider: "JOBBER",
          crmCustomerId: match.externalCustomerId,
          phoneE164: callerPhoneE164,
          ...(match.firstName ? { firstName: match.firstName } : {}),
          ...(match.lastName ? { lastName: match.lastName } : {}),
          ...(match.email ? { email: match.email } : {}),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            customers.organizationId,
            customers.crmProvider,
            customers.crmCustomerId,
          ],
          set: {
            phoneE164: callerPhoneE164,
            firstName: match.firstName ?? null,
            lastName: match.lastName ?? null,
            email: match.email ?? null,
            updatedAt: now,
          },
        })
        .returning({ id: customers.id });
      if (!customer) throw new Error("Failed to persist CRM customer match");

      const persistedProperties: PersistedCustomerMatch["properties"] = [];
      for (const property of match.properties) {
        const [persisted] = await transaction
          .insert(properties)
          .values({
            organizationId: context.organizationId,
            customerId: customer.id,
            crmPropertyId: property.externalPropertyId,
            address1: property.address1,
            city: property.city,
            state: property.state,
            postalCode: property.postalCode,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [properties.organizationId, properties.crmPropertyId],
            set: {
              customerId: customer.id,
              address1: property.address1,
              city: property.city,
              state: property.state,
              postalCode: property.postalCode,
              updatedAt: now,
            },
          })
          .returning({ id: properties.id });
        if (!persisted) throw new Error("Failed to persist CRM property match");
        persistedProperties.push({
          propertyRef: persisted.id,
          addressSummary: property.addressSummary,
        });
      }

      return {
        customerRef: customer.id,
        properties: persistedProperties,
      };
    });
  }
}
