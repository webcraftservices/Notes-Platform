import { describe, expect, it, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-not-used-in-production-32bytes";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext string", () => {
    const plain = "ya29.a0AfH6SMB_fake_access_token";
    const encrypted = encryptSecret(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plain = "1//0g_fake_refresh_token";
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it("never stores the plaintext token directly in the encrypted output", () => {
    const plain = "super-secret-token-value";
    expect(encryptSecret(plain)).not.toContain(plain);
  });

  it("rejects a malformed encrypted value", () => {
    expect(() => decryptSecret("not-a-valid-encoded-value")).toThrow();
  });

  it("rejects a tampered ciphertext", () => {
    const encrypted = encryptSecret("some-token");
    const [iv, tag, data] = encrypted.split(":");
    const tampered = [iv, tag, Buffer.from("tampered").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
