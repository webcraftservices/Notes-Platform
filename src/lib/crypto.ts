import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Symmetric encryption for secrets that must be stored at rest — currently
 * only Google OAuth access/refresh tokens on ConnectedAccount (Phase 7; see
 * that model's schema comment: "Tokens are encrypted at rest by the
 * application layer before being written here").
 *
 * Key material is derived from GOOGLE_TOKEN_ENCRYPTION_KEY when set, falling
 * back to NEXTAUTH_SECRET so a working install never needs a second secret
 * just to connect Google Drive — NEXTAUTH_SECRET is already required for the
 * app to boot at all. Production deployments that want to rotate the token
 * key independently of session signing can set GOOGLE_TOKEN_ENCRYPTION_KEY
 * explicitly. Either way scryptSync stretches it into a proper 32-byte key
 * rather than using a short human-chosen string directly as AES key bytes.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended nonce length for GCM

function getKey(): Buffer {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Cannot encrypt/decrypt Google tokens: neither GOOGLE_TOKEN_ENCRYPTION_KEY nor " +
        "NEXTAUTH_SECRET is set."
    );
  }
  // Fixed salt is acceptable here: this derives a single, stable app-wide
  // key from one secret, not per-user password hashing.
  return scryptSync(secret, "notes-platform.google-token-encryption", 32);
}

/** Returns `iv:authTag:ciphertext`, each base64-encoded. */
export function encryptSecret(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted value.");
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
