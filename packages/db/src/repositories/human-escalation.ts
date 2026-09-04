import type {
  HumanEscalationDecision,
  HumanEscalationRepository,
  HumanEscalationRequest,
} from "@hvac/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  callEvents,
  calls,
  escalationRules,
  organizationSettings,
} from "../schema/index.js";

function isValidDestination(type: "NUMBER" | "SIP", value: string): boolean {
  if (type === "NUMBER") {
    return /^\+[1-9]\d{7,14}$/.test(value);
  }

  return /^sips?:[^@\s]+@[^@\s]+$/i.test(value);
}

export class PostgresHumanEscalationRepository
  implements HumanEscalationRepository
{
  constructor(private readonly db: Database) {}

  async resolveAndRecordHumanRequest(
    request: HumanEscalationRequest,
  ): Promise<HumanEscalationDecision | null> {
    return this.db.transaction(async (transaction) => {
      const [call] = await transaction
        .select({ id: calls.id, organizationId: calls.organizationId })
        .from(calls)
        .where(eq(calls.vapiCallId, request.vapiCallId))
        .limit(1);

      if (!call) {
        return null;
      }

      const [rule] = await transaction
        .select({
          destinationType: escalationRules.destinationType,
          destinationValue: escalationRules.destinationValue,
        })
        .from(escalationRules)
        .where(
          and(
            eq(escalationRules.organizationId, call.organizationId),
            eq(escalationRules.reasonCode, request.reasonCode),
            eq(escalationRules.priority, request.priority),
            eq(escalationRules.active, true),
          ),
        )
        .limit(1);

      const [settings] = rule
        ? []
        : await transaction
            .select({ fallback: organizationSettings.defaultCallFallback })
            .from(organizationSettings)
            .where(eq(organizationSettings.organizationId, call.organizationId))
            .limit(1);

      const validRule =
        rule && isValidDestination(rule.destinationType, rule.destinationValue)
          ? rule
          : null;
      const validFallback =
        settings?.fallback && isValidDestination("NUMBER", settings.fallback)
          ? settings.fallback
          : null;

      const decision: HumanEscalationDecision = validRule
        ? {
            action: "TRANSFER",
            destination: {
              type: validRule.destinationType === "SIP" ? "sip" : "number",
              value: validRule.destinationValue,
            },
            notesForAgent: "Tell the caller you are transferring them now.",
          }
        : validFallback
          ? {
              action: "TRANSFER",
              destination: { type: "number", value: validFallback },
              notesForAgent: "Tell the caller you are transferring them now.",
            }
          : {
              action: "CALLBACK",
              destination: null,
              notesForAgent:
                "A live transfer is not configured. Tell the caller a dispatcher will call them back.",
            };

      await transaction
        .insert(callEvents)
        .values({
          organizationId: call.organizationId,
          callId: call.id,
          provider: "SYSTEM",
          providerEventId: `human-request:${request.vapiCallId}:${request.toolCallId}`,
          eventType: "HUMAN_REQUESTED",
          payloadJson: {
            reason_code: request.reasonCode,
            priority: request.priority,
            action: decision.action,
          },
        })
        .onConflictDoNothing({
          target: [callEvents.provider, callEvents.providerEventId],
        });

      return decision;
    });
  }
}
