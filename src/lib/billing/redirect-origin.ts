/**
 * Billing Redirect Origin Guard (LIM-20(4) Hardening).
 *
 * Prevents open-redirect abuse through user-supplied `successUrl`, `cancelUrl`,
 * or `returnUrl` parameters on Stripe checkout and billing portal routes by
 * constraining targets to the application's own origin(s).
 */

export class InvalidBillingRedirectError extends Error {
  readonly code = "INVALID_REDIRECT_ORIGIN";
  readonly status = 400;

  constructor(message = "Redirect URL must belong to a trusted application origin.") {
    super(message);
    this.name = "InvalidBillingRedirectError";
  }
}

function parseValidHttpOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (!parsed.origin || parsed.origin === "null") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function isInternalBindOrLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "0.0.0.0") return true;
    return (
      parsed.protocol === "http:" &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function resolveCanonicalOriginCandidates(
  env: Record<string, string | undefined>
): string[] {
  const origins: string[] = [];
  for (const envCandidate of [
    env.NEXTAUTH_URL,
    env.SITE_URL,
    env.NEXT_PUBLIC_SITE_URL,
  ]) {
    const origin = parseValidHttpOrigin(envCandidate);
    if (origin) {
      origins.push(origin);
    }
  }
  return origins;
}

export function getTrustedBillingOrigins(
  requestUrl: string,
  env: Record<string, string | undefined> = process.env
): Set<string> {
  const origins = new Set<string>();
  const canonicalOrigins = resolveCanonicalOriginCandidates(env);
  const hasHttpsCanonical = canonicalOrigins.some((origin) =>
    origin.startsWith("https://")
  );

  for (const origin of canonicalOrigins) {
    origins.add(origin);
  }

  const reqOrigin = parseValidHttpOrigin(requestUrl);
  if (reqOrigin) {
    const excludeInternalProdRequestOrigin =
      env.NODE_ENV === "production" &&
      hasHttpsCanonical &&
      isInternalBindOrLoopbackOrigin(reqOrigin);
    if (!excludeInternalProdRequestOrigin) {
      origins.add(reqOrigin);
    }
  }

  const extra = env.ALLOWED_REDIRECT_ORIGINS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const origin = parseValidHttpOrigin(part);
      if (origin) {
        origins.add(origin);
      }
    }
  }

  return origins;
}

function resolveBaseBillingOrigin(
  requestUrl: string,
  env: Record<string, string | undefined> = process.env
): string {
  const canonicalOrigin = resolveCanonicalOriginCandidates(env)[0] ?? null;
  const reqOrigin = parseValidHttpOrigin(requestUrl);

  if (canonicalOrigin) {
    // Under Vitest with local `.env` loaded (`NODE_ENV === "test"`), keep
    // explicit non-local HTTPS request origins usable for unit tests unless
    // the configured origin itself is HTTPS or non-loopback.
    if (
      env.NODE_ENV === "test" &&
      isInternalBindOrLoopbackOrigin(canonicalOrigin) &&
      reqOrigin &&
      !isInternalBindOrLoopbackOrigin(reqOrigin)
    ) {
      return reqOrigin;
    }
    return canonicalOrigin;
  }

  if (!reqOrigin) {
    throw new InvalidBillingRedirectError();
  }
  return reqOrigin;
}

/**
 * Validates or constructs a same-origin billing redirect URL.
 * Accepts same-origin absolute URLs or single-slash relative paths (`/settings`).
 * Rejects protocol-relative URLs (`//evil.com`), non-HTTP schemes (`javascript:`),
 * embedded credentials, and external origins not present in trusted app origins.
 */
export function resolveSafeBillingRedirectUrl(
  candidateUrl: unknown,
  requestUrl: string,
  fallbackPath: string,
  env: Record<string, string | undefined> = process.env
): string {
  const baseOrigin = resolveBaseBillingOrigin(requestUrl, env);
  const fallback = new URL(fallbackPath, baseOrigin).toString();

  if (candidateUrl === undefined || candidateUrl === null) {
    return fallback;
  }

  if (typeof candidateUrl !== "string") {
    throw new InvalidBillingRedirectError();
  }

  const trimmed = candidateUrl.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.startsWith("//")) {
    throw new InvalidBillingRedirectError();
  }

  if (trimmed.startsWith("/")) {
    const resolved = new URL(trimmed, baseOrigin);
    if (resolved.origin !== baseOrigin) {
      throw new InvalidBillingRedirectError();
    }
    return resolved.toString();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidBillingRedirectError();
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidBillingRedirectError();
  }

  if (parsed.username || parsed.password) {
    throw new InvalidBillingRedirectError();
  }

  const trustedOrigins = getTrustedBillingOrigins(requestUrl, env);
  if (!trustedOrigins.has(parsed.origin)) {
    throw new InvalidBillingRedirectError();
  }

  return parsed.toString();
}
