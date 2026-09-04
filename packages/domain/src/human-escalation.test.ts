import assert from "node:assert/strict";
import test from "node:test";
import { RequestHuman, type HumanEscalationRepository } from "./human-escalation.js";

test("fails safely to callback when no transfer destination is configured", async () => {
  const repository: HumanEscalationRepository = {
    async resolveAndRecordHumanRequest(request) {
      assert.equal(request.vapiCallId, "call-1");
      assert.equal(request.reasonCode, "CUSTOMER_REQUESTED_HUMAN");
      return null;
    },
  };

  const result = await new RequestHuman(repository).execute({
    vapiCallId: "call-1",
    toolCallId: "tool-1",
    reasonCode: "CUSTOMER_REQUESTED_HUMAN",
    priority: "NORMAL",
  });

  assert.equal(result.action, "CALLBACK");
  assert.equal(result.destination, null);
  assert.match(result.notesForAgent, /call them back/i);
});
