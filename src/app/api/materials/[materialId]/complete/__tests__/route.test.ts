import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  material: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/access", () => ({ getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }) }));
const datadog = vi.hoisted(() => ({ sendDatadogMetric: vi.fn(), sendDatadogLog: vi.fn() }));
vi.mock("@/lib/observability/datadog", () => datadog);

const storageModule = vi.hoisted(() => ({ getStorageService: vi.fn() }));
vi.mock("@/lib/services/storage", () => storageModule);

const usage = vi.hoisted(() => ({ getStorageUsage: vi.fn() }));
vi.mock("@/lib/storage-usage", () => usage);

const extraction = vi.hoisted(() => ({ queueDocumentExtractionIfNeeded: vi.fn() }));
vi.mock("@/lib/document-extraction", () => extraction);
vi.mock("@/lib/metadata-extraction", () => ({ extractMetadata: vi.fn().mockResolvedValue({}) }));
const activity = vi.hoisted(() => ({ createActivityLog: vi.fn(), ActivityAction: { MATERIAL_ADDED: "material.added" } }));
vi.mock("@/lib/activity", () => activity);

import { POST } from "@/app/api/materials/[materialId]/complete/route";
import { S3StorageService } from "@/lib/services/storage-s3";
import { getSessionUser } from "@/lib/access";

const MB = 1024 * 1024;
const uploading = { id: "mat-1", ownerId: "user-1", status: "UPLOADING", storageKey: "materials/user-1/mat-1.pdf", type: "PDF", groupId: null };

function fakeS3() {
  const s3 = Object.create(S3StorageService.prototype) as S3StorageService;
  s3.headObject = vi.fn();
  s3.deleteObject = vi.fn().mockResolvedValue(undefined);
  return s3;
}

const call = () => POST(new Request("https://example.test/api/materials/mat-1/complete", { method: "POST" }), { params: { materialId: "mat-1" } });

describe("POST /api/materials/[id]/complete — S3 backend", () => {
  let s3: ReturnType<typeof fakeS3>;

  beforeEach(() => {
    vi.resetAllMocks();
    datadog.sendDatadogMetric.mockResolvedValue(undefined);
    datadog.sendDatadogLog.mockResolvedValue(undefined);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1" } as never);
    s3 = fakeS3();
    storageModule.getStorageService.mockReturnValue(s3);
    db.material.findUnique.mockResolvedValue(uploading);
    db.material.updateMany.mockResolvedValue({ count: 1 });
    db.material.findUniqueOrThrow.mockImplementation(async () => ({ ...uploading, status: "READY" }));
    usage.getStorageUsage.mockResolvedValue({ plan: { maxFileSizeBytes: 25 * MB }, remainingBytes: 500 * MB });
    activity.createActivityLog.mockResolvedValue(undefined);
  });

  it("records the object's REAL size from storage on success (so storage quota is actually consumed)", async () => {
    vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 3 * MB });

    const res = await call();

    expect(res.status).toBe(200);
    expect(db.material.updateMany).toHaveBeenCalledWith({
      where: { id: "mat-1", status: "UPLOADING" },
      data: { status: "READY", sizeBytes: 3 * MB },
    });
    expect(extraction.queueDocumentExtractionIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark a material READY when the object was never uploaded — and leaves it UPLOADING so the client can retry", async () => {
    vi.mocked(s3.headObject).mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("UPLOAD_NOT_FOUND");
    expect(db.material.updateMany).not.toHaveBeenCalled();
    expect(extraction.queueDocumentExtractionIfNeeded).not.toHaveBeenCalled();
  });

  it("answers 503 (retryable) and changes nothing when storage can't be checked", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(s3.headObject).mockRejectedValue(new Error("S3 timed out"));

    const res = await call();

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("UPLOAD_VERIFY_UNAVAILABLE");
    expect(db.material.updateMany).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("rejects an object larger than the plan's per-file limit: FAILED, object deleted, 413", async () => {
    vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 200 * MB });

    const res = await call();

    expect(res.status).toBe(413);
    expect(db.material.updateMany).toHaveBeenCalledWith({ where: { id: "mat-1", status: "UPLOADING" }, data: { status: "FAILED" } });
    expect(s3.deleteObject).toHaveBeenCalledWith("materials/user-1/mat-1.pdf");
    expect(extraction.queueDocumentExtractionIfNeeded).not.toHaveBeenCalled();
  });

  it("rejects an upload that would exceed the remaining storage quota", async () => {
    usage.getStorageUsage.mockResolvedValue({ plan: { maxFileSizeBytes: 25 * MB }, remainingBytes: 1 * MB });
    vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 5 * MB });

    const res = await call();

    expect(res.status).toBe(413);
    expect(s3.deleteObject).toHaveBeenCalled();
  });

  it("rejects an empty object", async () => {
    vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 0 });
    expect((await call()).status).toBe(400);
  });

  it("only the request that wins the UPLOADING→READY transition runs the side effects (double-submit / client retry)", async () => {
    vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 1 * MB });
    db.material.updateMany.mockResolvedValue({ count: 0 }); // a concurrent /complete already settled it

    const res = await call();

    expect(res.status).toBe(200);
    expect(extraction.queueDocumentExtractionIfNeeded).not.toHaveBeenCalled();
    expect(activity.createActivityLog).not.toHaveBeenCalled();
  });

  it("stays idempotent for an already-completed material — no storage call at all", async () => {
    db.material.findUnique.mockResolvedValue({ ...uploading, status: "READY" });

    const res = await call();

    expect(res.status).toBe(200);
    expect(s3.headObject).not.toHaveBeenCalled();
  });

  it("still refuses someone else's material", async () => {
    db.material.findUnique.mockResolvedValue({ ...uploading, ownerId: "someone-else" });
    expect((await call()).status).toBe(403);
    expect(s3.headObject).not.toHaveBeenCalled();
  });
});
