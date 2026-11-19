import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  Prisma: {
    DbNull: Symbol("DbNull"),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (rows: unknown[]) => ({ rows }),
  },
}));

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  material: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  processingJob: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  subscription: { findUnique: vi.fn() },
  processingJob: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  material: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
const scopeMocks = vi.hoisted(() => ({ getPrimaryWorkspace: vi.fn(), resolveMaterialScope: vi.fn() }));
vi.mock("@/lib/access", () => ({ getPrimaryWorkspace: scopeMocks.getPrimaryWorkspace }));
vi.mock("@/lib/materials-scope", () => ({
  resolveMaterialScope: scopeMocks.resolveMaterialScope,
  ScopeNotFoundError: class ScopeNotFoundError extends Error { },
}));
vi.mock("@/lib/observability/datadog", () => ({ sendDatadogMetric: vi.fn().mockResolvedValue(undefined) }));

const connection = vi.hoisted(() => ({
  getGoogleConnectionStatus: vi.fn(),
  getValidGoogleAccessToken: vi.fn(),
  GoogleNotConnectedError: class GoogleNotConnectedError extends Error { },
}));
vi.mock("@/lib/google-connection", () => connection);

const docs = vi.hoisted(() => ({ extractGoogleDocText: vi.fn() }));
vi.mock("@/lib/services/google-docs", () => docs);
const slides = vi.hoisted(() => ({ extractGoogleSlidesPresentation: vi.fn() }));
vi.mock("@/lib/services/google-slides", () => slides);
const drive = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock("@/lib/services/google-drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/google-drive")>()),
  getGoogleDriveService: () => drive,
}));
vi.mock("@/lib/services/storage", () => ({ getStorageService: vi.fn() }));
vi.mock("@/lib/metadata-extraction", () => ({ extractMetadata: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/storage-usage", () => ({ getStorageUsage: vi.fn().mockResolvedValue({ remainingBytes: 10 ** 9 }) }));

const ingestion = vi.hoisted(() => ({ queueEmbeddingJob: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ingestion", () => ingestion);
vi.mock("@/lib/document-extraction", () => ({ queueDocumentExtractionIfNeeded: vi.fn().mockResolvedValue(undefined) }));
const activity = vi.hoisted(() => ({ createActivityLog: vi.fn(), ActivityAction: { MATERIAL_ADDED: "material.added" } }));
vi.mock("@/lib/activity", () => activity);

import { importGoogleFile, runGoogleImportJob } from "@/lib/google-import";
import { GoogleApiError, GOOGLE_RECONNECT_REQUIRED } from "@/lib/services/google-errors";

const docRequest = { fileId: "file-1", name: "Notes", mimeType: "application/vnd.google-apps.document" };

function setUpPaidPlan() {
  // PRO/STUDENT-class plans enable Drive sync; use whichever the real plan table enables.
  db.subscription.findUnique.mockResolvedValue({ plan: "PRO" });
}

describe("importGoogleFile — duplicate protection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setUpPaidPlan();
    scopeMocks.getPrimaryWorkspace.mockResolvedValue({ id: "ws-1" });
    scopeMocks.resolveMaterialScope.mockResolvedValue({ workspaceId: "ws-1", groupId: null, subjectId: null, chapterId: null, topicId: null });
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.processingJob.updateMany.mockResolvedValue({ count: 0 });
    connection.getGoogleConnectionStatus.mockResolvedValue({ connected: true });
    db.processingJob.findUnique.mockResolvedValue(null); // the background runner is a no-op here
  });

  it("refuses up front — creating nothing — when Google isn't connected", async () => {
    connection.getGoogleConnectionStatus.mockResolvedValue({ connected: false });

    await expect(importGoogleFile("user-1", docRequest)).rejects.toBeInstanceOf(connection.GoogleNotConnectedError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("looks up and creates inside ONE transaction that first takes a per-(user, file) advisory lock", async () => {
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(async () => void order.push("lock"));
    tx.material.findFirst.mockImplementation(async () => (order.push("find"), null));
    tx.material.create.mockImplementation(async () => (order.push("create"), { id: "mat-1", title: "Notes", status: "PROCESSING" }));
    tx.processingJob.findFirst.mockResolvedValue(null);
    tx.processingJob.create.mockResolvedValue({ id: "job-1" });

    const result = await importGoogleFile("user-1", docRequest);

    expect(order.slice(0, 3)).toEqual(["lock", "find", "create"]);
    expect(result.duplicate).toBe(false);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns the existing material as a duplicate — no second Material, no second job — when the file was already imported", async () => {
    tx.material.findFirst.mockResolvedValue({ id: "mat-1", title: "Notes", status: "READY", externalRef: { modifiedTime: "t1" } });

    const result = await importGoogleFile("user-1", { ...docRequest, modifiedTime: "t1" });

    expect(result).toMatchObject({ duplicate: true, changed: false });
    expect(tx.material.create).not.toHaveBeenCalled();
    expect(tx.processingJob.create).not.toHaveBeenCalled();
  });

  it("does not start a second runner when a forced re-import races an import that is already running", async () => {
    tx.material.findFirst.mockResolvedValue({ id: "mat-1", title: "Notes", status: "PROCESSING", externalRef: {} });
    tx.material.update.mockResolvedValue({ id: "mat-1", title: "Notes", status: "PROCESSING" });
    tx.processingJob.findFirst.mockResolvedValue({ id: "job-running", status: "RUNNING" });

    const result = await importGoogleFile("user-1", { ...docRequest, force: true });

    expect(result.duplicate).toBe(true);
    expect(tx.processingJob.create).not.toHaveBeenCalled();
    expect(db.processingJob.findUnique).not.toHaveBeenCalled(); // no runJob started
  });

  it("does not wipe a material's existing content just because a re-import was requested", async () => {
    tx.material.findFirst.mockResolvedValue({ id: "mat-1", title: "Notes", status: "READY", externalRef: {} });
    tx.material.update.mockResolvedValue({ id: "mat-1", title: "Notes", status: "PROCESSING" });
    tx.processingJob.findFirst.mockResolvedValue(null);
    tx.processingJob.create.mockResolvedValue({ id: "job-1" });

    await importGoogleFile("user-1", { ...docRequest, force: true });

    const data = tx.material.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("extractedText");
    expect(data.status).toBe("PROCESSING");
  });
});

describe("runGoogleImportJob — failure and partial-failure handling", () => {
  const job = { id: "job-1", type: "GOOGLE_SYNC", materialId: "mat-1", userId: "user-1" };
  const docMaterial = {
    id: "mat-1",
    type: "GOOGLE_DOC",
    groupId: "group-1",
    ownerId: "user-1",
    title: "Notes",
    mimeType: "application/vnd.google-apps.document",
    externalRef: { provider: "google_drive", fileId: "file-1" },
    extractedText: null as string | null,
    storageKey: null as string | null,
    sizeBytes: null as number | null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    db.processingJob.findUnique.mockResolvedValue(job);
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });
    db.material.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fnOrOps: unknown) => {
      if (typeof fnOrOps === "function") {
        return (fnOrOps as (client: typeof db) => Promise<unknown>)(db);
      }
      return Array.isArray(fnOrOps) ? Promise.all(fnOrOps) : fnOrOps;
    });
    db.material.update.mockResolvedValue({ ...docMaterial, status: "READY" });
    db.processingJob.update.mockResolvedValue({});
    db.subscription.findUnique.mockResolvedValue({ plan: "PRO" });
    connection.getValidGoogleAccessToken.mockResolvedValue("access-token");
    ingestion.queueEmbeddingJob.mockResolvedValue(undefined);
  });

  const failedJobWrites = () =>
    db.processingJob.updateMany.mock.calls.filter(([arg]) => arg.data?.status === "FAILED");

  it("a failed FIRST import (no content) ends FAILED", async () => {
    db.material.findUnique.mockImplementation(async (args: { select?: unknown }) =>
      args.select ? { extractedText: null, storageKey: null } : docMaterial
    );
    connection.getValidGoogleAccessToken.mockRejectedValue(
      new GoogleApiError("revoked", { status: 400, publicMessage: GOOGLE_RECONNECT_REQUIRED })
    );

    await runGoogleImportJob("job-1");

    expect(failedJobWrites()).toHaveLength(1);
    expect(db.material.updateMany).toHaveBeenCalledWith({ where: { id: "mat-1", status: "PROCESSING" }, data: { status: "FAILED" } });
  });

  it("a failed RE-import leaves the material READY with its previous content instead of destroying it", async () => {
    db.material.findUnique.mockImplementation(async (args: { select?: unknown }) =>
      args.select ? { extractedText: "previous good text", storageKey: null } : { ...docMaterial, extractedText: "previous good text" }
    );
    docs.extractGoogleDocText.mockRejectedValue(new GoogleApiError("bad", { status: 404, publicMessage: "gone" }));

    await runGoogleImportJob("job-1");

    expect(failedJobWrites()).toHaveLength(1); // the failure is still recorded on the job
    expect(db.material.updateMany).toHaveBeenCalledWith({ where: { id: "mat-1", status: "PROCESSING" }, data: { status: "READY" } });
  });

  it("retries a transient Google failure but not a permanent one", async () => {
    vi.useFakeTimers();
    try {
      db.material.findUnique.mockResolvedValue(docMaterial);
      docs.extractGoogleDocText
        .mockRejectedValueOnce(new GoogleApiError("503", { status: 503, publicMessage: "later" }))
        .mockResolvedValueOnce("doc text");

      const done = runGoogleImportJob("job-1");
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(docs.extractGoogleDocText).toHaveBeenCalledTimes(2);
      expect(failedJobWrites()).toHaveLength(0);

      docs.extractGoogleDocText.mockReset();
      docs.extractGoogleDocText.mockRejectedValue(new GoogleApiError("404", { status: 404, publicMessage: "gone" }));
      const done2 = runGoogleImportJob("job-1");
      await vi.advanceTimersByTimeAsync(5000);
      await done2;
      expect(docs.extractGoogleDocText).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report an already-successful import as failed when the post-success activity log throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });
    db.material.findUnique.mockResolvedValue(docMaterial);
    docs.extractGoogleDocText.mockResolvedValue("doc text");
    activity.createActivityLog.mockRejectedValue(new Error("activity table unavailable"));

    await runGoogleImportJob("job-1");

    expect(failedJobWrites()).toHaveLength(0);
    expect(db.material.updateMany).not.toHaveBeenCalled(); // material stays READY
    expect(ingestion.queueEmbeddingJob).toHaveBeenCalledWith("user-1", "mat-1"); // indexing still queued
    consoleSpy.mockRestore();
  });

  it("passes the plan's per-file limit to the download so an oversized Drive file is never fully buffered", async () => {
    const pdfMaterial = { ...docMaterial, type: "PDF", mimeType: "application/pdf" };
    db.material.findUnique.mockResolvedValue(pdfMaterial);
    drive.downloadFile.mockRejectedValue(new Error("stop here"));

    await runGoogleImportJob("job-1");

    const args = drive.downloadFile.mock.calls[0]![0];
    expect(args.maxBytes).toBeGreaterThan(0);
    expect(Number.isFinite(args.maxBytes)).toBe(true);
  });

  it("exits without touching the material when another runner already claimed the job", async () => {
    db.processingJob.updateMany.mockResolvedValue({ count: 0 });

    await runGoogleImportJob("job-1");

    expect(db.material.findUnique).not.toHaveBeenCalled();
    expect(connection.getValidGoogleAccessToken).not.toHaveBeenCalled();
  });

  it("extracts native Google Slides directly via the Slides v1 API without downloading as PPTX and queues embedding", async () => {
    const slidesMaterial = {
      ...docMaterial,
      type: "PPTX",
      mimeType: "application/vnd.google-apps.presentation",
      externalRef: {
        provider: "google_drive",
        fileId: "slides-file-1",
        mimeType: "application/vnd.google-apps.presentation",
        nativeKind: "google_slides",
      },
    };
    db.material.findUnique.mockResolvedValue(slidesMaterial);
    slides.extractGoogleSlidesPresentation.mockResolvedValue({
      presentationId: "slides-file-1",
      title: "Deck Title",
      revisionId: "rev-slides-1",
      text: "Slide 1 text\n\nSpeaker Notes:\nNote 1",
      pages: [
        {
          pageNumber: 1,
          text: "Slide 1 text\n\nSpeaker Notes:\nNote 1",
          slideText: "Slide 1 text",
          speakerNotes: "Note 1",
        },
      ],
    });

    await runGoogleImportJob("job-1");

    expect(slides.extractGoogleSlidesPresentation).toHaveBeenCalledWith({
      accessToken: "access-token",
      presentationId: "slides-file-1",
    });
    expect(drive.downloadFile).not.toHaveBeenCalled();
    expect(db.material.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1" },
        data: expect.objectContaining({
          status: "READY",
          extractedText: "Slide 1 text\n\nSpeaker Notes:\nNote 1",
          metadata: expect.objectContaining({
            pageCount: 1,
            slideCount: 1,
            revisionId: "rev-slides-1",
          }),
        }),
      })
    );
    expect(ingestion.queueEmbeddingJob).toHaveBeenCalledWith("user-1", "mat-1");
  });

  it("deletes newly written storage bytes and does not mark material READY when a binary Drive import is cancelled by group deletion during download", async () => {
    const { LocalStorageService } = await import("@/lib/services/storage-local");
    const { getStorageService } = await import("@/lib/services/storage");
    const { getStorageUsage } = await import("@/lib/storage-usage");
    const { extractMetadata } = await import("@/lib/metadata-extraction");
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.writeFile = vi.fn().mockResolvedValue(undefined);
    local.deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getStorageService).mockReturnValue(local);
    vi.mocked(getStorageUsage).mockResolvedValue({ remainingBytes: 10 ** 9 } as never);
    vi.mocked(extractMetadata).mockResolvedValue({});

    const pdfMaterial = {
      ...docMaterial,
      type: "PDF",
      mimeType: "application/pdf",
      storageKey: null,
      deletedAt: null,
    };
    // 1st findUnique: initial job lookup; 2nd findUnique: isJobActive check sees CANCELLED
    db.processingJob.findUnique
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, status: "CANCELLED" });
    db.material.findUnique.mockResolvedValue(pdfMaterial);
    drive.downloadFile.mockResolvedValue(Buffer.from("%PDF-1.4 test bytes"));

    await runGoogleImportJob("job-1");

    expect(local.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^materials\/user-1\/mat-1-[A-Za-z0-9_-]+\.pdf$/),
      expect.any(Buffer)
    );
    const writtenKey = vi.mocked(local.writeFile).mock.calls[0]![0];
    expect(local.deleteObject).toHaveBeenCalledWith(writtenKey);
    expect(db.material.update).not.toHaveBeenCalled();
  });

  it("preserves previousStorageKey when replacement upload commit aborts, and deletes newly written object only", async () => {
    const { LocalStorageService } = await import("@/lib/services/storage-local");
    const { getStorageService } = await import("@/lib/services/storage");
    const { getStorageUsage } = await import("@/lib/storage-usage");
    const { extractMetadata } = await import("@/lib/metadata-extraction");
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.writeFile = vi.fn().mockResolvedValue(undefined);
    local.deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getStorageService).mockReturnValue(local);
    vi.mocked(getStorageUsage).mockResolvedValue({ remainingBytes: 10 ** 9 } as never);
    vi.mocked(extractMetadata).mockResolvedValue({});

    const pdfMaterial = {
      ...docMaterial,
      type: "PDF",
      mimeType: "application/pdf",
      storageKey: "materials/user-1/mat-1-prev.pdf",
      deletedAt: null,
    };
    db.processingJob.findUnique.mockResolvedValue(job);
    // Claim succeeds (1st call), then completeJobWithin fails/cancels (2nd call)
    db.processingJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    db.material.findUnique.mockResolvedValue(pdfMaterial);
    drive.downloadFile.mockResolvedValue(Buffer.from("%PDF-1.4 replacement"));

    await runGoogleImportJob("job-1");

    const stagedKey = vi.mocked(local.writeFile).mock.calls[0]![0];
    expect(stagedKey).not.toBe("materials/user-1/mat-1-prev.pdf");
    // Only the staged key is rolled back; previousStorageKey stays intact
    expect(local.deleteObject).toHaveBeenCalledTimes(1);
    expect(local.deleteObject).toHaveBeenCalledWith(stagedKey);
    expect(local.deleteObject).not.toHaveBeenCalledWith("materials/user-1/mat-1-prev.pdf");
    expect(db.material.update).not.toHaveBeenCalled();
  });

  it("deletes previousStorageKey ONLY after versioned replacement import commits", async () => {
    const { LocalStorageService } = await import("@/lib/services/storage-local");
    const { getStorageService } = await import("@/lib/services/storage");
    const { getStorageUsage } = await import("@/lib/storage-usage");
    const { extractMetadata } = await import("@/lib/metadata-extraction");
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.writeFile = vi.fn().mockResolvedValue(undefined);
    local.deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getStorageService).mockReturnValue(local);
    vi.mocked(getStorageUsage).mockResolvedValue({ remainingBytes: 10 ** 9 } as never);
    vi.mocked(extractMetadata).mockResolvedValue({ pageCount: 2 });

    const pdfMaterial = {
      ...docMaterial,
      type: "PDF",
      mimeType: "application/pdf",
      storageKey: "materials/user-1/mat-1-old.pdf",
      deletedAt: null,
    };
    const events: string[] = [];
    db.processingJob.findUnique.mockResolvedValue(job);
    db.material.findUnique.mockResolvedValue(pdfMaterial);
    drive.downloadFile.mockResolvedValue(Buffer.from("%PDF-1.4 replacement"));
    db.material.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      events.push("db_commit");
      return { ...pdfMaterial, ...args.data };
    });
    local.deleteObject = vi.fn().mockImplementation(async (key: string) => {
      events.push(`delete:${key}`);
    });

    await runGoogleImportJob("job-1");

    const stagedKey = vi.mocked(local.writeFile).mock.calls[0]![0];
    expect(stagedKey).toMatch(/^materials\/user-1\/mat-1-[A-Za-z0-9_-]+\.pdf$/);
    expect(stagedKey).not.toBe("materials/user-1/mat-1-old.pdf");
    expect(events).toEqual(["db_commit", "delete:materials/user-1/mat-1-old.pdf"]);
  });
});
