import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signs/verifies the OAuth `state` parameter for the Google connect flow.
 * Encodes { userId, nonce, issuedAt } and HMAC-signs it with NEXTAUTH_SECRET
 * — this gets CSRF protection (spec §8) and binds the callback back to the
 * user who started the flow without needing a database table just to hold
 * a short-lived, single-use value. The nonce has no server-side replay
 * check (a state value could technically be reused within the TTL window),
 * which is an acceptable trade-off for a value that never grants anything
 * by itself — it only tells the callback route "this really is a
 * continuation of a connect request this app started", not "authorize
 * this action".
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a consent-screen round trip

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET must be set to use Google OAuth state signing.");
  return secret;
}

export function signOAuthState(userId: string): string {
  const payload = JSON.stringify({ userId, nonce: crypto.randomUUID(), issuedAt: Date.now() });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const signature = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

export function verifyOAuthState(state: string, expectedUserId: string): boolean {
  const [payloadB64, signature] = state.split(".");
  if (!payloadB64 || !signature) return false;

  const expectedSignature = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      userId: string;
      issuedAt: number;
    };
    if (payload.userId !== expectedUserId) return false;
    if (Date.now() - payload.issuedAt > STATE_TTL_MS) return false;
    return true;
  } catch {
    return false;
  }
}
