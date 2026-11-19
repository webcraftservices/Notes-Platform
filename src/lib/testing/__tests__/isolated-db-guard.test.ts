import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertIsolatedTestDatabaseConfig,
  assertSafeDatabaseForIntegrationTests,
  evaluateIsolatedTestDatabaseEnv,
  extractDatabaseNameFromUrl,
  hasStrictIsolatedTestDb,
  isIsolatedNonSharedDbUrl,
  resolveIsolatedTestDatabaseUrl,
  verifyLiveIsolatedDatabaseIdentity,
} from "../isolated-db-guard";

describe("isolated-db-guard (Phase 2 Test DB Safety)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts database name only for postgres/postgresql URLs", () => {
    expect(extractDatabaseNameFromUrl("postgresql://postgres:postgres@127.0.0.1:5433/zenote_test")).toBe(
      "zenote_test"
    );
    expect(extractDatabaseNameFromUrl("postgres://user:pass@localhost:5432/ci_verify")).toBe(
      "ci_verify"
    );
    expect(extractDatabaseNameFromUrl("mysql://user:pass@localhost:3306/zenote_test")).toBeNull();
    expect(extractDatabaseNameFromUrl("postgresql://postgres:postgres@localhost:5432/")).toBeNull();
  });

  it("rejects shared (/neondb, /postgres, /zenote), production, staging, and Neon remote hosts", () => {
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/neondb")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/postgres")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/zenote")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/zenote_production")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/zenote_staging")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@ep-cool-pooler.us-east-2.aws.neon.tech/zenote_test")).toBe(
      false
    );
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@db.internal.example.com/app_db")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/template1")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5432/neondb/main")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("mysql://u:p@localhost:3306/zenote_test")).toBe(false);
    expect(isIsolatedNonSharedDbUrl("not-a-valid-url")).toBe(false);
    expect(isIsolatedNonSharedDbUrl(undefined)).toBe(false);
  });

  it("accepts localhost/CI isolated test DB URLs, IPv6 bracketed loopback, and non-shared isolated test hostnames", () => {
    expect(isIsolatedNonSharedDbUrl("postgresql://postgres:postgres@127.0.0.1:5433/zenote_test")).toBe(
      true
    );
    expect(isIsolatedNonSharedDbUrl("postgresql://postgres:postgres@[::1]:5433/zenote_local")).toBe(
      true
    );
    expect(isIsolatedNonSharedDbUrl("postgresql://postgres:postgres@postgres:5432/zenote_ci_test")).toBe(
      true
    );
    expect(
      isIsolatedNonSharedDbUrl("postgresql://postgres:postgres@ci-db.local:5432/zenote_test", {
        ALLOW_REMOTE_ISOLATED_TEST_DB: "true",
      })
    ).toBe(true);
    expect(
      isIsolatedNonSharedDbUrl("postgresql://u:p@ep-branch.aws.neon.tech/zenote_isolated", {
        ALLOW_NEON_ISOLATED_TEST_DB: "true",
      })
    ).toBe(true);
  });

  it("requires DATABASE_URL and ISOLATED_TEST_DATABASE_URL to both be set and strictly equal", () => {
    const validUrl = "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test";
    expect(
      evaluateIsolatedTestDatabaseEnv({
        NODE_ENV: "test",
        ISOLATED_TEST_DATABASE_URL: validUrl,
        DATABASE_URL: validUrl,
      })
    ).toEqual({ allowed: true, isolatedUrl: validUrl });

    expect(hasStrictIsolatedTestDb({ NODE_ENV: "test", ISOLATED_TEST_DATABASE_URL: validUrl })).toBe(
      false
    );
    expect(
      resolveIsolatedTestDatabaseUrl({
        NODE_ENV: "test",
        ISOLATED_TEST_DATABASE_URL: validUrl,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/other_test",
      })
    ).toBeNull();
    expect(() =>
      assertIsolatedTestDatabaseConfig({
        NODE_ENV: "production",
        ISOLATED_TEST_DATABASE_URL: validUrl,
        DATABASE_URL: validUrl,
      })
    ).toThrow(/production/i);
  });

  it("assertSafeDatabaseForIntegrationTests preserves strict failure messages", () => {
    expect(() => assertSafeDatabaseForIntegrationTests({ NODE_ENV: "test" }, "")).toThrow(
      /DATABASE_URL is not configured/i
    );
    expect(() =>
      assertSafeDatabaseForIntegrationTests(
        { NODE_ENV: "production" },
        "postgresql://u:p@localhost:5432/zenote_test"
      )
    ).toThrow(/production/i);
    expect(() =>
      assertSafeDatabaseForIntegrationTests(
        { NODE_ENV: "test" },
        "postgresql://u:p@ep-prod.example.com/zenote_production"
      )
    ).toThrow(/production or staging/i);
    expect(() =>
      assertSafeDatabaseForIntegrationTests(
        { NODE_ENV: "test" },
        "postgresql://u:p@localhost:5432/neondb"
      )
    ).toThrow(/shared\/default/i);
    expect(() =>
      assertSafeDatabaseForIntegrationTests(
        { NODE_ENV: "test" },
        "mysql://u:p@localhost:3306/zenote_test"
      )
    ).toThrow(/protocol/i);
    expect(() =>
      assertSafeDatabaseForIntegrationTests(
        { NODE_ENV: "test" },
        "postgresql://u:p@ep-branch.aws.neon.tech/zenote_test"
      )
    ).toThrow(/remote Neon host/i);
  });

  it("never leaks embedded DB credentials or raw URLs in rejected check reasons or thrown errors", () => {
    const secret = "s3cr3t-p@ssw0rd-do-not-leak!";
    const sensitiveUrl = `postgresql://admin:${encodeURIComponent(secret)}@ep-branch.aws.neon.tech/neondb`;

    const evalRes = evaluateIsolatedTestDatabaseEnv({
      NODE_ENV: "test",
      ISOLATED_TEST_DATABASE_URL: sensitiveUrl,
      DATABASE_URL: sensitiveUrl,
    });
    expect(evalRes.allowed).toBe(false);
    expect(evalRes.reason).not.toContain(secret);
    expect(evalRes.reason).not.toContain(encodeURIComponent(secret));
    expect(evalRes.reason).not.toContain("admin:");

    try {
      assertIsolatedTestDatabaseConfig({
        NODE_ENV: "test",
        ISOLATED_TEST_DATABASE_URL: sensitiveUrl,
        DATABASE_URL: sensitiveUrl,
      });
      expect.fail("Expected assertIsolatedTestDatabaseConfig to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain(encodeURIComponent(secret));
      expect(msg).not.toContain("admin:");
    }

    try {
      assertSafeDatabaseForIntegrationTests({ NODE_ENV: "test" }, sensitiveUrl);
      expect.fail("Expected assertSafeDatabaseForIntegrationTests to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain(encodeURIComponent(secret));
      expect(msg).not.toContain("admin:");
    }
  });

  it("verifyLiveIsolatedDatabaseIdentity validates SELECT current_database() against expected DB name", async () => {
    const mockGoodClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ current_database: "zenote_test" }]),
    };
    await expect(
      verifyLiveIsolatedDatabaseIdentity(
        mockGoodClient,
        "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test"
      )
    ).resolves.toBe("zenote_test");

    const mockSharedClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ current_database: "neondb" }]),
    };
    await expect(
      verifyLiveIsolatedDatabaseIdentity(
        mockSharedClient,
        "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test"
      )
    ).rejects.toThrow(/non-isolated database/i);

    const mockMismatchClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ current_database: "other_test" }]),
    };
    await expect(
      verifyLiveIsolatedDatabaseIdentity(
        mockMismatchClient,
        "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test"
      )
    ).rejects.toThrow(/does not match expected isolated URL database/i);
  });

  describe("adversarial regression test suite (9 security scenarios)", () => {
    it("scenario 1: rejects missing, undefined, empty, and malformed URLs", () => {
      expect(isIsolatedNonSharedDbUrl("")).toBe(false);
      expect(isIsolatedNonSharedDbUrl(undefined)).toBe(false);
      expect(isIsolatedNonSharedDbUrl("   ")).toBe(false);
      expect(isIsolatedNonSharedDbUrl("not-a-valid-url")).toBe(false);
      expect(isIsolatedNonSharedDbUrl("http://")).toBe(false);
      expect(isIsolatedNonSharedDbUrl("://invalid")).toBe(false);
      expect(extractDatabaseNameFromUrl("")).toBeNull();
      expect(extractDatabaseNameFromUrl("not a url")).toBeNull();
    });

    it("scenario 2: rejects when DATABASE_URL !== ISOLATED_TEST_DATABASE_URL", () => {
      const urlA = "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test";
      const urlB = "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test_alt";
      const res = evaluateIsolatedTestDatabaseEnv({
        NODE_ENV: "test",
        DATABASE_URL: urlA,
        ISOLATED_TEST_DATABASE_URL: urlB,
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/must strictly equal/i);
    });

    it("scenario 3: rejects unexpected remote host with test-like DB name without ALLOW_REMOTE_ISOLATED_TEST_DB='true'", () => {
      const remoteTestUrl = "postgresql://user:pass@some-random-cloud-host.net:5432/my_app_test";
      expect(isIsolatedNonSharedDbUrl(remoteTestUrl, {})).toBe(false);
      expect(isIsolatedNonSharedDbUrl(remoteTestUrl, { ALLOW_REMOTE_ISOLATED_TEST_DB: "false" })).toBe(false);
    });

    it("scenario 4: accepts unexpected remote host with test-like DB name only when ALLOW_REMOTE_ISOLATED_TEST_DB='true'", () => {
      const remoteTestUrl = "postgresql://user:pass@some-random-cloud-host.net:5432/my_app_test";
      expect(isIsolatedNonSharedDbUrl(remoteTestUrl, { ALLOW_REMOTE_ISOLATED_TEST_DB: "true" })).toBe(true);

      // Even with opt-in, non-test DB name is still rejected
      const nonTestUrl = "postgresql://user:pass@some-random-cloud-host.net:5432/production_data";
      expect(isIsolatedNonSharedDbUrl(nonTestUrl, { ALLOW_REMOTE_ISOLATED_TEST_DB: "true" })).toBe(false);
    });

    it("scenario 5: rejects production and staging hostnames and database names across patterns", () => {
      const prodUrls = [
        "postgresql://u:p@db-prod.internal:5432/test_db",
        "postgresql://u:p@production.database.azure.com:5432/ci_test",
        "postgresql://u:p@staging-db.internal:5432/ephemeral_test",
        "postgresql://u:p@127.0.0.1:5432/prod_zenote",
        "postgresql://u:p@localhost:5432/staging_db",
        "postgresql://u:p@localhost:5432/live_db",
      ];
      for (const url of prodUrls) {
        expect(isIsolatedNonSharedDbUrl(url, { ALLOW_REMOTE_ISOLATED_TEST_DB: "true" })).toBe(false);
      }
    });

    it("scenario 6: rejects shared and default database names", () => {
      const sharedNames = ["neondb", "postgres", "zenote", "defaultdb", "template0", "template1"];
      for (const name of sharedNames) {
        expect(isIsolatedNonSharedDbUrl(`postgresql://u:p@127.0.0.1:5432/${name}`)).toBe(false);
        expect(isIsolatedNonSharedDbUrl(`postgresql://u:p@localhost:5432/${name}`)).toBe(false);
      }
    });

    it("scenario 7: rejects non-PostgreSQL protocols", () => {
      const nonPgUrls = [
        "mysql://root:root@localhost:3306/zenote_test",
        "mongodb://localhost:27017/zenote_test",
        "sqlite:///tmp/test.db",
        "http://localhost:5432/zenote_test",
        "https://localhost:5432/zenote_test",
      ];
      for (const url of nonPgUrls) {
        expect(isIsolatedNonSharedDbUrl(url)).toBe(false);
        expect(extractDatabaseNameFromUrl(url)).toBeNull();
      }
    });

    it("scenario 8: handles IPv4 and IPv6 loopback edge cases correctly", () => {
      expect(isIsolatedNonSharedDbUrl("postgresql://u:p@127.0.0.1:5433/zenote_test")).toBe(true);
      expect(isIsolatedNonSharedDbUrl("postgresql://u:p@[::1]:5433/zenote_test")).toBe(true);
      expect(isIsolatedNonSharedDbUrl("postgresql://u:p@localhost:5433/zenote_test")).toBe(true);

      // Path traversal or slashes in dbName must be rejected
      expect(isIsolatedNonSharedDbUrl("postgresql://u:p@127.0.0.1:5433/test/../../other")).toBe(false);
    });

    it("scenario 9: throws on connected DB identity mismatch in verifyLiveIsolatedDatabaseIdentity", async () => {
      const expectedUrl = "postgresql://postgres:postgres@127.0.0.1:5433/zenote_test";

      // 1. Client returns shared database name
      const sharedClient = { $queryRaw: vi.fn().mockResolvedValue([{ current_database: "postgres" }]) };
      await expect(verifyLiveIsolatedDatabaseIdentity(sharedClient, expectedUrl)).rejects.toThrow(
        /non-isolated database/i
      );

      // 2. Client returns wrong test database name
      const wrongClient = { $queryRaw: vi.fn().mockResolvedValue([{ current_database: "other_test" }]) };
      await expect(verifyLiveIsolatedDatabaseIdentity(wrongClient, expectedUrl)).rejects.toThrow(
        /does not match expected/i
      );

      // 3. Client returns correct database name -> resolves cleanly
      const correctClient = { $queryRaw: vi.fn().mockResolvedValue([{ current_database: "zenote_test" }]) };
      await expect(verifyLiveIsolatedDatabaseIdentity(correctClient, expectedUrl)).resolves.toBe("zenote_test");
    });
  });
});
