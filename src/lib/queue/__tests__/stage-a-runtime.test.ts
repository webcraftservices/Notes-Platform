import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBullMqTlsOptions,
  createBullMqRedisConnection,
  isBullMqEnabled,
  isDedicatedWorkerMode,
  isEmbeddedMaintenanceEnabled,
  isEmbeddedWorkerEnabled,
  redactRedisConfig,
  resolveBullMqRedisConfig,
} from "@/lib/queue/connection";
import {
  classifyRuntimeError,
  redactSensitiveText,
} from "@/lib/queue/logger";

describe("Stage A — Production Runtime Hardening, Web/Worker Separation & TLS", () => {
  describe("Web / Worker process flag separation", () => {
    it("keeps BullMQ producer enabled while disabling embedded worker and maintenance in dedicated worker mode", () => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        REDIS_URL: "redis://redis:6379",
        BULLMQ_DEDICATED_WORKER: "true",
      };

      expect(isBullMqEnabled(env)).toBe(true);
      expect(isDedicatedWorkerMode(env)).toBe(true);
      expect(isEmbeddedWorkerEnabled(env)).toBe(false);
      expect(isEmbeddedMaintenanceEnabled(env)).toBe(false);
    });

    it("supports explicit BULLMQ_EMBEDDED_WORKER=false while keeping queue dispatch active", () => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        REDIS_URL: "redis://redis:6379",
        BULLMQ_EMBEDDED_WORKER: "false",
      };

      expect(isBullMqEnabled(env)).toBe(true);
      expect(isDedicatedWorkerMode(env)).toBe(false);
      expect(isEmbeddedWorkerEnabled(env)).toBe(false);
      expect(isEmbeddedMaintenanceEnabled(env)).toBe(false);
    });

    it("preserves single-process embedded mode by default when dedicated flag is unset", () => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "development",
        REDIS_URL: "redis://127.0.0.1:6379",
      };

      expect(isBullMqEnabled(env)).toBe(true);
      expect(isDedicatedWorkerMode(env)).toBe(false);
      expect(isEmbeddedWorkerEnabled(env)).toBe(true);
      expect(isEmbeddedMaintenanceEnabled(env)).toBe(true);
    });
  });

  describe("Redis TLS verification & infinite backoff resilience", () => {
    it("enforces TLS certificate verification (rejectUnauthorized: true) by default on rediss:// connections", () => {
      const resolved = resolveBullMqRedisConfig({
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: "https://example-upstash.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "secret-token-value",
      });
      expect(resolved).not.toBeNull();
      expect(resolved?.tls).toBe(true);

      const tlsOptions = buildBullMqTlsOptions(resolved!, { NODE_ENV: "production" });
      expect(tlsOptions).toEqual({
        rejectUnauthorized: true,
        servername: "example-upstash.upstash.io",
      });
    });

    it("allows explicit opt-out via BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED=false only when requested", () => {
      const resolved = resolveBullMqRedisConfig({
        NODE_ENV: "development",
        BULLMQ_REDIS_URL: "rediss://default:pass@localhost:6380",
      });
      const tlsOptions = buildBullMqTlsOptions(resolved!, {
        NODE_ENV: "development",
        BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED: "false",
      });
      expect(tlsOptions?.rejectUnauthorized).toBe(false);
    });

    it("omits TLS options for plain redis:// connections", () => {
      const resolved = resolveBullMqRedisConfig({
        NODE_ENV: "development",
        REDIS_URL: "redis://redis:6379",
      });
      expect(resolved?.tls).toBe(false);
      expect(buildBullMqTlsOptions(resolved!)).toBeUndefined();
    });

    it("continues retrying past 5 failed attempts with capped exponential backoff instead of permanently failing", async () => {
      const conn = createBullMqRedisConnection(
        { lazyConnect: true },
        { NODE_ENV: "production", REDIS_URL: "redis://127.0.0.1:6399" }
      );
      try {
        const retryStrategy = conn.options.retryStrategy;
        expect(typeof retryStrategy).toBe("function");
        const delay1 = retryStrategy!(1);
        const delay5 = retryStrategy!(5);
        const delay10 = retryStrategy!(10);
        const delay25 = retryStrategy!(25);

        expect(typeof delay1).toBe("number");
        expect(typeof delay5).toBe("number");
        expect(typeof delay10).toBe("number");
        expect(typeof delay25).toBe("number");
        expect(delay10!).toBeGreaterThan(0);
        expect(delay25!).toBeLessThanOrEqual(15_250);
      } finally {
        conn.disconnect();
      }
    });

    it("honors explicit maxReconnectAttempts when bounded retries are requested", async () => {
      const conn = createBullMqRedisConnection(
        { lazyConnect: true },
        { NODE_ENV: "production", REDIS_URL: "redis://127.0.0.1:6399" },
        { maxReconnectAttempts: 3 }
      );
      try {
        const retryStrategy = conn.options.retryStrategy;
        expect(typeof retryStrategy!(3)).toBe("number");
        expect(retryStrategy!(4)).toBeNull();
      } finally {
        conn.disconnect();
      }
    });

    it("redacts connection credentials from telemetry and log messages", () => {
      const resolved = resolveBullMqRedisConfig({
        NODE_ENV: "production",
        BULLMQ_REDIS_URL: "rediss://default:super-secret-password@redis.example.com:6379",
      });
      const redacted = redactRedisConfig(resolved);
      expect(JSON.stringify(redacted)).not.toContain("super-secret-password");
      expect(redacted).toEqual({
        source: "BULLMQ_REDIS_URL",
        host: "redis.example.com",
        port: 6379,
        tls: true,
      });

      const scrubbed = redactSensitiveText(
        "Failed connecting to rediss://default:my-pass@host:6379 with Bearer abc.def.ghi"
      );
      expect(scrubbed).not.toContain("my-pass");
      expect(scrubbed).not.toContain("abc.def.ghi");
      expect(scrubbed).toContain("rediss://<redacted>@host:6379");
      expect(scrubbed).toContain("Bearer <redacted>");
      expect(classifyRuntimeError({ code: "ECONNREFUSED" })).toBe("ECONNREFUSED");
    });
  });

  describe("Google webhook production secret fail-closed check", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it(
      "throws in production when GOOGLE_WEBHOOK_SECRET, GOOGLE_TOKEN_ENCRYPTION_KEY, and NEXTAUTH_SECRET are all unset",
      async () => {
        (process.env as Record<string, string | undefined>).NODE_ENV = "production";
        delete process.env.GOOGLE_WEBHOOK_SECRET;
        delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
        delete process.env.NEXTAUTH_SECRET;

        const { hashWatchChannelToken } = await import("@/lib/google-drive-sync");
        expect(() => hashWatchChannelToken("sample-token")).toThrow(
          /webhook signing secret is not configured/i
        );
      },
      15_000
    );
  });

  describe("Next.js standalone configuration & dynamic storage CSP origin", () => {
    const originalEndpoint = process.env.STORAGE_ENDPOINT;

    afterEach(() => {
      if (originalEndpoint === undefined) {
        delete process.env.STORAGE_ENDPOINT;
      } else {
        process.env.STORAGE_ENDPOINT = originalEndpoint;
      }
    });

    it("enables standalone output and dynamically injects STORAGE_ENDPOINT origin into CSP connect-src", async () => {
      process.env.STORAGE_ENDPOINT = "https://custom-storage.example.com/bucket-path";
      const localRequire = createRequire(import.meta.url);
      const nextConfigPath = localRequire.resolve("../../../../next.config.js");
      delete localRequire.cache[nextConfigPath];
      const nextConfig = localRequire(nextConfigPath);
      expect(nextConfig.output).toBe("standalone");

      const headersResult = await nextConfig.headers();
      const csp = headersResult[0].headers.find(
        (h: { key: string; value: string }) => h.key === "Content-Security-Policy"
      )?.value;
      expect(csp).toContain("https://custom-storage.example.com");
      expect(csp).toContain("connect-src 'self'");
    });
  });
});
