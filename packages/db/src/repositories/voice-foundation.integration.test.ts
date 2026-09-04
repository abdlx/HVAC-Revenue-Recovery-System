import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, count, eq } from "drizzle-orm";
import { createDatabase } from "../client.js";
import {
  callEvents,
  calls,
  escalationRules,
  organizationSettings,
  organizations,
  phoneRoutes,
  voiceAgents,
} from "../schema/index.js";
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
