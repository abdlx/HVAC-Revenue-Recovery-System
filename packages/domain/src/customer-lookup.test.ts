import assert from "node:assert/strict";
import test from "node:test";
import {
  LookupCustomer,
  normalizeE164,
  type CustomerDirectory,
  type CustomerLookupRepository,
  type ExternalCustomerMatch,
} from "./customer-lookup.js";

const match: ExternalCustomerMatch = {
  externalCustomerId: "jobber-client-1",
  displayName: "Jane Doe",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  properties: [
    {
      externalPropertyId: "jobber-property-1",
      address1: "123 Test Avenue",
      city: "Phoenix",
      state: "AZ",
      postalCode: "85032",
      addressSummary: "123 Test Avenue, Phoenix, AZ 85032",
    },
  ],
};

function dependencies(input?: {
  context?: Awaited<ReturnType<CustomerLookupRepository["loadContext"]>>;
  crmMatch?: ExternalCustomerMatch | null;
  crmError?: boolean;
}) {
  const repository: CustomerLookupRepository = {
    async loadContext(callId) {
      assert.equal(callId, "vapi-call-1");
      return input?.context === undefined
        ? {
            callId: "local-call-1",
            organizationId: "org-1",
            callerPhoneE164: "+1 (602) 555-1234",
          }
        : input.context;
    },
    async saveMatch(context, customer, now) {
      assert.equal(context.organizationId, "org-1");
      assert.equal(context.callerPhoneE164, "+16025551234");
      assert.equal(customer, match);
      assert.equal(now.toISOString(), "2026-09-05T12:00:00.000Z");
      return {
        customerRef: "local-customer-1",
        properties: [
          {
            propertyRef: "local-property-1",
            addressSummary: match.properties[0]!.addressSummary,
          },
        ],
      };
    },
  };
  const directory: CustomerDirectory = {
    async findByPhone(request) {
      assert.deepEqual(request, {
        organizationId: "org-1",
        phoneE164: "+16025551234",
      });
      if (input?.crmError) throw new Error("CRM offline");
      return input?.crmMatch === undefined ? match : input.crmMatch;
    },
  };
  return { repository, directory };
}

test("normalizes common E.164 formatting without guessing a country code", () => {
  assert.equal(normalizeE164("+1 (602) 555-1234"), "+16025551234");
  assert.equal(normalizeE164("6025551234"), null);
});

test("returns local opaque customer and property references", async () => {
  const { repository, directory } = dependencies();
  const result = await new LookupCustomer(
    repository,
    directory,
    () => new Date("2026-09-05T12:00:00.000Z"),
  ).execute("vapi-call-1");

  assert.deepEqual(result, {
    status: "found",
    customer_ref: "local-customer-1",
    display_name: "Jane Doe",
    properties: [
      {
        property_ref: "local-property-1",
        address: "123 Test Avenue, Phoenix, AZ 85032",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /jobber-/);
});

test("distinguishes no CRM match from a provider outage", async () => {
  const noMatch = dependencies({ crmMatch: null });
  assert.deepEqual(
    await new LookupCustomer(noMatch.repository, noMatch.directory).execute(
      "vapi-call-1",
    ),
    { status: "not_found" },
  );

  const outage = dependencies({ crmError: true });
  assert.deepEqual(
    await new LookupCustomer(outage.repository, outage.directory).execute(
      "vapi-call-1",
    ),
    { status: "unavailable", reason: "CRM_UNAVAILABLE" },
  );
});

test("fails closed for an unknown call, invalid caller, or malformed CRM record", async () => {
  const unknown = dependencies({ context: null });
  assert.deepEqual(
    await new LookupCustomer(unknown.repository, unknown.directory).execute(
      "vapi-call-1",
    ),
    { status: "unavailable", reason: "UNKNOWN_CALL" },
  );

  const invalidCaller = dependencies({
    context: {
      callId: "local-call-1",
      organizationId: "org-1",
      callerPhoneE164: "anonymous",
    },
  });
  assert.deepEqual(
    await new LookupCustomer(
      invalidCaller.repository,
      invalidCaller.directory,
    ).execute("vapi-call-1"),
    { status: "unavailable", reason: "INVALID_CALLER_PHONE" },
  );

  const malformed = dependencies({
    crmMatch: { ...match, externalCustomerId: "" },
  });
  assert.deepEqual(
    await new LookupCustomer(malformed.repository, malformed.directory).execute(
      "vapi-call-1",
    ),
    { status: "unavailable", reason: "INVALID_CRM_RESPONSE" },
  );
});
