import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceAssistantProvider } from "./provider.js";
import {
  SyncVapiAssistant,
  type AssistantDeployment,
  type AssistantSyncRepository,
  type AssistantSyncTarget,
} from "./sync-assistant.js";

const target: AssistantSyncTarget = {
  organizationId: "organization-1",
  source: {
    businessName: "Reliable Heating",
    timezone: "America/Chicago",
    configVersion: 3,
    promptVersion: "prompt-2",
    toolContractVersion: "tools-1",
    model: { provider: "openai", model: "gpt-4o-mini" },
    voice: { provider: "vapi", voiceId: "Elliot" },
    transcriber: { provider: "deepgram", model: "nova-3" },
    recording: { enabled: false },
  },
  deployed: null,
};

function harness(overrides?: Partial<AssistantSyncTarget>) {
  const providerCalls: string[] = [];
  const deployments: AssistantDeployment[] = [];
  const repository: AssistantSyncRepository = {
    async loadTarget() {
      return { ...target, ...overrides };
    },
    async commitDeployment(deployment) {
      deployments.push(deployment);
    },
  };
  const provider: VoiceAssistantProvider = {
    async createAssistant() {
      providerCalls.push("create");
      return { id: "assistant-created" };
    },
    async updateAssistant(id) {
      providerCalls.push(`update:${id}`);
      return { id };
    },
  };
  const service = new SyncVapiAssistant(
    provider,
    repository,
    {
      voiceApiBaseUrl: "https://voice.example.com/",
      serverCredentialId: "credential-1",
    },
    () => new Date("2026-09-05T12:00:00.000Z"),
  );
  return { service, providerCalls, deployments, provider };
}

test("creates and persists a first tenant assistant", async () => {
  const { service, providerCalls, deployments } = harness();
  const result = await service.execute(target.organizationId);

  assert.equal(result.action, "created");
  assert.equal(result.providerAssistantId, "assistant-created");
  assert.deepEqual(providerCalls, ["create"]);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.toolContractVersion, "tools-1");
});

test("patches an existing assistant only when its hash changed", async () => {
  const { service, providerCalls } = harness({
    deployed: {
      providerAssistantId: "assistant-existing",
      configHash: "stale-hash",
      configVersion: 2,
      promptVersion: "prompt-1",
      toolContractVersion: "tools-1",
      deployedAt: new Date("2026-09-04T12:00:00.000Z"),
    },
  });

  const result = await service.execute(target.organizationId);
  assert.equal(result.action, "updated");
  assert.deepEqual(providerCalls, ["update:assistant-existing"]);
});

test("does not call Vapi when the deterministic hash is unchanged", async () => {
  const first = harness();
  const created = await first.service.execute(target.organizationId);
  const second = harness({
    deployed: {
      providerAssistantId: created.providerAssistantId,
      configHash: created.configHash,
      configVersion: created.configVersion,
      promptVersion: created.promptVersion,
      toolContractVersion: created.toolContractVersion,
      deployedAt: created.deployedAt,
    },
  });

  const result = await second.service.execute(target.organizationId);
  assert.equal(result.action, "unchanged");
  assert.deepEqual(second.providerCalls, []);
  assert.equal(second.deployments.length, 1);
  assert.equal(result.deployedAt.toISOString(), "2026-09-05T12:00:00.000Z");
});

test("never records a deployment when the provider request fails", async () => {
  const setup = harness();
  setup.provider.createAssistant = async () => {
    throw new Error("provider unavailable");
  };

  await assert.rejects(
    setup.service.execute(target.organizationId),
    /provider unavailable/,
  );
  assert.deepEqual(setup.deployments, []);
});
