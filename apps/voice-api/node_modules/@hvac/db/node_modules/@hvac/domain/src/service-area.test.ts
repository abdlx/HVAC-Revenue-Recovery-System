import assert from "node:assert/strict";
import test from "node:test";
import { CheckServiceArea, type ServiceAreaRepository } from "./service-area.js";

test("returns the tenant-scoped matching ZIP", async () => {
  const repository: ServiceAreaRepository = {
    async findActiveZipForCall(callId, zipCode) {
      assert.equal(callId, "call-1");
      assert.equal(zipCode, "85032");
      return { serviceZone: "north-phoenix", notesForAgent: null };
    },
    async ping() {
      return true;
    },
  };

  const result = await new CheckServiceArea(repository).execute("call-1", "85032");

  assert.deepEqual(result, {
    serviced: true,
    service_zone: "north-phoenix",
    notes_for_agent: null,
  });
});

test("fails closed when no tenant-scoped ZIP matches", async () => {
  const repository: ServiceAreaRepository = {
    async findActiveZipForCall() {
      return null;
    },
    async ping() {
      return true;
    },
  };

  const result = await new CheckServiceArea(repository).execute("unknown", "90210");

  assert.equal(result.serviced, false);
  assert.equal(result.service_zone, null);
  assert.match(result.notes_for_agent ?? "", /outside/i);
});
