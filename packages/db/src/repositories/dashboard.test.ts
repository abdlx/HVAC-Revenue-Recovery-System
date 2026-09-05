import assert from "node:assert/strict";
import test from "node:test";
import { maskPhone } from "./dashboard.js";

test("maskPhone exposes only the last four digits", () => {
  assert.equal(maskPhone("+16025551234"), "••• ••• 1234");
  assert.equal(maskPhone(null), "Unknown caller");
  assert.equal(maskPhone("911"), "••••");
});
