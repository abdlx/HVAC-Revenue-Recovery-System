import type {
  NormalizedVapiCallEvent,
  VapiCallEventRepository,
  VapiEventIngestionResult,
} from "@hvac/domain";
import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  callEvents,
  calls,
  phoneRoutes,
  voiceAgents,
} from "../schema/index.js";

export class PostgresVapiCallEventRepository
  implements VapiCallEventRepository
{
  constructor(private readonly db: Database) {}

  async ingestVapiEvent(
    event: NormalizedVapiCallEvent,
  ): Promise<VapiEventIngestionResult> {
    return this.db.transaction(async (transaction) => {
      const [existingCall] = await transaction
        .select({ id: calls.id, organizationId: calls.organizationId })
        .from(calls)
        .where(eq(calls.vapiCallId, event.vapiCallId))
        .limit(1);

      const [mappedAgent] = event.providerAssistantId
        ? await transaction
            .select({
              organizationId: voiceAgents.organizationId,
              configVersion: voiceAgents.configVersion,
              promptVersion: voiceAgents.promptVersion,
            })
            .from(voiceAgents)
            .where(
              and(
                eq(voiceAgents.provider, "VAPI"),
                eq(voiceAgents.providerAssistantId, event.providerAssistantId),
                ne(voiceAgents.status, "DISABLED"),
              ),
            )
            .limit(1)
        : [];

      const [mappedPhoneRoute] = event.providerPhoneNumberId
        ? await transaction
            .select({ organizationId: phoneRoutes.organizationId })
            .from(phoneRoutes)
            .where(
              and(
                eq(phoneRoutes.vapiPhoneNumberId, event.providerPhoneNumberId),
                eq(phoneRoutes.status, "ACTIVE"),
              ),
            )
            .limit(1)
        : [];

      if (
        mappedAgent &&
        mappedPhoneRoute &&
        mappedAgent.organizationId !== mappedPhoneRoute.organizationId
      ) {
        return { status: "unknown_call_context" };
      }

      const mappedOrganizationId =
        mappedAgent?.organizationId ?? mappedPhoneRoute?.organizationId;

      const [organizationAgent] =
        !mappedAgent && mappedOrganizationId
          ? await transaction
              .select({
                organizationId: voiceAgents.organizationId,
                configVersion: voiceAgents.configVersion,
                promptVersion: voiceAgents.promptVersion,
              })
              .from(voiceAgents)
              .where(
                and(
                  eq(voiceAgents.organizationId, mappedOrganizationId),
                  eq(voiceAgents.provider, "VAPI"),
                  eq(voiceAgents.status, "ACTIVE"),
                ),
              )
              .limit(1)
          : [];

      const mappedContext = mappedAgent ?? organizationAgent;

      if (
        existingCall &&
        mappedOrganizationId &&
        existingCall.organizationId !== mappedOrganizationId
      ) {
        return { status: "unknown_call_context" };
      }

      let call = existingCall;
      if (!call) {
        if (!mappedContext) {
          return { status: "unknown_call_context" };
        }

        [call] = await transaction
          .insert(calls)
          .values({
            organizationId: mappedContext.organizationId,
            vapiCallId: event.vapiCallId,
            callerPhoneE164: event.callerPhoneE164,
            startedAt: event.startedAt ?? new Date(),
            assistantConfigVersion: mappedContext.configVersion,
            promptVersion: mappedContext.promptVersion,
          })
          .onConflictDoNothing({ target: calls.vapiCallId })
          .returning({ id: calls.id, organizationId: calls.organizationId });

        if (!call) {
          [call] = await transaction
            .select({ id: calls.id, organizationId: calls.organizationId })
            .from(calls)
            .where(eq(calls.vapiCallId, event.vapiCallId))
            .limit(1);
        }
      }

      if (!call) {
        return { status: "unknown_call_context" };
      }

      const [insertedEvent] = await transaction
        .insert(callEvents)
        .values({
          organizationId: call.organizationId,
          callId: call.id,
          provider: "VAPI",
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          payloadJson: event.rawPayload,
        })
        .onConflictDoNothing({
          target: [callEvents.provider, callEvents.providerEventId],
        })
        .returning({ id: callEvents.id });

      if (!insertedEvent) {
        return { status: "duplicate", callId: call.id };
      }

      const callUpdate = {
        ...(event.callerPhoneE164
          ? { callerPhoneE164: event.callerPhoneE164 }
          : {}),
        ...(event.startedAt ? { startedAt: event.startedAt } : {}),
        ...(event.answeredAt ? { answeredAt: event.answeredAt } : {}),
        ...(event.endedAt ? { endedAt: event.endedAt } : {}),
        ...(event.endedReason ? { endedReason: event.endedReason } : {}),
        ...(event.transcript ? { transcript: event.transcript } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
      };

      if (Object.keys(callUpdate).length > 0) {
        await transaction.update(calls).set(callUpdate).where(eq(calls.id, call.id));
      }

      return { status: "accepted", callId: call.id };
    });
  }
}
