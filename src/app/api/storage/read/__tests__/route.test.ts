import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleMaterialByStorageKey: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const storageModule = vi.hoisted(() => ({ getStorageService: vi.fn() }));
vi.mock("@/lib/services/storage", () => storageModule);

vi.mock("@/lib/observability/datadog", () => ({
  sendDatadogLog: vi.fn().mockResolvedValue(undefined),
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
}));

// Phase 9.5 correction: keep the real jsonError/INTERNAL_ERROR/etc. so
// response shapes stay realistic, but spy on logServerError so tests can
// assert it — rather than a raw console.error — is what the route calls
// for unexpected S3/provider failures (task item 3/4).
vi.mock("@/lib/api-response", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-response")>();
  return { ...actual, logServerError: vi.fn() };
});

import { GET } from "@/app/api/storage/read/route";
import { S3StorageService } from "@/lib/services/storage-s3";
import { logServerError } from "@/lib/api-response";

function fakeS3() {
  const s3 = Object.create(S3StorageService.prototype) as S3StorageService;
  s3.headObject = vi.fn();
  s3.getObjectRange = vi.fn();
  return s3;
}

class FakeS3NotFoundError extends Error {
  name = "NotFound";
}

const material = { id: "mat-1", mimeType: "video/mp4", title: "Lecture", originalFilename: "lecture.mp4" };

function call(rangeHeader?: string) {
  const url = "https://example.test/api/storage/read?key=materials/mat-1.mp4";
  const req = new Request(url, { headers: rangeHeader ? { range: rangeHeader } : {} });
  return GET(req);
}

describe("GET /api/storage/read — S3 backend (Phase 9.5)", () => {
  let s3: ReturnType<typeof fakeS3>;

  beforeEach(() => {
    vi.resetAllMocks();
    s3 = fakeS3();
    storageModule.getStorageService.mockReturnValue(s3);
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleMaterialByStorageKey.mockResolvedValue(material);
  });

  describe("no Range header", () => {
    it("requests the full object and returns 200", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 3 });
      vi.mocked(s3.getObjectRange).mockResolvedValue(Buffer.from([1, 2, 3]));

      const res = await call();

      expect(res.status).toBe(200);
      expect(s3.getObjectRange).toHaveBeenCalledWith("materials/mat-1.mp4");
      expect(res.headers.get("Content-Length")).toBe("3");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    });
  });

  describe("normal (start-end) range", () => {
    it("uses a HEAD + ranged GET — it never downloads the whole object to serve a byte-range request", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 500_000_000 }); // large "video"
      vi.mocked(s3.getObjectRange).mockResolvedValue(Buffer.from([7, 7]));

      const res = await call("bytes=1000-1001");

      expect(res.status).toBe(206);
      expect(s3.getObjectRange).toHaveBeenCalledWith("materials/mat-1.mp4", { start: 1000, end: 1001 });
      expect(res.headers.get("Content-Range")).toBe("bytes 1000-1001/500000000");
      expect(res.headers.get("Content-Length")).toBe("2");
      expect(await res.arrayBuffer()).toEqual(new Uint8Array([7, 7]).buffer);
    });
  });

  describe("open-ended range (bytes=N-)", () => {
    it("resolves to [N, fileSize-1] and fetches only that slice from S3", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 5000 });
      vi.mocked(s3.getObjectRange).mockResolvedValue(Buffer.alloc(4000));

      const res = await call("bytes=1000-");

      expect(res.status).toBe(206);
      expect(s3.getObjectRange).toHaveBeenCalledWith("materials/mat-1.mp4", { start: 1000, end: 4999 });
      expect(res.headers.get("Content-Range")).toBe("bytes 1000-4999/5000");
      expect(res.headers.get("Content-Length")).toBe("4000");
    });
  });

  describe("suffix range (bytes=-N)", () => {
    it("resolves the range against the object's REAL size from HEAD (a suffix range needs the true total)", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 1000 });
      vi.mocked(s3.getObjectRange).mockResolvedValue(Buffer.from([1]));

      await call("bytes=-100"); // last 100 bytes

      expect(s3.getObjectRange).toHaveBeenCalledWith("materials/mat-1.mp4", { start: 900, end: 999 });
    });
  });

  describe("unsatisfiable range", () => {
    it("returns 416 with Content-Range: bytes */<size> and never fetches the object", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 1000 });

      const res = await call("bytes=999999999-");

      expect(res.status).toBe(416);
      expect(res.status).not.toBe(200);
      expect(res.headers.get("Content-Range")).toBe("bytes */1000");
      expect(s3.getObjectRange).not.toHaveBeenCalled();
    });

    it("still calls HEAD first (needs the real size to know the range is out of bounds) but nothing beyond that", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 42 });

      await call("bytes=1000-2000");

      expect(s3.headObject).toHaveBeenCalledTimes(1);
      expect(s3.getObjectRange).not.toHaveBeenCalled();
    });
  });

  describe("missing object", () => {
    it("returns 404 without ever calling getObjectRange when HEAD reports the object doesn't exist", async () => {
      vi.mocked(s3.headObject).mockResolvedValue(null);

      const res = await call();

      expect(res.status).toBe(404);
      expect(s3.getObjectRange).not.toHaveBeenCalled();
      expect(logServerError).not.toHaveBeenCalled();
    });

    it("returns 404 when the object is deleted between HEAD and GET (a genuine S3 NotFound from getObjectRange)", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 100 });
      vi.mocked(s3.getObjectRange).mockRejectedValue(new FakeS3NotFoundError("no such key"));

      const res = await call();

      expect(res.status).toBe(404);
      expect(logServerError).not.toHaveBeenCalled();
    });
  });

  describe("provider/infrastructure failure", () => {
    it("HEAD failing (network/5xx/timeout) is a 500 with a safe generic body, logged via logServerError — never a 404", async () => {
      const rawError = new Error("connect ECONNREFUSED 10.0.0.5:443 — bucket my-prod-bucket, key materials/mat-1.mp4");
      vi.mocked(s3.headObject).mockRejectedValue(rawError);

      const res = await call();
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(res.status).not.toBe(404);
      expect(body).toEqual({ error: "Something went wrong. Please try again." });
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|bucket|10\.0\.0\.5/);
      expect(logServerError).toHaveBeenCalledWith(
        expect.objectContaining({ route: "storage/read", userId: "user-1" }),
        rawError
      );
    });

    it("getObjectRange failing with an unexpected (non-NotFound) error is also a 500, logged, and never exposes the raw error", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 1000 });
      const rawError = new Error("S3 503 SlowDown: please reduce your request rate");
      vi.mocked(s3.getObjectRange).mockRejectedValue(rawError);

      const res = await call("bytes=0-99");
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(res.status).not.toBe(404);
      expect(body).toEqual({ error: "Something went wrong. Please try again." });
      expect(JSON.stringify(body)).not.toMatch(/SlowDown|please reduce/);
      expect(logServerError).toHaveBeenCalledWith(
        expect.objectContaining({ route: "storage/read", userId: "user-1" }),
        rawError
      );
    });

    it("a full-file (no-range) request that fails at getObjectRange is also a safe 500, not a 404", async () => {
      vi.mocked(s3.headObject).mockResolvedValue({ sizeBytes: 1000 });
      vi.mocked(s3.getObjectRange).mockRejectedValue(new Error("network timeout"));

      const res = await call();

      expect(res.status).toBe(500);
      expect(logServerError).toHaveBeenCalled();
    });
  });

  describe("authorization", () => {
    it("still enforces authorization before touching storage", async () => {
      access.getAccessibleMaterialByStorageKey.mockRejectedValue(new access.NotAuthorizedError());

      const res = await call();

      expect(res.status).toBe(403);
      expect(s3.headObject).not.toHaveBeenCalled();
    });

    it("resolves the material/authorization check before ever calling S3 HEAD", async () => {
      const order: string[] = [];
      access.getAccessibleMaterialByStorageKey.mockImplementation(async () => {
        order.push("authorize");
        return material;
      });
      vi.mocked(s3.headObject).mockImplementation(async () => {
        order.push("head");
        return { sizeBytes: 10 };
      });
      vi.mocked(s3.getObjectRange).mockResolvedValue(Buffer.from([1]));

      await call();

      expect(order).toEqual(["authorize", "head"]);
    });
  });
});
