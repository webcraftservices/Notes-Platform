import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

describe("Phase 1 release-candidate regressions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const id of [
      "@/lib/access",
      "@/lib/services/storage",
      "@/lib/db",
      "@/lib/storage-usage",
      "@/lib/search/note-embedding",
      "@/lib/observability/azure-monitor",
      "@/lib/observability/datadog",
      "@/lib/ai-usage",
      "@/lib/rate-limit",
      "@/lib/ai-quota",
      "@/lib/retrieval",
      "@/lib/services/ai",
      "@/lib/api-response",
      "@/lib/recording-usage",
    ]) {
      vi.doUnmock(id);
    }
  });

  it("returns HTTP 416 Content-Range on unsatisfiable Range requests in LocalStorageService /api/storage/read", async () => {
    const { LocalStorageService } = await import("@/lib/services/storage-local");
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.readFileStats = vi.fn().mockResolvedValue({ size: 128 });
    local.readFile = vi.fn();

    vi.doMock("@/lib/access", () => ({
      getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }),
      getAccessibleMaterialByStorageKey: vi.fn().mockResolvedValue({
        id: "mat-1",
        ownerId: "user-1",
        mimeType: "audio/mpeg",
        originalFilename: "lecture.mp3",
        title: "Lecture",
      }),
      NotAuthorizedError: class NotAuthorizedError extends Error {},
    }));
    vi.doMock("@/lib/services/storage", () => ({
      getStorageService: vi.fn().mockReturnValue(local),
    }));

    const { GET } = await import("@/app/api/storage/read/route");
    const res = await GET(
      new Request("https://example.test/api/storage/read?key=materials/user-1/lecture.mp3", {
        headers: { range: "bytes=999999-" },
      })
    );

    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */128");
    expect(local.readFile).not.toHaveBeenCalled();
  });

  it("enforces remaining storage quota with 413 in PUT /api/storage/upload before writeFile", async () => {
    const { LocalStorageService } = await import("@/lib/services/storage-local");
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.writeFile = vi.fn();

    const materialUpdate = vi.fn();
    vi.doMock("@/lib/db", () => ({
      db: {
        material: {
          findFirst: vi.fn().mockResolvedValue({
            id: "mat-1",
            ownerId: "user-1",
            status: "UPLOADING",
            storageKey: "materials/user-1/mat-1.pdf",
          }),
          update: materialUpdate,
        },
      },
    }));
    vi.doMock("@/lib/access", () => ({
      getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    }));
    vi.doMock("@/lib/services/storage", () => ({
      getStorageService: vi.fn().mockReturnValue(local),
    }));
    vi.doMock("@/lib/storage-usage", () => ({
      getStorageUsage: vi.fn().mockResolvedValue({
        plan: { maxFileSizeBytes: 25 * 1024 * 1024 },
        remainingBytes: 100,
      }),
    }));

    const { PUT } = await import("@/app/api/storage/upload/route");
    const payload = Buffer.alloc(1024, 65);
    const res = await PUT(
      new Request("https://example.test/api/storage/upload?key=materials/user-1/mat-1.pdf", {
        method: "PUT",
        body: payload,
      })
    );

    expect(res.status).toBe(413);
    expect(local.writeFile).not.toHaveBeenCalled();
    expect(materialUpdate).not.toHaveBeenCalled();
  });

  it("rejects oversized ppt/presentation.xml in PPTX archives before full XML decompression", async () => {
    const JSZipCtor = JSZip as unknown as new () => {
      file(name: string, data: string): void;
      generateAsync(options: {
        type: "nodebuffer";
        compression: "DEFLATE";
        compressionOptions: { level: number };
      }): Promise<Buffer>;
    };
    const zip = new JSZipCtor();
    const oversizedPres = "<p:presentation>" + " ".repeat(2.5 * 1024 * 1024) + "</p:presentation>";
    zip.file("ppt/presentation.xml", oversizedPres);
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    );
    const compressedZip = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    expect(compressedZip.byteLength).toBeLessThan(100_000);

    const { LocalStorageService } = await import("@/lib/services/storage-local");
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.readFileStats = vi.fn().mockResolvedValue({ size: compressedZip.byteLength });
    local.readFile = vi.fn().mockResolvedValue(compressedZip);

    vi.doMock("@/lib/services/storage", () => ({
      getStorageService: vi.fn().mockReturnValue(local),
    }));

    const { LocalDocumentProcessingService } = await import("@/lib/services/document-processing-local");
    const service = new LocalDocumentProcessingService();

    await expect(
      service.extractText({
        storageKey: "materials/user-1/bomb.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    ).rejects.toThrow(/presentation\.xml.*maximum supported slide XML size/i);
  });

  it("serializes getOrCreateTopicNote with note:topic:<id> advisory lock inside $transaction", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const findFirst = vi.fn().mockResolvedValue(null);
    const createdNote = {
      id: "note-1",
      topicId: "topic-99",
      authorId: "user-1",
      title: "Linear Algebra",
      plainText: "Linear Algebra",
      blocks: [],
    };
    const create = vi.fn().mockResolvedValue(createdNote);
    const syncNoteSearchIndex = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/db", () => ({
      db: {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            $executeRaw: executeRaw,
            note: { findFirst, create },
          })
        ),
      },
    }));
    vi.doMock("@/lib/search/note-embedding", () => ({
      syncNoteSearchIndex,
    }));

    const { getOrCreateTopicNote } = await import("@/lib/notes");
    const result = await getOrCreateTopicNote({ id: "topic-99", name: "Linear Algebra" }, "user-1");

    expect(result.id).toBe("note-1");
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sqlTemplate = executeRaw.mock.calls[0]?.[0]?.join("?") ?? "";
    expect(sqlTemplate).toContain("pg_advisory_xact_lock");
    expect(executeRaw.mock.calls[0]?.[1]).toBe("note:topic:topic-99");
    expect(syncNoteSearchIndex).toHaveBeenCalledTimes(1);
  });

  it("emits Azure Monitor ai.chat metrics and still records AI usage if DB persistence throws post-chat", async () => {
    const sendAzureMonitorMetric = vi.fn().mockResolvedValue(undefined);
    const sendDatadogMetric = vi.fn().mockResolvedValue(undefined);
    const recordAIUsage = vi.fn().mockResolvedValue(undefined);
    const logServerError = vi.fn();

    vi.doMock("@/lib/observability/azure-monitor", async () => {
      const actual = await vi.importActual<typeof import("@/lib/observability/azure-monitor")>(
        "@/lib/observability/azure-monitor"
      );
      return { ...actual, sendAzureMonitorMetric };
    });
    vi.doMock("@/lib/observability/datadog", () => ({
      sendDatadogMetric,
      sendDatadogLog: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("@/lib/ai-usage", () => ({
      recordAIUsage,
    }));
    vi.doMock("@/lib/access", () => ({
      getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }),
      getAccessibleAIConversation: vi.fn().mockResolvedValue({
        id: "conv-1",
        kind: "CHAT",
        topicId: "topic-1",
        chapterId: null,
        subjectId: null,
        groupId: null,
      }),
      getAccessibleAIScope: vi.fn().mockResolvedValue({
        ownerType: "workspace",
        workspaceId: "ws-1",
        topicId: "topic-1",
      }),
      NotAuthorizedError: class NotAuthorizedError extends Error {},
    }));
    vi.doMock("@/lib/rate-limit", () => ({
      rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 19 }),
    }));
    vi.doMock("@/lib/ai-quota", () => ({
      assertWithinAIQuota: vi.fn().mockResolvedValue({ usedCredits: 0, limitCredits: 200 }),
      assertAiTutorEntitlement: vi.fn(),
      AIQuotaExceededError: class AIQuotaExceededError extends Error {},
      AITutorNotEnabledError: class AITutorNotEnabledError extends Error {},
    }));
    vi.doMock("@/lib/retrieval", () => ({
      retrieveRelevantChunks: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("@/lib/services/ai", () => ({
      getAIService: vi.fn().mockReturnValue({
        providerName: "gemini",
        modelName: "gemini-2.5-flash",
        chat: vi.fn().mockResolvedValue({
          content: "Here is the answer.",
          tokensInput: 120,
          tokensOutput: 45,
        }),
      }),
    }));
    vi.doMock("@/lib/db", () => ({
      db: {
        aIMessage: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockReturnValue({}),
        },
        aIConversation: {
          update: vi.fn(),
        },
        $transaction: vi.fn().mockRejectedValue(new Error("DB deadlock on persist")),
      },
    }));
    vi.doMock("@/lib/api-response", async () => {
      const actual = await vi.importActual<typeof import("@/lib/api-response")>("@/lib/api-response");
      return {
        ...actual,
        logServerError,
      };
    });

    const { POST } = await import("@/app/api/ai/conversations/[conversationId]/messages/route");
    const res = await POST(
      new Request("https://example.test/api/ai/conversations/conv-1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Explain eigenvectors" }),
      }),
      { params: { conversationId: "conv-1" } }
    );

    expect(res.status).toBe(500);
    expect(sendAzureMonitorMetric).toHaveBeenCalledWith(
      "ai.chat.requests",
      1,
      expect.objectContaining({
        properties: expect.objectContaining({ provider: "gemini", outcome: "success" }),
      })
    );
    expect(sendAzureMonitorMetric).toHaveBeenCalledWith(
      "ai.chat.latency_ms",
      expect.any(Number),
      expect.objectContaining({
        properties: expect.objectContaining({ provider: "gemini" }),
      })
    );
    expect(recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        tokensInput: 120,
        tokensOutput: 45,
        context: expect.objectContaining({ conversationId: "conv-1", persistFailed: true }),
      })
    );
  });

  it("aiGenerationFailureResponse emits both Azure Monitor ai.generation.requests and ai.generation.failures (NEW-04)", async () => {
    const sendAzureMonitorMetric = vi.fn().mockResolvedValue(undefined);
    const sendDatadogMetric = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/observability/azure-monitor", async () => {
      const actual = await vi.importActual<typeof import("@/lib/observability/azure-monitor")>(
        "@/lib/observability/azure-monitor"
      );
      return { ...actual, sendAzureMonitorMetric };
    });
    vi.doMock("@/lib/observability/datadog", () => ({
      sendDatadogMetric,
      sendDatadogLog: vi.fn().mockResolvedValue(undefined),
    }));

    const { aiGenerationFailureResponse } = await import("@/lib/ai-route-errors");
    const { AIProviderUnavailableError } = await import("@/lib/services/interfaces");

    const res = aiGenerationFailureResponse(new AIProviderUnavailableError("503 unavailable"), {
      route: "flashcards/generate",
      kind: "flashcards",
      userId: "user-1",
      requestId: "req-1",
    });

    expect(res.status).toBe(503);
    expect(sendAzureMonitorMetric).toHaveBeenCalledWith(
      "ai.generation.requests",
      1,
      expect.objectContaining({
        properties: expect.objectContaining({
          kind: "flashcards",
          outcome: "failure",
          failureCategory: "unavailable",
        }),
      })
    );
    expect(sendAzureMonitorMetric).toHaveBeenCalledWith(
      "ai.generation.failures",
      1,
      expect.objectContaining({
        properties: expect.objectContaining({
          kind: "flashcards",
          failureCategory: "unavailable",
        }),
      })
    );
  });

  it("downgrades CANCELLED subscriptions to FREE across AI, storage, and recording quota helpers while preserving PAST_DUE grace period", async () => {
    const findUniqueSub = vi.fn();
    vi.doMock("@/lib/db", () => ({
      db: {
        subscription: { findUnique: findUniqueSub },
        usageRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 100 } }) },
        material: {
          aggregate: vi
            .fn()
            .mockResolvedValueOnce({ _sum: { sizeBytes: 1024 } })
            .mockResolvedValueOnce({ _sum: { durationSeconds: 60 } })
            .mockResolvedValueOnce({ _sum: { sizeBytes: 1024 } })
            .mockResolvedValueOnce({ _sum: { durationSeconds: 60 } }),
        },
      },
    }));

    const { getAIUsage } = await import("@/lib/ai-quota");
    const { getStorageUsage } = await import("@/lib/storage-usage");
    const { getRecordingUsage } = await import("@/lib/recording-usage");

    // CANCELLED -> FREE limits
    findUniqueSub.mockResolvedValue({ plan: "PRO", status: "CANCELLED" });
    const [aiCancelled, storageCancelled, recCancelled] = await Promise.all([
      getAIUsage("user-1"),
      getStorageUsage("user-1"),
      getRecordingUsage("user-1"),
    ]);
    expect(aiCancelled.limitCredits).toBe(200);
    expect(storageCancelled.limitBytes).toBe(1024 ** 3);
    expect(recCancelled.limitSeconds).toBe(120 * 60);

    // PAST_DUE -> retains PRO dunning grace period (LIM-20(4)(b))
    findUniqueSub.mockResolvedValue({ plan: "PRO", status: "PAST_DUE" });
    const [aiPastDue, storagePastDue, recPastDue] = await Promise.all([
      getAIUsage("user-1"),
      getStorageUsage("user-1"),
      getRecordingUsage("user-1"),
    ]);
    expect(aiPastDue.limitCredits).toBe(6000);
    expect(storagePastDue.limitBytes).toBe(50 * 1024 ** 3);
    expect(recPastDue.limitSeconds).toBe(3000 * 60);
  });
});
