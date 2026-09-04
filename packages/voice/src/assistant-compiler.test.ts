import assert from "node:assert/strict";
import test from "node:test";
import { compileVapiAssistant, type TenantAssistantSource } from "./assistant-compiler.js";

function source(): TenantAssistantSource {
  return {
    businessName: "Desert Air HVAC",
    timezone: "America/Phoenix",
    configVersion: 3,
    promptVersion: "hvac-inbound-v1",
    toolContractVersion: "v1",
    model: { provider: "openai", model: "gpt-4.1-mini" },
    voice: { provider: "vapi", voiceId: "Jordan" },
    transcriber: { provider: "deepgram", model: "nova-3", language: "en" },
    recording: { enabled: false },
  };
}

test("compiles a deterministic, tenant-safe Vapi assistant", () => {
  const first = compileVapiAssistant(source(), {
    voiceApiBaseUrl: "https://voice.example.com/",
    serverCredentialId: "credential-1",
  });
  const second = compileVapiAssistant(source(), {
    voiceApiBaseUrl: "https://voice.example.com",
    serverCredentialId: "credential-1",
  });

  assert.equal(first.configHash, second.configHash);
  assert.equal(first.configuration.artifactPlan.recordingEnabled, false);
  assert.deepEqual(first.configuration.serverMessages, [
    "status-update",
    "end-of-call-report",
  ]);
  assert.equal(
    first.configuration.server.url,
    "https://voice.example.com/v1/webhooks/vapi",
  );
  const serialized = JSON.stringify(first.configuration);
  assert.match(serialized, /check_service_area/);
  assert.match(serialized, /request_human/);
  assert.match(serialized, /Never accept a phone number, tenant ID/);
  assert.equal(serialized.includes("organization_id"), false);
  assert.equal(serialized.includes("+16025550100"), false);
});

test("requires disclosure text when recording is enabled", () => {
  const input = source();
  input.recording = { enabled: true };

  assert.throws(
    () =>
      compileVapiAssistant(input, {
        voiceApiBaseUrl: "https://voice.example.com",
        serverCredentialId: "credential-1",
      }),
    /disclosure/i,
  );
});
