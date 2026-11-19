import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn(),
  material: { update: vi.fn() },
  processingJob: { updateMany: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleMaterial: vi.fn(),
}));
vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();
  return {
    ...actual,
    getSessionUser: access.getSessionUser,
    getAccessibleMaterial: access.getAccessibleMaterial,
  };
});

const storage = vi.hoisted(() => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/services/storage", () => ({
  getStorageService: () => storage,
}));

const docExtraction = vi.hoisted(() => ({
  cancelActiveDocumentExtractionForMaterial: vi.fn(),
}));
vi.mock("@/lib/document-extraction", () => docExtraction);

import { DELETE } from "@/app/api/materials/[materialId]/route";

const testUser = { id: "user-1", name: "Alice" };
const testMaterial = {
  id: "mat-1",
  ownerId: "user-1",
  userId: "user-1",
  title: "Lecture Notes",
  type: "PDF",
  storageKey: "materials/user-1/m.pdf",
  deletedAt: null,
};

describe("DELETE /api/materials/[materialId] — Material Deletion & Active Extraction Cancellation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    storage.deleteObject.mockResolvedValue(undefined);
    access.getSessionUser.mockResolvedValue(testUser);
    access.getAccessibleMaterial.mockResolvedValue(testMaterial);
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRawUnsafe.mockResolvedValue(1);
    tx.material.update.mockResolvedValue({ ...testMaterial, deletedAt: new Date() });
    tx.processingJob.updateMany.mockResolvedValue({ count: 1 });
  });

  it("returns 401 when caller is unauthenticated", async () => {
    access.getSessionUser.mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost"), { params: { materialId: "mat-1" } });
    expect(res.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when material is not accessible", async () => {
    access.getAccessibleMaterial.mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost"), { params: { materialId: "mat-1" } });
    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("atomically soft-deletes material under advisory lock, cancels queued/running jobs, and cancels in-flight extraction", async () => {
    const res = await DELETE(new Request("http://localhost"), { params: { materialId: "mat-1" } });
    expect(res.status).toBe(200);

    // Advisory lock acquired inside transaction
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      "job:DOCUMENT_EXTRACTION:mat-1"
    );

    // Soft-deletes material
    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: "mat-1" },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });

    // Cancels all queued and running processing jobs for the deleted material
    expect(tx.processingJob.updateMany).toHaveBeenCalledWith({
      where: {
        materialId: "mat-1",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: expect.objectContaining({
        status: "CANCELLED",
        completedAt: expect.any(Date),
      }),
    });

    // Signals in-flight active extraction runner to abort cooperatively
    expect(docExtraction.cancelActiveDocumentExtractionForMaterial).toHaveBeenCalledWith(
      "mat-1",
      "Material was deleted."
    );

    // Deletes stored object best-effort
    expect(storage.deleteObject).toHaveBeenCalledWith("materials/user-1/m.pdf");
  });
});
