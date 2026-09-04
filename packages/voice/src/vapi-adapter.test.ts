import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceAssistantConfiguration } from "./provider.js";
import { VapiAdapter, VapiApiError } from "./vapi-adapter.js";

const configuration: VoiceAssistantConfiguration = {
  name: "Test Assistant",
  firstMessage: "Hello",
  server: { url: "https://voice.example.com/v1/webhooks/vapi", credentialId: "cred-1" },
  serverMessages: ["status-update", "end-of-call-report"],
  model: { provider: "openai", model: "gpt-4.1-mini" },
  voice: { provider: "vapi", voiceId: "Jordan" },
  transcriber: { provider: "deepgram", model: "nova-3" },
  artifactPlan: { recordingEnabled: false, transcriptPlan: { enabled: true } },
};

test("creates assistants with the private server key", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const adapter = new VapiAdapter({
    privateKey: "private-key-at-least-twenty-characters",
    fetch: async (input, init) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return Response.json({ id: "assistant-1" }, { status: 201 });
    },
  });

  assert.deepEqual(await adapter.createAssistant(configuration), {
    id: "assistant-1",
  });
  assert.equal(requests[0]?.input, "https://api.vapi.ai/assistant");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(
    (requests[0]?.init?.headers as Record<string, string>).authorization,
    "Bearer private-key-at-least-twenty-characters",
  );
});

test("returns a sanitized error without leaking the private key", async () => {
  const privateKey = "private-key-at-least-twenty-characters";
  const adapter = new VapiAdapter({
    privateKey,
    fetch: async () =>
      Response.json({ message: `bad key ${privateKey}` }, { status: 401 }),
  });

  await assert.rejects(
    () => adapter.createAssistant(configuration),
    (error: unknown) => {
      assert.ok(error instanceof VapiApiError);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(privateKey), false);
      return true;
    },
  );
});
