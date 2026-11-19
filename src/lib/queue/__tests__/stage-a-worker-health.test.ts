import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function isLoopbackTcpBlocked(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      const client = net.connect({ host: "127.0.0.1", port }, () => {
        client.destroy();
        s.close(() => resolve(false));
      });
      client.on("error", (err: any) => {
        client.destroy();
        s.close(() => resolve(err.code === "EACCES"));
      });
    });
    s.on("error", () => resolve(true));
  });
}

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  $disconnect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db", () => ({ db }));

vi.mock("@/lib/queue/reconciliation", () => ({
  reconcileStrandedProcessingJobs: vi.fn().mockResolvedValue({
    scannedJobs: 0,
    requeuedJobs: 0,
    failedExhaustedJobs: 0,
    strandedMaterialsRecovered: 0,
    requeuedJobIds: [],
    failedJobIds: [],
  }),
  runScheduledWatchChannelRenewal: vi.fn().mockResolvedValue({
    checked: 0,
    renewed: 0,
    failed: 0,
  }),
  pruneCompletedProcessingJobs: vi.fn().mockResolvedValue({ deletedCount: 0 }),
}));

import { startWorkerHealthServer } from "@/workers/index";
import { stopProcessingWorker, isWorkerDraining } from "@/lib/queue/worker";

describe("Stage A — Compiled Worker Runtime & Health Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  });

  afterEach(async () => {
    await stopProcessingWorker().catch(() => undefined);
  });

  it("serves /live and /health JSON telemetry cleanly without exposing secrets", async (ctx) => {
    if (await isLoopbackTcpBlocked()) {
      ctx.skip();
      return;
    }
    const server = await startWorkerHealthServer(0);
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const liveRes = await fetch(`${baseUrl}/live`);
      expect(liveRes.status).toBe(200);
      const liveJson = await liveRes.json();
      expect(liveJson).toMatchObject({
        status: "alive",
        service: "zenote-worker",
      });

      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson).toMatchObject({
        status: "ok",
        service: "zenote-worker",
        database: "connected",
      });
      expect(JSON.stringify(healthJson)).not.toMatch(/DATABASE_URL|NEXTAUTH_SECRET|redis:\/\//i);
      expect(errorSpy).not.toHaveBeenCalled();

      // Returns 503 if database becomes unreachable and emits rate-limited structured unhealthy log (NEW-04)
      db.$queryRaw.mockRejectedValueOnce(new Error("connection lost"));
      const unhealthyRes1 = await fetch(`${baseUrl}/health`);
      expect(unhealthyRes1.status).toBe(503);
      const unhealthyJson = await unhealthyRes1.json();
      expect(unhealthyJson.database).toBe("unreachable");
      expect(unhealthyJson.status).toBe("error");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errorSpy.mock.calls[0])).toContain("worker_health_unhealthy");
      expect(JSON.stringify(errorSpy.mock.calls[0])).not.toMatch(/DATABASE_URL|NEXTAUTH_SECRET|redis:\/\//i);

      // Immediate repeat 503 with same signature is rate-limited inside cooldown window
      db.$queryRaw.mockRejectedValueOnce(new Error("still unreachable"));
      const unhealthyRes2 = await fetch(`${baseUrl}/health`);
      expect(unhealthyRes2.status).toBe(503);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // Returning healthy resets cooldown so a subsequent failure logs again
      const recoveredRes = await fetch(`${baseUrl}/health`);
      expect(recoveredRes.status).toBe(200);
      db.$queryRaw.mockRejectedValueOnce(new Error("lost again"));
      const unhealthyRes3 = await fetch(`${baseUrl}/health`);
      expect(unhealthyRes3.status).toBe(503);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("marks worker as draining on stopProcessingWorker and reflects 503 on /live", async (ctx) => {
    if (await isLoopbackTcpBlocked()) {
      ctx.skip();
      return;
    }
    await stopProcessingWorker();
    expect(isWorkerDraining()).toBe(true);

    const server = await startWorkerHealthServer(0);
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const liveRes = await fetch(`${baseUrl}/live`);
      expect(liveRes.status).toBe(503);
      expect((await liveRes.json()).status).toBe("draining");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("produces a self-contained compiled dist/workers/index.cjs without unresolved @/ aliases or tsx requirement", () => {
    const bundlePath = path.resolve(process.cwd(), "dist/workers/index.cjs");
    if (!fs.existsSync(bundlePath)) {
      execSync("node scripts/build-worker.mjs", { stdio: "pipe" });
    }
    expect(fs.existsSync(bundlePath)).toBe(true);
    const code = fs.readFileSync(bundlePath, "utf8");
    expect(code.length).toBeGreaterThan(10_000);
    expect(code).not.toMatch(/(?:require|import)\(["']@\/[^"']+["']\)/);
  });
});

