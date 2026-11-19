import { beforeEach, describe, expect, it, vi } from "vitest";

const apiResp = vi.hoisted(() => ({
  logServerError: vi.fn(),
}));
vi.mock("@/lib/api-response", () => apiResp);

const datadog = vi.hoisted(() => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/datadog", () => datadog);

const azure = vi.hoisted(() => ({
  sendAzureMonitorMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/azure-monitor", () => azure);

const storageMocks = vi.hoisted(() => ({
  getStorageService: vi.fn(),
}));
vi.mock("@/lib/services/storage", () => storageMocks);

import {
  _resetPendingOrphanStorageCleanupsForTesting,
  deleteStorageObjectSafely,
  getPendingOrphanStorageCleanups,
  retryPendingOrphanStorageCleanups,
} from "@/lib/services/storage-cleanup";

describe("storage-cleanup service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetPendingOrphanStorageCleanupsForTesting();
    datadog.sendDatadogMetric.mockResolvedValue(undefined);
    azure.sendAzureMonitorMetric.mockResolvedValue(undefined);
  });

  it("returns deleted: true cleanly and clears prior reconciliation record when deleteObject succeeds", async () => {
    const deleteObject = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient R2 outage"))
      .mockResolvedValueOnce(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    const first = await deleteStorageObjectSafely("materials/u-1/m-1.pdf", {
      route: "/api/materials/[materialId]/complete",
      op: "orphan_cleanup",
      materialId: "m-1",
      userId: "u-1",
      reason: "group deleted",
    });

    expect(first.deleted).toBe(false);
    expect(first.reconciliationRecorded).toBe(true);
    expect(first.error).toContain("transient R2 outage");
    expect(getPendingOrphanStorageCleanups()).toHaveLength(1);
    expect(getPendingOrphanStorageCleanups()[0]).toMatchObject({
      storageKey: "materials/u-1/m-1.pdf",
      attempts: 1,
      materialId: "m-1",
      userId: "u-1",
    });

    const retried = await retryPendingOrphanStorageCleanups();
    expect(retried).toEqual({ attempted: 1, cleaned: 1, remaining: 0 });
    expect(getPendingOrphanStorageCleanups()).toHaveLength(0);
  });

  it("logs structured error, emits Datadog + Azure metrics, and bounds pending orphan queue when deleteObject fails", async () => {
    storageMocks.getStorageService.mockReturnValue({
      deleteObject: vi.fn().mockRejectedValue(new Error("permission denied")),
    });

    const result = await deleteStorageObjectSafely("materials/u-1/m-2.pdf", {
      route: "/api/storage/upload",
      op: "local_orphan_rollback",
      materialId: "m-2",
      userId: "u-1",
    });

    expect(result).toEqual({
      deleted: false,
      storageKey: "materials/u-1/m-2.pdf",
      reconciliationRecorded: true,
      error: "permission denied",
    });
    expect(apiResp.logServerError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/storage/upload",
        op: "local_orphan_rollback",
        storageKey: "materials/u-1/m-2.pdf",
        materialId: "m-2",
        userId: "u-1",
      }),
      expect.any(Error)
    );
    expect(datadog.sendDatadogMetric).toHaveBeenCalledWith(
      "storage.cleanup.failures",
      1,
      expect.objectContaining({ type: "count", tags: ["op:local_orphan_rollback"] })
    );
    expect(azure.sendAzureMonitorMetric).toHaveBeenCalledWith(
      "storage.cleanup.failures",
      1,
      expect.objectContaining({
        properties: { op: "local_orphan_rollback", route: "/api/storage/upload" },
      })
    );

    // Bounded capacity (max 500 records)
    for (let i = 0; i < 520; i += 1) {
      await deleteStorageObjectSafely(`materials/u-1/extra-${i}.pdf`, {
        route: "/api/materials/[materialId]",
        op: "delete_material_object",
      });
    }
    expect(getPendingOrphanStorageCleanups().length).toBe(500);
  });

  it("handles getStorageService throwing or missing deleteObject without crashing caller", async () => {
    storageMocks.getStorageService.mockImplementation(() => {
      throw new Error("storage misconfigured");
    });

    const res = await deleteStorageObjectSafely("materials/u-1/m-3.pdf", {
      route: "/api/materials/[materialId]",
      op: "delete_material_object",
    });

    expect(res.deleted).toBe(false);
    expect(res.reconciliationRecorded).toBe(true);
    expect(res.error).toContain("storage misconfigured");
    expect(apiResp.logServerError).toHaveBeenCalledTimes(1);
    expect(datadog.sendDatadogMetric).toHaveBeenCalledTimes(1);
    expect(azure.sendAzureMonitorMetric).toHaveBeenCalledTimes(1);
  });
});
