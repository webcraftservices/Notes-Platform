import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  processingJob: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: { updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/observability/datadog", () => ({ sendDatadogMetric: vi.fn().mockResolvedValue(undefined) }));

import {
  claimJob,
  createJobIfNoneActive,
  failJob,
  INTERRUPTED_JOB_MESSAGE,
  staleAfterMs,
} from "@/lib/processing-jobs";

const input = { userId: "user-1", materialId: "mat-1", type: "TRANSCRIPTION" as const };

describe("createJobIfNoneActive", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.processingJob.updateMany.mockResolvedValue({ count: 0 });
  });

  it("creates a QUEUED job when none is active", async () => {
    tx.processingJob.findFirst.mockResolvedValue(null);
    tx.processingJob.create.mockResolvedValue({ id: "job-new", status: "QUEUED" });

    const result = await createJobIfNoneActive(input);

    expect(result).toEqual({ job: { id: "job-new", status: "QUEUED" }, created: true });
    expect(tx.processingJob.create).toHaveBeenCalledWith({
      data: { userId: "user-1", materialId: "mat-1", type: "TRANSCRIPTION", status: "QUEUED" },
    });
  });

  it("returns the existing active job instead of creating a second one (double submit)", async () => {
    tx.processingJob.findFirst.mockResolvedValue({ id: "job-existing", status: "RUNNING" });

    const result = await createJobIfNoneActive(input);

    expect(result).toEqual({ job: { id: "job-existing", status: "RUNNING" }, created: false });
    expect(tx.processingJob.create).not.toHaveBeenCalled();
  });

  it("takes a transaction-scoped advisory lock BEFORE checking for an active job, so check+create is atomic", async () => {
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(async () => void order.push("lock"));
    tx.processingJob.updateMany.mockImplementation(async () => (order.push("reap"), { count: 0 }));
    tx.processingJob.findFirst.mockImplementation(async () => (order.push("find"), null));
    tx.processingJob.create.mockImplementation(async () => (order.push("create"), { id: "j" }));

    await createJobIfNoneActive(input);

    expect(order).toEqual(["lock", "reap", "find", "create"]);
  });

  it("marks jobs stranded past the stale threshold as FAILED (interrupted) before deciding whether one is active", async () => {
    tx.processingJob.findFirst.mockResolvedValue(null);
    tx.processingJob.create.mockResolvedValue({ id: "j" });
    const before = Date.now();

    await createJobIfNoneActive(input);

    const call = tx.processingJob.updateMany.mock.calls[0]![0];
    expect(call.data).toMatchObject({ status: "FAILED", error: INTERRUPTED_JOB_MESSAGE });
    expect(call.where.materialId).toBe("mat-1");
    expect(call.where.type).toBe("TRANSCRIPTION");
    const cutoffs = call.where.OR.map((c: { startedAt?: { lt: Date }; createdAt?: { lt: Date } }) =>
      (c.startedAt ?? c.createdAt)!.lt.getTime()
    );
    for (const cutoff of cutoffs) {
      expect(cutoff).toBeLessThanOrEqual(before - staleAfterMs("TRANSCRIPTION") + 1000);
      expect(cutoff).toBeGreaterThan(before - staleAfterMs("TRANSCRIPTION") - 5000);
    }
  });

  it("never treats a healthy long-running job as stale: thresholds far exceed the longest legitimate run", () => {
    // AssemblyAI polling alone is capped at 20 minutes.
    expect(staleAfterMs("TRANSCRIPTION")).toBeGreaterThan(20 * 60 * 1000);
    expect(staleAfterMs("GOOGLE_SYNC")).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });
});

describe("claimJob", () => {
  beforeEach(() => vi.resetAllMocks());

  it("moves QUEUED → RUNNING with a status-guarded update and reports whether this caller won", async () => {
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });
    expect(await claimJob("job-1")).toBe(true);
    expect(db.processingJob.updateMany.mock.calls[0]![0].where).toEqual({ id: "job-1", status: "QUEUED" });

    db.processingJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimJob("job-1")).toBe(false);
  });
});

describe("failJob", () => {
  beforeEach(() => vi.resetAllMocks());

  it("only overwrites a job that is still QUEUED/RUNNING — a SUCCEEDED job is never flipped back to FAILED", async () => {
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });

    await failJob("job-1", "EMBEDDING", new Error("boom"), "fallback");

    const call = db.processingJob.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "job-1", status: { in: ["QUEUED", "RUNNING"] } });
    expect(call.data).toMatchObject({ status: "FAILED", error: "boom" });
  });

  it("never throws even if recording the failure itself fails (no unhandled rejection from `void runXJob()`)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.processingJob.updateMany.mockRejectedValue(new Error("connection terminated"));

    await expect(failJob("job-1", "EMBEDDING", new Error("boom"), "fallback")).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("uses the fallback message for non-Error throwables and caps very long messages", async () => {
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });

    await failJob("job-1", "EMBEDDING", "a string, not an Error", "fallback text");
    expect(db.processingJob.updateMany.mock.calls[0]![0].data.error).toBe("fallback text");

    await failJob("job-2", "EMBEDDING", new Error("x".repeat(5000)), "fallback");
    expect(db.processingJob.updateMany.mock.calls[1]![0].data.error.length).toBeLessThanOrEqual(1001);
  });
});
