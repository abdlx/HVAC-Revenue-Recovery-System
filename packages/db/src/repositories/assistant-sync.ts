import type {
  AssistantDeployment,
  AssistantSyncRepository,
  AssistantSyncTarget,
} from "@hvac/voice";
import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  organizations,
  organizationSettings,
  voiceAgents,
} from "../schema/index.js";

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Assistant configuration field ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Assistant configuration field ${field} must be a string`);
  }
  return value;
}

export class AssistantConfigurationChangedError extends Error {
  constructor() {
    super("Assistant configuration changed while deployment was in progress");
    this.name = "AssistantConfigurationChangedError";
  }
}

export class PostgresAssistantSyncRepository implements AssistantSyncRepository {
  constructor(private readonly db: Database) {}

  async loadTarget(organizationId: string): Promise<AssistantSyncTarget | null> {
    const [row] = await this.db
      .select({
        organizationId: organizations.id,
        businessName: organizations.name,
        timezone: organizations.timezone,
        assistantConfig: organizationSettings.assistantConfigJson,
        recordingPolicy: organizationSettings.recordingPolicy,
        configVersion: organizationSettings.configVersion,
        promptVersion: organizationSettings.promptVersion,
        toolContractVersion: organizationSettings.toolContractVersion,
        providerAssistantId: voiceAgents.providerAssistantId,
        deployedConfigHash: voiceAgents.configHash,
        deployedConfigVersion: voiceAgents.configVersion,
        deployedPromptVersion: voiceAgents.promptVersion,
        deployedToolContractVersion: voiceAgents.toolContractVersion,
        deployedAt: voiceAgents.deployedAt,
        agentStatus: voiceAgents.status,
      })
      .from(organizations)
      .innerJoin(
        organizationSettings,
        eq(organizationSettings.organizationId, organizations.id),
      )
      .leftJoin(
        voiceAgents,
        and(
          eq(voiceAgents.organizationId, organizations.id),
          eq(voiceAgents.provider, "VAPI"),
        ),
      )
      .where(
        and(
          eq(organizations.id, organizationId),
          ne(organizations.status, "SUSPENDED"),
        ),
      )
      .limit(1);

    if (!row || row.agentStatus === "DISABLED") return null;

    const assistantConfig = asObject(row.assistantConfig, "assistant_config_json");
    const recordingPolicy = asObject(row.recordingPolicy, "recording_policy");
    const recordingEnabled = recordingPolicy.enabled === true;
    const disclosure = optionalString(
      recordingPolicy.disclosure,
      "recording_policy.disclosure",
    );

    const firstMessage = optionalString(
      assistantConfig.firstMessage,
      "assistant_config_json.firstMessage",
    );
    const source = {
      businessName: row.businessName,
      timezone: row.timezone,
      configVersion: row.configVersion,
      promptVersion: row.promptVersion,
      toolContractVersion: row.toolContractVersion,
      ...(firstMessage ? { firstMessage } : {}),
      model: asObject(assistantConfig.model, "assistant_config_json.model"),
      voice: asObject(assistantConfig.voice, "assistant_config_json.voice"),
      transcriber: asObject(
        assistantConfig.transcriber,
        "assistant_config_json.transcriber",
      ),
      recording: {
        enabled: recordingEnabled,
        ...(disclosure ? { disclosure } : {}),
      },
    };

    const deployed =
      row.providerAssistantId
        ? {
            providerAssistantId: row.providerAssistantId,
            configHash: row.deployedConfigHash,
            configVersion: row.deployedConfigVersion ?? 1,
            promptVersion: row.deployedPromptVersion ?? "v1",
            toolContractVersion: row.deployedToolContractVersion ?? "v1",
            deployedAt: row.deployedAt ?? new Date(0),
          }
        : null;

    return { organizationId: row.organizationId, source, deployed };
  }

  async commitDeployment(deployment: AssistantDeployment): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [settings] = await transaction
        .select({
          configVersion: organizationSettings.configVersion,
          promptVersion: organizationSettings.promptVersion,
          toolContractVersion: organizationSettings.toolContractVersion,
        })
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, deployment.organizationId))
        .limit(1);

      if (
        !settings ||
        settings.configVersion !== deployment.configVersion ||
        settings.promptVersion !== deployment.promptVersion ||
        settings.toolContractVersion !== deployment.toolContractVersion
      ) {
        throw new AssistantConfigurationChangedError();
      }

      const values = {
        providerAssistantId: deployment.providerAssistantId,
        configHash: deployment.configHash,
        configVersion: deployment.configVersion,
        promptVersion: deployment.promptVersion,
        toolContractVersion: deployment.toolContractVersion,
        deployedAt: deployment.deployedAt,
      };

      const [existing] = await transaction
        .select({ id: voiceAgents.id })
        .from(voiceAgents)
        .where(eq(voiceAgents.organizationId, deployment.organizationId))
        .limit(1);

      if (existing) {
        await transaction
          .update(voiceAgents)
          .set(values)
          .where(eq(voiceAgents.id, existing.id));
      } else {
        await transaction.insert(voiceAgents).values({
          organizationId: deployment.organizationId,
          provider: "VAPI",
          status: "DRAFT",
          ...values,
        });
      }
    });
  }
}
