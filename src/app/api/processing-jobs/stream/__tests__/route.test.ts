import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleProcessingJob: vi.fn(),
  getAccessibleMaterial: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const db = vi.hoisted(() => ({
  processingJob: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

import { GET } from "@/app/api/processing-jobs/stream/route";
import { GET as GET_BY_ID } from "@/app/api/processing-jobs/[jobId]/stream/route";
import { GET as GET_JOB_POLL } from "@/app/api/processing-jobs/[jobId]/route";
import { emitProcessingJobEvent } from "@/lib/queue/events";

async function readStreamTextUntilClosed(res: Response, maxChunks = 10): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let output = "";
  for (let i = 0; i < maxChunks; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}

describe("GET /api/processing-jobs/stream & /api/processing-jobs/[jobId]/stream (Task 15-03)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
  });

  it("rejects unauthenticated requests with 401", async () => {
    access.getSessionUser.mockResolvedValueOnce(null);
    const res = await GET(new Request("https://example.test/api/processing-jobs/stream?jobId=j1"));
    expect(res.status).toBe(401);
  });

  it("enforces multi-tenant RBAC: returns 403 when user is not authorized for the job or material, and 404 when not found", async () => {
    access.getAccessibleProcessingJob.mockRejectedValueOnce(
      new access.NotAuthorizedError("Forbidden")
    );
    const forbiddenJob = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-other-tenant")
    );
    expect(forbiddenJob.status).toBe(403);

    access.getAccessibleProcessingJob.mockResolvedValueOnce(null);
    const missingJob = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-missing")
    );
    expect(missingJob.status).toBe(404);

    access.getAccessibleMaterial.mockRejectedValueOnce(
      new access.NotAuthorizedError("Forbidden material")
    );
    const forbiddenMat = await GET(
      new Request("https://example.test/api/processing-jobs/stream?materialId=mat-other")
    );
    expect(forbiddenMat.status).toBe(403);
  });

  it("emits initial job snapshot and closes immediately when job is already in a terminal state (SUCCEEDED)", async () => {
    access.getAccessibleProcessingJob.mockResolvedValueOnce({
      id: "job-done",
      userId: "user-1",
      materialId: "mat-1",
      type: "AI_NOTE_GENERATION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      updatedAt: new Date("2026-11-13T12:00:00.000Z"),
    });
    access.getAccessibleMaterial.mockResolvedValueOnce({ id: "mat-1" });

    const res = await GET_BY_ID(
      new Request("https://example.test/api/processing-jobs/job-done/stream", {
        headers: { "Last-Event-ID": "100-1" },
      }),
      { params: { jobId: "job-done" } }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const text = await readStreamTextUntilClosed(res);
    expect(text).toContain(": connected resume=100-1");
    expect(text).toContain("event: job-status");
    expect(text).toContain('"id":"job-done"');
    expect(text).toContain('"status":"SUCCEEDED"');
  });

  it("streams real-time RUNNING -> SUCCEEDED transitions and ignores events from unrelated jobs", async () => {
    access.getAccessibleProcessingJob.mockResolvedValueOnce({
      id: "job-live-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "TRANSCRIPTION",
      status: "QUEUED",
      progress: 0,
      error: null,
      updatedAt: new Date("2026-11-13T12:00:00.000Z"),
    });
    access.getAccessibleMaterial.mockResolvedValue({ id: "mat-1" });

    const res = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-live-1")
    );

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial connection + QUEUED snapshot
    let buffered = "";
    while (!buffered.includes('"status":"QUEUED"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
    }
    expect(buffered).toContain('"status":"QUEUED"');

    // Emit an unrelated job event (must be filtered out)
    emitProcessingJobEvent({
      jobId: "job-unrelated",
      userId: "user-2",
      materialId: "mat-2",
      type: "EMBEDDING",
      status: "RUNNING",
      progress: 50,
      error: null,
    });

    // Emit RUNNING and then SUCCEEDED for job-live-1
    emitProcessingJobEvent({
      jobId: "job-live-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "TRANSCRIPTION",
      status: "RUNNING",
      progress: 45,
      error: null,
    });

    emitProcessingJobEvent({
      jobId: "job-live-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "TRANSCRIPTION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
    });

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
    }

    expect(buffered).not.toContain("job-unrelated");
    expect(buffered).toContain('"status":"RUNNING"');
    expect(buffered).toContain('"progress":45');
    expect(buffered).toContain('"status":"SUCCEEDED"');
  });

  it("cleans up stream resources cleanly when the client aborts the request", async () => {
    access.getAccessibleProcessingJob.mockResolvedValueOnce({
      id: "job-abort-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "DOCUMENT_EXTRACTION",
      status: "RUNNING",
      progress: 20,
      error: null,
      updatedAt: new Date(),
    });
    access.getAccessibleMaterial.mockResolvedValueOnce({ id: "mat-1" });

    const abortController = new AbortController();
    const res = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-abort-1", {
        signal: abortController.signal,
      })
    );

    const reader = res.body!.getReader();
    await reader.read(); // first chunk (: connected)
    abortController.abort();

    // Drain any already-buffered initial snapshot chunk and verify stream closes
    let closed = false;
    for (let i = 0; i < 5; i++) {
      const step = await reader.read();
      if (step.done) {
        closed = true;
        break;
      }
    }
    expect(closed).toBe(true);
  });

  it("syncs user-scoped SSE stream changes from PostgreSQL across web/worker processes", async () => {
    vi.useFakeTimers();
    try {
      db.processingJob.findMany
        .mockResolvedValueOnce([
          {
            id: "job-cross-1",
            userId: "user-1",
            materialId: "mat-1",
            type: "DOCUMENT_EXTRACTION",
            status: "RUNNING",
            progress: 25,
            error: null,
            updatedAt: new Date("2026-11-14T12:00:00.000Z"),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "job-cross-1",
            userId: "user-1",
            materialId: "mat-1",
            type: "DOCUMENT_EXTRACTION",
            status: "SUCCEEDED",
            progress: 100,
            error: null,
            updatedAt: new Date("2026-11-14T12:00:05.000Z"),
          },
        ]);

      const abortController = new AbortController();
      const res = await GET(
        new Request("https://example.test/api/processing-jobs/stream", {
          signal: abortController.signal,
        })
      );

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let initialChunk = "";
      while (!initialChunk.includes('"status":"RUNNING"')) {
        const { done, value } = await reader.read();
        if (done) break;
        initialChunk += decoder.decode(value, { stream: true });
      }
      expect(initialChunk).toContain('"id":"job-cross-1"');

      await vi.advanceTimersByTimeAsync(2600);
      const { value: pollChunk } = await reader.read();
      const pollText = decoder.decode(pollChunk, { stream: true });
      expect(pollText).toContain('"status":"SUCCEEDED"');

      abortController.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes immediately without querying DB snapshots when req.signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const res = await GET(
      new Request("https://example.test/api/processing-jobs/stream", {
        signal: abortController.signal,
      })
    );

    expect(res.status).toBe(200);
    const text = await readStreamTextUntilClosed(res);
    expect(text).toBe("");
    expect(db.processingJob.findMany).not.toHaveBeenCalled();
  });

  it("prevents overlapping DB sync polls when a previous poll takes longer than 2500ms", async () => {
    vi.useFakeTimers();
    try {
      let resolveSlowPoll: (rows: unknown[]) => void = () => {};
      db.processingJob.findMany
        .mockResolvedValueOnce([]) // initial active jobs snapshot
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSlowPoll = resolve;
            })
        )
        .mockResolvedValueOnce([]);

      const abortController = new AbortController();
      const res = await GET(
        new Request("https://example.test/api/processing-jobs/stream", {
          signal: abortController.signal,
        })
      );

      const reader = res.body!.getReader();
      await reader.read(); // : connected

      expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);

      // Advance across two 2500ms intervals while the first poll promise stays pending
      await vi.advanceTimersByTimeAsync(2600);
      expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2600);
      // Overlap guard must skip launching a third concurrent poll while the second is still in-flight
      expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);

      resolveSlowPoll([]);
      await Promise.resolve();
      await Promise.resolve();

      // Next interval tick proceeds normally once in-flight poll completes
      await vi.advanceTimersByTimeAsync(2600);
      expect(db.processingJob.findMany).toHaveBeenCalledTimes(3);

      abortController.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects mismatched composite ?jobId=&materialId= scopes with 404 (AUD-02)", async () => {
    access.getAccessibleProcessingJob.mockResolvedValueOnce({
      id: "job-1",
      userId: "user-1",
      materialId: "mat-actual",
      type: "DOCUMENT_EXTRACTION",
      status: "RUNNING",
      progress: 10,
      error: null,
      updatedAt: new Date(),
    });
    access.getAccessibleMaterial.mockResolvedValueOnce({ id: "mat-other" });

    const res = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-1&materialId=mat-other")
    );
    expect(res.status).toBe(404);
  });

  it("ignores cross-user events on jobId stream and closes materialId stream immediately if group access is revoked (AUD-02)", async () => {
    access.getAccessibleMaterial
      .mockResolvedValueOnce({ id: "mat-shared" }) // upfront check
      .mockRejectedValueOnce(new access.NotAuthorizedError("Removed from group")); // live re-check on cross-user event

    db.processingJob.findMany.mockResolvedValueOnce([]);

    const res = await GET(
      new Request("https://example.test/api/processing-jobs/stream?materialId=mat-shared")
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read connection frame
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain(": connected");

    // Emit a cross-user event on the previously shared material after access was revoked
    emitProcessingJobEvent({
      jobId: "job-other-user",
      userId: "user-2",
      materialId: "mat-shared",
      type: "AI_NOTE_GENERATION",
      status: "RUNNING",
      progress: 80,
      error: null,
    });

    // Stream must close without leaking the cross-user event
    let trailing = "";
    for (let i = 0; i < 5; i++) {
      const step = await reader.read();
      if (step.done) break;
      trailing += decoder.decode(step.value, { stream: true });
    }
    expect(trailing).not.toContain("job-other-user");
    expect(access.getAccessibleMaterial).toHaveBeenCalledTimes(2);
  });

  it("re-verifies materialId access on periodic DB sync ticks and closes on revocation (AUD-02)", async () => {
    vi.useFakeTimers();
    try {
      access.getAccessibleMaterial
        .mockResolvedValueOnce({ id: "mat-shared-2" })
        .mockResolvedValueOnce(null);

      db.processingJob.findMany.mockResolvedValue([]);

      const res = await GET(
        new Request("https://example.test/api/processing-jobs/stream?materialId=mat-shared-2")
      );
      const reader = res.body!.getReader();
      await reader.read(); // : connected

      await vi.advanceTimersByTimeAsync(2600);
      const step = await reader.read();
      expect(step.done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up stream resources cleanly if reader.cancel() fires while initial snapshot query is pending (AUD-02)", async () => {
    let resolveFindMany: (rows: unknown[]) => void = () => {};
    db.processingJob.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFindMany = resolve;
        })
    );

    const res = await GET(new Request("https://example.test/api/processing-jobs/stream"));
    const reader = res.body!.getReader();
    await reader.read(); // : connected
    await reader.cancel();

    resolveFindMany([
      {
        id: "job-late",
        userId: "user-1",
        materialId: "mat-1",
        type: "EMBEDDING",
        status: "RUNNING",
        progress: 50,
        error: null,
        updatedAt: new Date(),
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);
  });

  it("enforces upfront material authorization for jobId-only SSE streams and GET /api/processing-jobs/[jobId] (NEW-03)", async () => {
    access.getAccessibleProcessingJob.mockResolvedValue({
      id: "job-revoked-mat",
      userId: "user-1",
      materialId: "mat-group-revoked",
      type: "AI_NOTE_GENERATION",
      status: "RUNNING",
      progress: 50,
      error: null,
      updatedAt: new Date(),
    });
    access.getAccessibleMaterial.mockRejectedValueOnce(
      new access.NotAuthorizedError("Removed from group")
    );

    const streamForbidden = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-revoked-mat")
    );
    expect(streamForbidden.status).toBe(403);

    access.getAccessibleMaterial.mockResolvedValueOnce(null);
    const streamNotFound = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-revoked-mat")
    );
    expect(streamNotFound.status).toBe(404);

    access.getAccessibleMaterial.mockRejectedValueOnce(
      new access.NotAuthorizedError("Removed from group")
    );
    const pollForbidden = await GET_JOB_POLL(
      new Request("https://example.test/api/processing-jobs/job-revoked-mat"),
      { params: { jobId: "job-revoked-mat" } }
    );
    expect(pollForbidden.status).toBe(403);
  });

  it("revalidates same-user events on materialId and jobId-only streams and closes on revocation (NEW-03)", async () => {
    // 1. Same-user event on materialId stream after access revoked
    access.getAccessibleMaterial
      .mockResolvedValueOnce({ id: "mat-shared-same-user" })
      .mockRejectedValueOnce(new access.NotAuthorizedError("Removed from group"));
    db.processingJob.findMany.mockResolvedValueOnce([]);

    const matRes = await GET(
      new Request("https://example.test/api/processing-jobs/stream?materialId=mat-shared-same-user")
    );
    const matReader = matRes.body!.getReader();
    const decoder = new TextDecoder();
    await matReader.read(); // : connected

    emitProcessingJobEvent({
      jobId: "job-same-user-1",
      userId: "user-1",
      materialId: "mat-shared-same-user",
      type: "TRANSCRIPTION",
      status: "RUNNING",
      progress: 60,
      error: null,
    });

    let matTrailing = "";
    for (let i = 0; i < 5; i++) {
      const step = await matReader.read();
      if (step.done) break;
      matTrailing += decoder.decode(step.value, { stream: true });
    }
    expect(matTrailing).not.toContain("job-same-user-1");

    // 2. jobId-only stream mid-stream revocation on bus event
    access.getAccessibleProcessingJob.mockResolvedValueOnce({
      id: "job-mat-revoked-mid",
      userId: "user-1",
      materialId: "mat-revoked-mid",
      type: "AI_NOTE_GENERATION",
      status: "RUNNING",
      progress: 30,
      error: null,
      updatedAt: new Date(),
    });
    access.getAccessibleMaterial
      .mockResolvedValueOnce({ id: "mat-revoked-mid" }) // upfront
      .mockResolvedValueOnce(null); // revoked before event emission

    const jobRes = await GET(
      new Request("https://example.test/api/processing-jobs/stream?jobId=job-mat-revoked-mid")
    );
    expect(jobRes.status).toBe(200);
    const jobReader = jobRes.body!.getReader();
    let initialBuf = "";
    while (!initialBuf.includes('"progress":30')) {
      const chunk = await jobReader.read();
      if (chunk.done) break;
      initialBuf += decoder.decode(chunk.value, { stream: true });
    }
    expect(initialBuf).toContain('"progress":30');

    emitProcessingJobEvent({
      jobId: "job-mat-revoked-mid",
      userId: "user-1",
      materialId: "mat-revoked-mid",
      type: "AI_NOTE_GENERATION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
    });

    let jobTrailing = "";
    for (let i = 0; i < 5; i++) {
      const step = await jobReader.read();
      if (step.done) break;
      jobTrailing += decoder.decode(step.value, { stream: true });
    }
    expect(jobTrailing).not.toContain('"status":"SUCCEEDED"');
  });

  it("closes jobId-only stream within 2500ms periodic DB poll if shared material access is revoked quietly (NEW-03)", async () => {
    vi.useFakeTimers();
    try {
      access.getAccessibleProcessingJob.mockResolvedValueOnce({
        id: "job-quiet-revoke",
        userId: "user-1",
        materialId: "mat-quiet-revoke",
        type: "DOCUMENT_EXTRACTION",
        status: "RUNNING",
        progress: 15,
        error: null,
        updatedAt: new Date(),
      });
      access.getAccessibleMaterial
        .mockResolvedValueOnce({ id: "mat-quiet-revoke" }) // upfront
        .mockRejectedValueOnce(new access.NotAuthorizedError("Revoked")); // periodic poll

      const res = await GET(
        new Request("https://example.test/api/processing-jobs/stream?jobId=job-quiet-revoke")
      );
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let initialBuf = "";
      while (!initialBuf.includes('"progress":15')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        initialBuf += decoder.decode(chunk.value, { stream: true });
      }
      expect(initialBuf).toContain('"progress":15');

      await vi.advanceTimersByTimeAsync(2600);
      const step = await reader.read();
      expect(step.done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leak fail-open poll policy into fail-closed bus listener when coalescing transient errors (NEW-03)", async () => {
    vi.useFakeTimers();
    try {
      let rejectAuthCheck!: (err: Error) => void;
      access.getAccessibleMaterial
        .mockResolvedValueOnce({ id: "mat-transient" }) // upfront
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectAuthCheck = reject;
            })
        );

      db.processingJob.findMany.mockResolvedValue([]);

      const abortController = new AbortController();
      const res = await GET(
        new Request("https://example.test/api/processing-jobs/stream?materialId=mat-transient", {
          signal: abortController.signal,
        })
      );
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      await reader.read(); // : connected

      // Trigger periodic poll first (failOnTransientError = false) while keeping check pending
      await vi.advanceTimersByTimeAsync(2600);
      expect(access.getAccessibleMaterial).toHaveBeenCalledTimes(2);

      // Concurrent bus event (failOnTransientError = true) joins the same in-flight check
      emitProcessingJobEvent({
        jobId: "job-during-transient",
        userId: "user-2",
        materialId: "mat-transient",
        type: "EMBEDDING",
        status: "RUNNING",
        progress: 77,
        error: null,
      });
      expect(access.getAccessibleMaterial).toHaveBeenCalledTimes(2); // single-flight coalesced!

      // Transient DB error occurs -> poll must survive, bus event MUST fail closed (NOT emitted)
      rejectAuthCheck(new Error("ECONNRESET transient timeout"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Next valid check proves stream remained open AND leaked nothing from transient event
      access.getAccessibleMaterial.mockResolvedValueOnce({ id: "mat-transient" });
      emitProcessingJobEvent({
        jobId: "job-after-recovery",
        userId: "user-2",
        materialId: "mat-transient",
        type: "EMBEDDING",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
      });

      const nextChunk = await reader.read();
      const text = decoder.decode(nextChunk.value);
      expect(text).toContain("job-after-recovery");
      expect(text).not.toContain("job-during-transient");

      abortController.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT query or emit jobs during periodic dbSyncTimer ticks when material access check suffers a transient error (NEW-03)", async () => {
    vi.useFakeTimers();
    try {
      access.getAccessibleMaterial
        .mockResolvedValueOnce({ id: "mat-blip" })
        .mockRejectedValueOnce(new Error("ECONNRESET transient DB blip"));
      db.processingJob.findMany.mockResolvedValue([
        {
          id: "job-leaked-on-blip",
          userId: "user-2",
          materialId: "mat-blip",
          type: "EMBEDDING",
          status: "RUNNING",
          progress: 50,
          error: null,
          updatedAt: new Date("2026-11-16T12:00:00.000Z"),
        },
      ]);

      const abortController = new AbortController();
      const res = await GET(
        new Request("https://example.test/api/processing-jobs/stream?materialId=mat-blip", {
          signal: abortController.signal,
        })
      );
      const reader = res.body!.getReader();
      await reader.read(); // : connected
      await reader.read(); // initial snapshot
      db.processingJob.findMany.mockClear();

      // Periodic sync tick hits transient DB error -> MUST NOT poll db.processingJob
      await vi.advanceTimersByTimeAsync(2600);
      expect(db.processingJob.findMany).not.toHaveBeenCalled();

      abortController.abort();
    } finally {
      vi.useRealTimers();
    }
  });
});
