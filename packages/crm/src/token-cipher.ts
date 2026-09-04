import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FORMAT_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class CredentialCipherError extends Error {
  constructor(message = "Unable to decrypt credential") {
    super(message);
    this.name = "CredentialCipherError";
  }
}

export interface CredentialCipher {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

export class AesGcmTokenCipher implements CredentialCipher {
  private readonly key: Buffer;

  constructor(
    key: Uint8Array,
    private readonly keyVersion: string,
  ) {
    if (key.byteLength !== 32) {
      throw new Error("OAuth token encryption key must contain exactly 32 bytes");
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyVersion)) {
      throw new Error("OAuth token key version contains unsupported characters");
    }
    this.key = Buffer.from(key);
  }

  encrypt(plaintext: string): string {
    if (!plaintext) throw new Error("Credential plaintext is required");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(`${FORMAT_VERSION}:${this.keyVersion}`));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      this.keyVersion,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(envelope: string): string {
    try {
      const [format, keyVersion, encodedIv, encodedTag, encodedCiphertext, extra] =
        envelope.split(".");
      if (
        extra !== undefined ||
        format !== FORMAT_VERSION ||
        keyVersion !== this.keyVersion ||
        !encodedIv ||
        !encodedTag ||
        !encodedCiphertext
      ) {
        throw new CredentialCipherError();
      }
      const decipher = createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(encodedIv, "base64url"),
      );
      decipher.setAAD(Buffer.from(`${format}:${keyVersion}`));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      if (error instanceof CredentialCipherError) throw error;
      throw new CredentialCipherError();
    }
  }
}
