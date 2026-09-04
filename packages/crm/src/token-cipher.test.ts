import assert from "node:assert/strict";
import test from "node:test";
import { AesGcmTokenCipher, CredentialCipherError } from "./token-cipher.js";

test("encrypts OAuth tokens with authenticated encryption", () => {
  const cipher = new AesGcmTokenCipher(Buffer.alloc(32, 7), "key-1");
  const encrypted = cipher.encrypt("refresh-token-secret");

  assert.doesNotMatch(encrypted, /refresh-token-secret/);
  assert.equal(cipher.decrypt(encrypted), "refresh-token-secret");
});

test("rejects tampered OAuth token ciphertext", () => {
  const cipher = new AesGcmTokenCipher(Buffer.alloc(32, 7), "key-1");
  const encrypted = cipher.encrypt("refresh-token-secret");
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

  assert.throws(() => cipher.decrypt(tampered), CredentialCipherError);
});
