import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleMaterial: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);
const db = vi.hoisted(() => ({ transcript: { findUnique: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));
const jobs = vi.hoisted(() => ({ createJobIfNoneActive: vi.fn() }));
vi.mock("@/lib/processing-jobs", () => jobs);
const runner = vi.hoisted(() => ({ runNoteGenerationJob: vi.fn() }));
vi.mock("@/lib/note-generation", () => runner);
const rl = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rl);
vi.mock("@/lib/observability/datadog", () => ({ sendDatadogMetric: vi.fn(), sendDatadogLog: vi.fn() }));

import { POST } from "@/app/api/materials/[materialId]/generate-notes/route";

const call = () =>
  POST(new Request("https://example.test/x", { method: "POST" }), { params: { materialId: "mat-1" } });

describe("POST /api/materials/[id]/generate-notes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleMaterial.mockResolvedValue({ id: "mat-1", type: "AUDIO", topicId: "topic-1" });
    db.transcript.findUnique.mockResolvedValue({ status: "READY" });
    rl.rateLimit.mockResolvedValue({ success: true, remaining: 4 });
    jobs.createJobIfNoneActive.mockResolvedValue({ job: { id: "job-1" }, created: true });
  });

  it("starts one job (202)", async () => {
    const res = await call();
    expect(res.status).toBe(202);
    expect(runner.runNoteGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("an overlapping duplicate request gets the existing job and does NOT append a second set of AI blocks", async () => {
    jobs.createJobIfNoneActive.mockResolvedValue({ job: { id: "job-existing" }, created: false });

    const res = await call();

    expect(res.status).toBe(200);
    expect(runner.runNoteGenerationJob).not.toHaveBeenCalled();
  });

  it("is rate limited before creating a job or calling the model", async () => {
    rl.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

    const res = await call();

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("AI_RATE_LIMITED");
    expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
  });

  it("requires a READY transcript before creating any job", async () => {
    db.transcript.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(409);
    expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
  });
});
