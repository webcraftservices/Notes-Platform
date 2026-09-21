import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleMaterial: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const jobs = vi.hoisted(() => ({ createJobIfNoneActive: vi.fn() }));
vi.mock("@/lib/processing-jobs", () => jobs);

const runner = vi.hoisted(() => ({ runTranscriptionJob: vi.fn() }));
vi.mock("@/lib/transcription", () => runner);

const rl = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rl);

vi.mock("@/lib/observability/datadog", () => ({ sendDatadogMetric: vi.fn(), sendDatadogLog: vi.fn() }));

import { POST } from "@/app/api/materials/[materialId]/transcribe/route";

const call = () =>
  POST(new Request("https://example.test/api/materials/mat-1/transcribe", { method: "POST" }), {
    params: { materialId: "mat-1" },
  });

describe("POST /api/materials/[id]/transcribe", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleMaterial.mockResolvedValue({ id: "mat-1", type: "AUDIO", status: "READY" });
    rl.rateLimit.mockResolvedValue({ success: true, remaining: 9 });
    jobs.createJobIfNoneActive.mockResolvedValue({ job: { id: "job-1" }, created: true });
  });

  it("starts exactly one job and returns 202", async () => {
    const res = await call();

    expect(res.status).toBe(202);
    expect(jobs.createJobIfNoneActive).toHaveBeenCalledWith({ userId: "user-1", materialId: "mat-1", type: "TRANSCRIPTION" });
    expect(runner.runTranscriptionJob).toHaveBeenCalledTimes(1);
    expect(runner.runTranscriptionJob).toHaveBeenCalledWith("job-1");
  });

  it("a duplicate request (double click / client retry) gets the SAME job back and starts NO second paid transcription", async () => {
    jobs.createJobIfNoneActive.mockResolvedValue({ job: { id: "job-existing" }, created: false });

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).job.id).toBe("job-existing");
    expect(runner.runTranscriptionJob).not.toHaveBeenCalled();
  });

  it("is rate limited per user before anything expensive happens", async () => {
    rl.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

    const res = await call();

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("TRANSCRIBE_RATE_LIMITED");
    expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    expect(runner.runTranscriptionJob).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before rate limiting or job creation", async () => {
    access.getSessionUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(rl.rateLimit).not.toHaveBeenCalled();
  });

  it("refuses non-media materials and not-yet-uploaded files without creating a job", async () => {
    access.getAccessibleMaterial.mockResolvedValue({ id: "mat-1", type: "PDF", status: "READY" });
    expect((await call()).status).toBe(400);

    access.getAccessibleMaterial.mockResolvedValue({ id: "mat-1", type: "AUDIO", status: "UPLOADING" });
    expect((await call()).status).toBe(409);

    expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
  });
});
