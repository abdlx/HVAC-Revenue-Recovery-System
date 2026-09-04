import {
  compileVapiAssistant,
  type AssistantCompilerOptions,
  type TenantAssistantSource,
} from "./assistant-compiler.js";
import type { VoiceAssistantProvider } from "./provider.js";

export interface DeployedAssistantState {
  providerAssistantId: string;
  configHash: string | null;
  configVersion: number;
  promptVersion: string;
  toolContractVersion: string;
  deployedAt: Date;
}

export interface AssistantSyncTarget {
  organizationId: string;
  source: TenantAssistantSource;
  deployed: DeployedAssistantState | null;
}

export interface AssistantDeployment {
  organizationId: string;
  providerAssistantId: string;
  configHash: string;
  configVersion: number;
  promptVersion: string;
  toolContractVersion: string;
  deployedAt: Date;
}

export interface AssistantSyncRepository {
  loadTarget(organizationId: string): Promise<AssistantSyncTarget | null>;
  commitDeployment(deployment: AssistantDeployment): Promise<void>;
}

export type AssistantSyncAction = "created" | "updated" | "unchanged";

export interface AssistantSyncResult extends AssistantDeployment {
  action: AssistantSyncAction;
}

export class AssistantSyncTargetNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Assistant sync target not found for organization ${organizationId}`);
    this.name = "AssistantSyncTargetNotFoundError";
  }
}

export class SyncVapiAssistant {
  constructor(
    private readonly provider: VoiceAssistantProvider,
    private readonly repository: AssistantSyncRepository,
    private readonly compilerOptions: AssistantCompilerOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(organizationId: string): Promise<AssistantSyncResult> {
    const target = await this.repository.loadTarget(organizationId);
    if (!target) {
      throw new AssistantSyncTargetNotFoundError(organizationId);
    }

    const compiled = compileVapiAssistant(target.source, this.compilerOptions);
    let providerAssistantId = target.deployed?.providerAssistantId;
    let action: AssistantSyncAction;

    if (target.deployed?.configHash === compiled.configHash) {
      action = "unchanged";
    } else if (providerAssistantId) {
      const assistant = await this.provider.updateAssistant(
        providerAssistantId,
        compiled.configuration,
      );
      if (assistant.id !== providerAssistantId) {
        throw new Error("Voice provider changed the assistant identifier during update");
      }
      providerAssistantId = assistant.id;
      action = "updated";
    } else {
      const assistant = await this.provider.createAssistant(compiled.configuration);
      providerAssistantId = assistant.id;
      action = "created";
    }

    if (!providerAssistantId) {
      throw new Error("Voice provider returned no assistant identifier");
    }

    const deployment: AssistantDeployment = {
      organizationId: target.organizationId,
      providerAssistantId,
      configHash: compiled.configHash,
      configVersion: compiled.configVersion,
      promptVersion: compiled.promptVersion,
      toolContractVersion: compiled.toolContractVersion,
      deployedAt:
        action === "unchanged" && target.deployed
          ? target.deployed.deployedAt
          : this.now(),
    };

    await this.repository.commitDeployment(deployment);
    return { ...deployment, action };
  }
}
