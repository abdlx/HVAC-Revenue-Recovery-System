import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { bookingRequestHash } from "@hvac/domain";
import { and, count, eq } from "drizzle-orm";
import { createDatabase } from "../client.js";
import {
  bookingRules,
  bookings,
  callEvents,
  calls,
  escalationRules,
  organizationSettings,
  organizations,
  phoneRoutes,
  services,
  voiceAgents,
} from "../schema/index.js";
import { PostgresBookingRepository } from "./booking.js";
import { PostgresAppointmentSlotRepository } from "./appointment-slots.js";
import { PostgresCustomerLookupRepository } from "./customer-lookup.js";
import { PostgresHumanEscalationRepository } from "./human-escalation.js";
import { PostgresIntegrationRepository } from "./integration.js";
import {
  AssistantConfigurationChangedError,
  PostgresAssistantSyncRepository,
} from "./assistant-sync.js";
import { PostgresVapiCallEventRepository } from "./vapi-events.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "persists Vapi events and tenant-owned escalation idempotently",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    assert.ok(databaseUrl);
    const { db, pool } = createDatabase(databaseUrl);
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const vapiCallId = `integration-call-${randomUUID()}`;
    const providerAssistantId = `integration-assistant-${randomUUID()}`;
    const otherProviderAssistantId = `integration-assistant-${randomUUID()}`;

    try {
      await db.insert(organizations).values([
        {
          id: organizationId,
          name: "Voice Foundation Integration Test",
          slug: `voice-foundation-${organizationId}`,
          timezone: "America/Phoenix",
        },
        {
          id: otherOrganizationId,
          name: "Other Voice Foundation Integration Test",
          slug: `voice-foundation-${otherOrganizationId}`,
          timezone: "America/Denver",
        },
      ]);
      await db.insert(organizationSettings).values({
        organizationId,
        defaultCallFallback: "+16025550100",
        assistantConfigJson: {
          firstMessage: "Thanks for calling the integration test company.",
          model: { provider: "openai", model: "gpt-4o-mini" },
          voice: { provider: "vapi", voiceId: "Elliot" },
          transcriber: { provider: "deepgram", model: "nova-3" },
        },
        configVersion: 7,
        promptVersion: "integration-v2",
        toolContractVersion: "tools-v1",
      });
      await db.insert(voiceAgents).values([
        {
          organizationId,
          providerAssistantId,
          promptVersion: "integration-v1",
          status: "ACTIVE",
        },
        {
          organizationId: otherOrganizationId,
          providerAssistantId: otherProviderAssistantId,
          promptVersion: "integration-v1",
          status: "ACTIVE",
        },
      ]);
      await db.insert(escalationRules).values({
        organizationId,
        reasonCode: "CUSTOMER_REQUESTED_HUMAN",
        priority: "NORMAL",
        destinationType: "NUMBER",
        destinationValue: "+16025550101",
      });
      const providerPhoneNumberId = `integration-phone-${randomUUID()}`;
      await db.insert(phoneRoutes).values({
        organizationId,
        publicBusinessNumber: `+1${Math.floor(1000000000 + Math.random() * 8999999999)}`,
        vapiPhoneNumberId: providerPhoneNumberId,
        routeType: "TEST",
        status: "ACTIVE",
      });

      const eventRepository = new PostgresVapiCallEventRepository(db);
      const event = {
        providerEventId: `event-${randomUUID()}`,
        vapiCallId,
        providerAssistantId,
        providerPhoneNumberId: null,
        eventType: "status-update",
        status: "in-progress",
        callerPhoneE164: "+16025551234",
        startedAt: new Date("2026-09-04T20:00:00.000Z"),
        answeredAt: new Date("2026-09-04T20:00:01.000Z"),
        endedAt: null,
        endedReason: null,
        transcript: null,
        summary: null,
        rawPayload: { message: { type: "status-update" } },
      };

      const accepted = await eventRepository.ingestVapiEvent(event);
      const duplicate = await eventRepository.ingestVapiEvent(event);
      const mismatchedAssistant = await eventRepository.ingestVapiEvent({
        ...event,
        providerEventId: `event-${randomUUID()}`,
        providerAssistantId: otherProviderAssistantId,
      });

      assert.equal(accepted.status, "accepted");
      assert.equal(duplicate.status, "duplicate");
      assert.equal(mismatchedAssistant.status, "unknown_call_context");

      const phoneMappedCallId = `integration-call-${randomUUID()}`;
      const phoneMapped = await eventRepository.ingestVapiEvent({
        ...event,
        providerEventId: `event-${randomUUID()}`,
        vapiCallId: phoneMappedCallId,
        providerAssistantId: null,
        providerPhoneNumberId,
      });
      assert.equal(phoneMapped.status, "accepted");
      const [phoneMappedCall] = await db
        .select({ organizationId: calls.organizationId })
        .from(calls)
        .where(eq(calls.vapiCallId, phoneMappedCallId))
        .limit(1);
      assert.equal(phoneMappedCall?.organizationId, organizationId);

      const humanRepository = new PostgresHumanEscalationRepository(db);
      const humanRequest = {
        vapiCallId,
        toolCallId: "human-tool-1",
        reasonCode: "CUSTOMER_REQUESTED_HUMAN" as const,
        priority: "NORMAL" as const,
      };
      const decision = await humanRepository.resolveAndRecordHumanRequest(
        humanRequest,
      );
      await humanRepository.resolveAndRecordHumanRequest(humanRequest);

      assert.deepEqual(decision, {
        action: "TRANSFER",
        destination: { type: "number", value: "+16025550101" },
        notesForAgent: "Tell the caller you are transferring them now.",
      });

      const [eventCount] = await db
        .select({ value: count() })
        .from(callEvents)
        .where(
          and(
            eq(callEvents.organizationId, organizationId),
            eq(callEvents.providerEventId, event.providerEventId),
          ),
        );
      const [humanEventCount] = await db
        .select({ value: count() })
        .from(callEvents)
        .where(
          and(
            eq(callEvents.organizationId, organizationId),
            eq(
              callEvents.providerEventId,
              `human-request:${vapiCallId}:human-tool-1`,
            ),
          ),
        );

      assert.equal(eventCount?.value, 1);
      assert.equal(humanEventCount?.value, 1);

      const [callRecord] = await db
        .select({ id: calls.id })
        .from(calls)
        .where(eq(calls.vapiCallId, vapiCallId))
        .limit(1);
      assert.ok(callRecord);
      const [service] = await db
        .insert(services)
        .values({
          organizationId,
          code: "AC_REPAIR",
          name: "Air conditioning repair",
          defaultDurationMinutes: 60,
          estimatedTicketValue: "350.00",
        })
        .returning({ id: services.id });
      assert.ok(service);
      await db.insert(bookingRules).values({
        organizationId,
        serviceId: service.id,
        minLeadMinutes: 60,
        maxHorizonDays: 30,
        arrivalWindowMinutes: 120,
        capacity: 1,
        rulesJson: {
          weeklyHours: {
            MONDAY: [{ start: "09:00", end: "17:00" }],
          },
          blackoutDates: [],
        },
      });
      const customerLookupRepository = new PostgresCustomerLookupRepository(db);
      const customerContext = await customerLookupRepository.loadContext(vapiCallId);
      assert.ok(customerContext);
      assert.equal(customerContext.organizationId, organizationId);
      assert.equal(customerContext.callerPhoneE164, "+16025551234");
      assert.equal(
        await customerLookupRepository.saveMatch(
          { ...customerContext, organizationId: otherOrganizationId },
          {
            externalCustomerId: "forged-customer",
            displayName: "Forged Customer",
            properties: [],
          },
          new Date("2026-09-05T11:59:59.000Z"),
        ),
        null,
      );
      const persistedCustomer = await customerLookupRepository.saveMatch(
        customerContext,
        {
          externalCustomerId: `jobber-customer-${randomUUID()}`,
          displayName: "Integration Customer",
          firstName: "Integration",
          lastName: "Customer",
          properties: [
            {
              externalPropertyId: `jobber-property-${randomUUID()}`,
              address1: "123 Test Avenue",
              city: "Phoenix",
              state: "AZ",
              postalCode: "85032",
              addressSummary: "123 Test Avenue, Phoenix, AZ 85032",
            },
          ],
        },
        new Date("2026-09-05T12:00:00.000Z"),
      );
      assert.ok(persistedCustomer);
      const customerId = persistedCustomer.customerRef;
      const propertyId = persistedCustomer.properties[0]?.propertyRef;
      assert.ok(propertyId);
      const slotToken = `slot_${randomUUID()}`;
      const appointmentSlotRepository = new PostgresAppointmentSlotRepository(db);
      const availabilityContext =
        await appointmentSlotRepository.loadAvailabilityContext({
          vapiCallId,
          serviceCode: "AC_REPAIR",
          propertyRef: propertyId,
        });
      assert.ok(availabilityContext);
      assert.equal(availabilityContext.policy.timeZone, "America/Phoenix");
      assert.equal(
        availabilityContext.policy.weeklyHours.MONDAY?.[0]?.start,
        "09:00",
      );
      await appointmentSlotRepository.replaceOffers(availabilityContext, [
        {
          tokenHash: createHash("sha256").update(slotToken).digest("hex"),
          startsAt: new Date("2026-09-07T16:00:00.000Z"),
          endsAt: new Date("2026-09-07T18:00:00.000Z"),
          expiresAt: new Date("2026-09-06T12:00:00.000Z"),
        },
      ]);

      const bookingRequest = {
        vapiCallId,
        toolCallId: "booking-tool-1",
        slotToken,
        customerRef: customerId,
        propertyRef: propertyId,
        serviceCode: "AC_REPAIR",
        callerConfirmed: true,
        summary: "AC is running but not cooling.",
      };
      const bookingRepository = new PostgresBookingRepository(db);
      const bookingHash = bookingRequestHash(bookingRequest);
      const acquiredBooking = await bookingRepository.begin(
        bookingRequest,
        bookingHash,
        new Date("2026-09-05T12:00:00.000Z"),
      );
      assert.equal(acquiredBooking.status, "acquired");
      assert.ok(acquiredBooking.status === "acquired");
      assert.equal(
        (
          await bookingRepository.begin(
            bookingRequest,
            bookingHash,
            new Date("2026-09-05T12:00:01.000Z"),
          )
        ).status,
        "in_progress",
      );
      const confirmedResult = {
        status: "confirmed" as const,
        bookingId: acquiredBooking.context.localBookingId,
        crmBookingId: `jobber-job-${randomUUID()}`,
        startsAt: acquiredBooking.context.startsAt.toISOString(),
        endsAt: acquiredBooking.context.endsAt.toISOString(),
      };
      await bookingRepository.complete(
        acquiredBooking.context,
        confirmedResult.crmBookingId,
        confirmedResult,
        new Date("2026-09-05T12:00:02.000Z"),
      );
      assert.deepEqual(
        await bookingRepository.begin(
          bookingRequest,
          bookingHash,
          new Date("2026-09-05T12:00:03.000Z"),
        ),
        { status: "completed", result: confirmedResult },
      );
      assert.deepEqual(
        await bookingRepository.begin(
          bookingRequest,
          "different-request-hash",
          new Date("2026-09-05T12:00:04.000Z"),
        ),
        { status: "rejected", reason: "REQUEST_MISMATCH" },
      );
      const [bookingCount] = await db
        .select({ value: count() })
        .from(bookings)
        .where(eq(bookings.organizationId, organizationId));
      assert.equal(bookingCount?.value, 1);

      const assistantRepository = new PostgresAssistantSyncRepository(db);
      const syncTarget = await assistantRepository.loadTarget(organizationId);
      assert.equal(syncTarget?.source.businessName, "Voice Foundation Integration Test");
      assert.equal(syncTarget?.source.configVersion, 7);
      assert.equal(syncTarget?.source.model.model, "gpt-4o-mini");
      assert.equal(syncTarget?.deployed?.providerAssistantId, providerAssistantId);

      const deployedAt = new Date("2026-09-05T12:00:00.000Z");
      await assistantRepository.commitDeployment({
        organizationId,
        providerAssistantId,
        configHash: "integration-config-hash",
        configVersion: 7,
        promptVersion: "integration-v2",
        toolContractVersion: "tools-v1",
        deployedAt,
      });
      const [deployedAgent] = await db
        .select({
          configHash: voiceAgents.configHash,
          configVersion: voiceAgents.configVersion,
          promptVersion: voiceAgents.promptVersion,
          toolContractVersion: voiceAgents.toolContractVersion,
          deployedAt: voiceAgents.deployedAt,
        })
        .from(voiceAgents)
        .where(eq(voiceAgents.organizationId, organizationId))
        .limit(1);
      assert.deepEqual(deployedAgent, {
        configHash: "integration-config-hash",
        configVersion: 7,
        promptVersion: "integration-v2",
        toolContractVersion: "tools-v1",
        deployedAt,
      });

      await db
        .update(organizationSettings)
        .set({ configVersion: 8 })
        .where(eq(organizationSettings.organizationId, organizationId));
      await assert.rejects(
        assistantRepository.commitDeployment({
          organizationId,
          providerAssistantId,
          configHash: "stale-config-hash",
          configVersion: 7,
          promptVersion: "integration-v2",
          toolContractVersion: "tools-v1",
          deployedAt,
        }),
        AssistantConfigurationChangedError,
      );

      const integrationRepository = new PostgresIntegrationRepository(db);
      const stateHash = `state-${randomUUID()}`;
      const oauthState = {
        stateHash,
        organizationId,
        codeVerifierEncrypted: "encrypted-verifier",
        redirectUri: "https://app.example.com/jobber/callback",
        expiresAt: new Date("2026-09-05T13:00:00.000Z"),
      };
      await integrationRepository.saveOAuthState(oauthState);
      const consumedState = await integrationRepository.consumeOAuthState(
        stateHash,
        new Date("2026-09-05T12:00:00.000Z"),
      );
      const replayedState = await integrationRepository.consumeOAuthState(
        stateHash,
        new Date("2026-09-05T12:00:01.000Z"),
      );
      assert.deepEqual(consumedState, oauthState);
      assert.equal(replayedState, null);

      await integrationRepository.upsertJobberConnection({
        organizationId,
        externalAccountId: `jobber-account-${randomUUID()}`,
        accessTokenEncrypted: "encrypted-access-1",
        refreshTokenEncrypted: "encrypted-refresh-1",
        accessExpiresAt: new Date("2026-09-05T13:00:00.000Z"),
        scopes: ["read_clients", "write_jobs"],
        tokenVersion: 1,
      });
      const rotated = await integrationRepository.withJobberRefreshLock(
        organizationId,
        () =>
          integrationRepository.rotateJobberTokens({
            organizationId,
            expectedTokenVersion: 1,
            accessTokenEncrypted: "encrypted-access-2",
            refreshTokenEncrypted: "encrypted-refresh-2",
            accessExpiresAt: new Date("2026-09-05T14:00:00.000Z"),
            refreshedAt: new Date("2026-09-05T12:30:00.000Z"),
          }),
      );
      const staleRotation = await integrationRepository.rotateJobberTokens({
        organizationId,
        expectedTokenVersion: 1,
        accessTokenEncrypted: "encrypted-access-stale",
        refreshTokenEncrypted: "encrypted-refresh-stale",
        accessExpiresAt: new Date("2026-09-05T14:00:00.000Z"),
        refreshedAt: new Date("2026-09-05T12:31:00.000Z"),
      });
      const activeConnection =
        await integrationRepository.loadActiveJobberConnection(organizationId);
      assert.equal(rotated, true);
      assert.equal(staleRotation, false);
      assert.equal(activeConnection?.refreshTokenEncrypted, "encrypted-refresh-2");
      assert.equal(activeConnection?.tokenVersion, 2);

      await integrationRepository.disconnectJobber(organizationId);
      assert.equal(
        await integrationRepository.loadActiveJobberConnection(organizationId),
        null,
      );
    } finally {
      await db
        .delete(organizations)
        .where(
          eq(organizations.id, organizationId),
        );
      await db
        .delete(organizations)
        .where(
          eq(organizations.id, otherOrganizationId),
        );
      await pool.end();
    }
  },
);
