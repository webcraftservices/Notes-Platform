/**
 * Centralized isolated PostgreSQL safety guard for live integration tests and workers.
 *
 * Enforces fail-closed invariants so live integration suites NEVER touch shared Neon (`/neondb`),
 * production, or staging databases, and never run when `DATABASE_URL` and
 * `ISOLATED_TEST_DATABASE_URL` diverge.
 */

export interface IsolatedDbCheckResult {
  allowed: boolean;
  isolatedUrl: string | null;
  reason?: string;
}

const SHARED_DB_NAMES = new Set([
  "neondb",
  "postgres",
  "zenote",
  "defaultdb",
  "template0",
  "template1",
]);
const PROD_OR_STAGING_RE = /(^|[-_./])(prod|production|staging|live|primary|master)([-_./]|$)/i;
const ALLOWED_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
  "db",
  "test-postgres",
]);

export function extractDatabaseNameFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return null;
    }
    const dbName = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return dbName.length > 0 ? dbName : null;
  } catch {
    return null;
  }
}

/**
 * Validates that a single URL points to an isolated, non-shared, non-production/staging PostgreSQL database.
 */
export function isIsolatedNonSharedDbUrl(
  rawUrl: string | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!rawUrl || !rawUrl.trim()) return false;
  if (rawUrl.includes("..")) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return false;
  }

  const dbPath = parsed.pathname.replace(/\/+$/, "");
  const dbName = dbPath.replace(/^\/+/, "").toLowerCase();
  if (!dbName || SHARED_DB_NAMES.has(dbName) || dbName.startsWith("neondb/")) {
    return false;
  }

  // Reject invalid path characters (path traversal, slashes, or whitespace)
  if (dbName.includes("/") || dbName.includes("..") || /\s/.test(dbName)) {
    return false;
  }

  const hostLower = parsed.hostname.toLowerCase();
  // Reject shared/cloud Neon hosts unless explicitly allowed on non-shared DBs
  if (hostLower.endsWith(".neon.tech") && env.ALLOW_NEON_ISOLATED_TEST_DB !== "true") {
    return false;
  }

  const hostAndPath = `${hostLower}${dbPath.toLowerCase()}`;
  if (PROD_OR_STAGING_RE.test(hostAndPath)) {
    return false;
  }

  // Require either a known local/CI container hostname OR explicit remote opt-in
  const hasExplicitTestDbName = /(test|ci|isolated|verify|verification|ephemeral|spec)/i.test(dbName);
  const isKnownLocalOrContainerHost = ALLOWED_LOCAL_HOSTS.has(hostLower);

  if (isKnownLocalOrContainerHost) {
    return true;
  }

  if (hostLower.endsWith(".neon.tech")) {
    return env.ALLOW_NEON_ISOLATED_TEST_DB === "true" && hasExplicitTestDbName;
  }

  // Any other remote host requires explicit ALLOW_REMOTE_ISOLATED_TEST_DB opt-in AND a test-like DB name
  return env.ALLOW_REMOTE_ISOLATED_TEST_DB === "true" && hasExplicitTestDbName;
}

/**
 * Evaluates strict isolation for live PostgreSQL integration suites:
 * 1. `NODE_ENV`/`VERCEL_ENV`/`APP_ENV` must NOT be `production`
 * 2. Both `ISOLATED_TEST_DATABASE_URL` and `DATABASE_URL` must be non-empty
 * 3. `DATABASE_URL === ISOLATED_TEST_DATABASE_URL` (strict equality, no fallback mismatch)
 * 4. The URL must pass `isIsolatedNonSharedDbUrl`
 */
export function evaluateIsolatedTestDatabaseEnv(
  env: Record<string, string | undefined> = process.env
): IsolatedDbCheckResult {
  if (
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.APP_ENV === "production"
  ) {
    return {
      allowed: false,
      isolatedUrl: null,
      reason: "Refusing live PostgreSQL integration tests in production environment.",
    };
  }

  const isolatedUrl = env.ISOLATED_TEST_DATABASE_URL?.trim() ?? "";
  const activeUrl = env.DATABASE_URL?.trim() ?? "";

  if (!isolatedUrl) {
    return {
      allowed: false,
      isolatedUrl: null,
      reason: "ISOLATED_TEST_DATABASE_URL is not configured.",
    };
  }

  if (!activeUrl) {
    return {
      allowed: false,
      isolatedUrl: null,
      reason: "DATABASE_URL is not configured.",
    };
  }

  if (activeUrl !== isolatedUrl) {
    return {
      allowed: false,
      isolatedUrl: null,
      reason: "DATABASE_URL must strictly equal ISOLATED_TEST_DATABASE_URL for live integration tests.",
    };
  }

  if (!isIsolatedNonSharedDbUrl(isolatedUrl, env)) {
    return {
      allowed: false,
      isolatedUrl: null,
      reason: "ISOLATED_TEST_DATABASE_URL does not target a safe isolated test database.",
    };
  }

  return { allowed: true, isolatedUrl };
}

export function resolveIsolatedTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  return evaluateIsolatedTestDatabaseEnv(env).isolatedUrl;
}

export function hasStrictIsolatedTestDb(
  env: Record<string, string | undefined> = process.env
): boolean {
  return evaluateIsolatedTestDatabaseEnv(env).allowed;
}

/**
 * Validates that a single DATABASE_URL is safe for integration testing (non-production,
 * non-staging, valid URL, non-shared DB). Throws descriptive errors on violation.
 */
export function assertSafeDatabaseForIntegrationTests(
  env: Record<string, string | undefined> = process.env,
  databaseUrl: string | undefined = env.DATABASE_URL
): void {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error("Refusing to run PostgreSQL integration tests: DATABASE_URL is not configured.");
  }

  if (
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.APP_ENV === "production"
  ) {
    throw new Error(
      "Refusing to run PostgreSQL integration tests when NODE_ENV/VERCEL_ENV/APP_ENV is 'production'."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl.trim());
  } catch {
    throw new Error("Refusing to run PostgreSQL integration tests: DATABASE_URL is not a valid URL.");
  }

  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error(
      "Refusing to run PostgreSQL integration tests: DATABASE_URL must use postgres:// or postgresql:// protocol."
    );
  }

  const hostLower = parsedUrl.hostname.toLowerCase();
  const hostAndPath = `${hostLower}${parsedUrl.pathname}`.toLowerCase();
  if (PROD_OR_STAGING_RE.test(hostAndPath) && env.ALLOW_SEARCH_PG_INTEGRATION_TEST !== "true") {
    throw new Error(
      "Refusing to run PostgreSQL integration tests against a database host/name matching production or staging patterns without ALLOW_SEARCH_PG_INTEGRATION_TEST='true'."
    );
  }

  if (hostLower.endsWith(".neon.tech") && env.ALLOW_NEON_ISOLATED_TEST_DB !== "true") {
    throw new Error(
      "Refusing to run PostgreSQL integration tests against a remote Neon host without ALLOW_NEON_ISOLATED_TEST_DB='true'."
    );
  }

  const dbName = extractDatabaseNameFromUrl(databaseUrl)?.toLowerCase() ?? "";
  if (!dbName || SHARED_DB_NAMES.has(dbName) || dbName.startsWith("neondb/")) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests against shared/default database '${dbName || "<empty>"}'.`
    );
  }
}

/**
 * Throws unless both `ISOLATED_TEST_DATABASE_URL` and `DATABASE_URL` are present, equal,
 * and point to an isolated non-shared database.
 */
export function assertIsolatedTestDatabaseConfig(
  env: Record<string, string | undefined> = process.env
): string {
  const check = evaluateIsolatedTestDatabaseEnv(env);
  if (!check.allowed || !check.isolatedUrl) {
    throw new Error(`SAFETY GUARD: ${check.reason ?? "Isolated test database check failed."}`);
  }
  return check.isolatedUrl;
}

/**
 * Queries `SELECT current_database()` on an active Prisma client and verifies the connected
 * live database is isolated, non-shared, and matches the expected database name from URL.
 */
export async function verifyLiveIsolatedDatabaseIdentity(
  client: {
    $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  },
  expectedDatabaseUrl?: string
): Promise<string> {
  const rows = await client.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const dbName = rows[0]?.current_database?.trim();
  if (!dbName) {
    throw new Error("SAFETY GUARD: Could not determine active PostgreSQL current_database().");
  }

  const normalized = dbName.toLowerCase();
  if (SHARED_DB_NAMES.has(normalized) || PROD_OR_STAGING_RE.test(normalized)) {
    throw new Error(
      `SAFETY GUARD: Refusing live execution on non-isolated database '${dbName}'.`
    );
  }

  if (expectedDatabaseUrl) {
    const expectedDbName = extractDatabaseNameFromUrl(expectedDatabaseUrl);
    if (!expectedDbName || dbName !== expectedDbName) {
      throw new Error(
        `SAFETY GUARD: Connected database '${dbName}' does not match expected isolated URL database '${expectedDbName ?? "unknown"}'.`
      );
    }
  }

  return dbName;
}
