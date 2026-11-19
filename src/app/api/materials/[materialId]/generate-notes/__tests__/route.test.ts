import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleMaterial: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const db = vi.hoisted(() => ({
  transcript: { findUnique: vi.fn() },
  processingJob: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const jobs = vi.hoisted(() => ({ createJobIfNoneActive: vi.fn() }));
vi.mock("@/lib/processing-jobs", () => jobs);

const runner = vi.hoisted(() => ({
  runNoteGenerationJob: vi.fn(),
  MAX_DOCUMENT_NOTE_GEN_CHARS: 200_000,
  SUPPORTED_NOTE_GEN_TYPES: new Set(["AUDIO", "VIDEO", "PDF", "DOCX", "PPTX", "GOOGLE_DOC"]),
}));
vi.mock("@/lib/note-generation", () => runner);

const rl = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rl);

const quota = vi.hoisted(() => {
  class AIQuotaExceededError extends Error {
    constructor(public readonly usage: any) {
      super("AI usage quota exceeded for this billing period.");
      this.name = "AIQuotaExceededError";
    }
  }
  return {
    assertWithinAIQuota: vi.fn(),
    AIQuotaExceededError,
  };
});
vi.mock("@/lib/ai-quota", () => quota);

vi.mock("@/lib/observability/datadog", () => ({
  sendDatadogMetric: vi.fn(),
  sendDatadogLog: vi.fn(),
}));

import { POST } from "@/app/api/materials/[materialId]/generate-notes/route";

const call = (id = "mat-1") =>
  POST(new Request("https://example.test/x", { method: "POST" }), { params: { materialId: id } });

describe("POST /api/materials/[id]/generate-notes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleMaterial.mockResolvedValue({
      id: "mat-1",
      type: "AUDIO",
      topicId: "topic-1",
      workspaceId: "ws-1",
      groupId: null,
      extractedText: null,
    });
    db.transcript.findUnique.mockResolvedValue({ status: "READY" });
    db.processingJob.findFirst.mockResolvedValue(null);
    rl.rateLimit.mockResolvedValue({ success: true, remaining: 4 });
    jobs.createJobIfNoneActive.mockResolvedValue({ job: { id: "job-1" }, created: true });
    quota.assertWithinAIQuota.mockResolvedValue(undefined);
  });

  describe("Authentication and rate limiting", () => {
    it("returns 401 when session user is not authenticated", async () => {
      access.getSessionUser.mockResolvedValue(null);
      const res = await call();
      expect(res.status).toBe(401);
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });

    it("is rate limited before creating a job or calling the model (429)", async () => {
      rl.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

      const res = await call();

      expect(res.status).toBe(429);
      expect((await res.json()).code).toBe("AI_RATE_LIMITED");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });
  });

  describe("Authorization and material validation", () => {
    it("returns 404 when material is not found", async () => {
      access.getAccessibleMaterial.mockResolvedValue(null);
      const res = await call("mat-missing");
      expect(res.status).toBe(404);
    });

    it("returns 403 when NotAuthorizedError is thrown", async () => {
      access.getAccessibleMaterial.mockRejectedValue(new access.NotAuthorizedError("Forbidden"));
      const res = await call("mat-forbidden");
      expect(res.status).toBe(403);
    });

    it("rejects unsupported material types with 400", async () => {
      access.getAccessibleMaterial.mockResolvedValue({
        id: "mat-img",
        type: "IMAGE",
        topicId: "topic-1",
      });

      const res = await call("mat-img");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("AI notes can only be generated from audio, video, PDF, Word documents, PowerPoint presentations, or Google Docs");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });

    it("requires material to be attached to a topic (409)", async () => {
      access.getAccessibleMaterial.mockResolvedValue({
        id: "mat-1",
        type: "AUDIO",
        topicId: null,
      });

      const res = await call();
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("Attach this material to a topic");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });
  });

  describe("Audio and Video materials", () => {
    it("starts a job (202) for AUDIO with a READY transcript", async () => {
      const res = await call();
      expect(res.status).toBe(202);
      expect(quota.assertWithinAIQuota).toHaveBeenCalledWith("user-1");
      expect(jobs.createJobIfNoneActive).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "AI_NOTE_GENERATION",
          materialId: "mat-1",
          userId: "user-1",
        })
      );
      expect(runner.runNoteGenerationJob).toHaveBeenCalledWith("job-1");
    });

    it("starts a job (202) for VIDEO with a READY transcript", async () => {
      access.getAccessibleMaterial.mockResolvedValue({
        id: "mat-vid",
        type: "VIDEO",
        topicId: "topic-1",
      });

      const res = await call("mat-vid");
      expect(res.status).toBe(202);
      expect(runner.runNoteGenerationJob).toHaveBeenCalledWith("job-1");
    });

    it("requires a READY transcript before creating any job (409)", async () => {
      db.transcript.findUnique.mockResolvedValue(null);
      const res = await call();
      expect(res.status).toBe(409);
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });

    it("rejects when transcript status is not READY (e.g. PROCESSING) (409)", async () => {
      db.transcript.findUnique.mockResolvedValue({ status: "PROCESSING" });
      const res = await call();
      expect(res.status).toBe(409);
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });
  });

  describe("Document materials (PDF, DOCX, PPTX, GOOGLE_DOC)", () => {
    it.each(["PDF", "DOCX", "PPTX", "GOOGLE_DOC"] as const)(
      "starts a job (202) for %s with extracted text",
      async (type) => {
        access.getAccessibleMaterial.mockResolvedValue({
          id: `mat-${type.toLowerCase()}`,
          type,
          topicId: "topic-1",
          extractedText: "Some valid extracted document text for testing.",
        });

        const res = await call(`mat-${type.toLowerCase()}`);
        expect(res.status).toBe(202);
        expect(quota.assertWithinAIQuota).toHaveBeenCalledWith("user-1");
        expect(runner.runNoteGenerationJob).toHaveBeenCalledWith("job-1");
      }
    );

    it("returns 409 DOCUMENT_EXTRACTION_PENDING when document text is missing and extraction is in progress", async () => {
      access.getAccessibleMaterial.mockResolvedValue({
        id: "mat-pdf",
        type: "PDF",
        topicId: "topic-1",
        extractedText: null,
      });
      db.processingJob.findFirst.mockResolvedValue({
        id: "job-extract",
        status: "RUNNING",
        type: "DOCUMENT_EXTRACTION",
      });

      const res = await call("mat-pdf");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.code).toBe("DOCUMENT_EXTRACTION_PENDING");
      expect(data.error).toContain("in progress");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });

    it("returns 409 DOCUMENT_TEXT_EMPTY when document text is empty and no extraction is pending", async () => {
      access.getAccessibleMaterial.mockResolvedValue({
        id: "mat-pdf",
        type: "PDF",
        topicId: "topic-1",
        extractedText: "   ",
      });
      db.processingJob.findFirst.mockResolvedValue(null);

      const res = await call("mat-pdf");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.code).toBe("DOCUMENT_TEXT_EMPTY");
      expect(data.error).toContain("no extracted text");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });

    it("returns 413 DOCUMENT_TOO_LARGE when document extracted text exceeds 200,000 characters", async () => {
      const hugeText = "a".repeat(200_001);
      access.getAccessibleMaterial.mockResolvedValue({
        id: "mat-pdf",
        type: "PDF",
        topicId: "topic-1",
        extractedText: hugeText,
      });

      const res = await call("mat-pdf");
      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.code).toBe("DOCUMENT_TOO_LARGE");
      expect(data.error).toContain("too large for single-pass note generation");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });
  });

  describe("AI quota enforcement", () => {
    it("returns 429 AI_QUOTA_EXCEEDED when AI quota is exhausted", async () => {
      quota.assertWithinAIQuota.mockRejectedValue(
        new quota.AIQuotaExceededError({
          usedCredits: 1000,
          limitCredits: 1000,
          plan: { label: "Free Plan" },
        })
      );

      const res = await call();
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.code).toBe("AI_QUOTA_EXCEEDED");
      expect(data.usage.usedCredits).toBe(1000);
      expect(data.usage.limitCredits).toBe(1000);
      expect(data.usage.plan).toBe("Free Plan");
      expect(jobs.createJobIfNoneActive).not.toHaveBeenCalled();
    });
  });

  describe("Job deduplication", () => {
    it("returns 200 and does NOT trigger a second worker when an active job already exists", async () => {
      jobs.createJobIfNoneActive.mockResolvedValue({ job: { id: "job-existing" }, created: false });

      const res = await call();

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.job.id).toBe("job-existing");
      expect(runner.runNoteGenerationJob).not.toHaveBeenCalled();
    });
  });
});
