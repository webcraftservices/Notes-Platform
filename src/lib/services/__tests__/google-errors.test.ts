import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveService } from "@/lib/services/google-drive";
import {
  GoogleApiError,
  GoogleFileTooLargeError,
  GOOGLE_RECONNECT_REQUIRED,
  isRetryableGoogleError,
} from "@/lib/services/google-errors";
import { RequestTimeoutError } from "@/lib/fetch-timeout";

describe("isRetryableGoogleError", () => {
  const api = (status: number) => new GoogleApiError(`status ${status}`, { status, publicMessage: "x" });

  it.each([429, 500, 502, 503, 504])("retries a transient Google status (%i)", (status) => {
    expect(isRetryableGoogleError(api(status))).toBe(true);
  });

  it.each([400, 401, 403, 404])("never retries a permanent/permission failure (%i) — that would only add load", (status) => {
    expect(isRetryableGoogleError(api(status))).toBe(false);
  });

  it("retries our own request timeout and transport-level network errors", () => {
    expect(isRetryableGoogleError(new RequestTimeoutError("Google Drive request", 20_000))).toBe(true);
    expect(isRetryableGoogleError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableGoogleError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("never retries an oversized file or an unrelated error", () => {
    expect(isRetryableGoogleError(new GoogleFileTooLargeError(10 * 1024 * 1024))).toBe(false);
    expect(isRetryableGoogleError(new Error("This would exceed your plan's storage limit."))).toBe(false);
  });
});

describe("GoogleDriveService.downloadFile — size cap", () => {
  afterEach(() => vi.unstubAllGlobals());

  function streamOf(chunks: Uint8Array[], headers: Record<string, string> = {}) {
    let read = 0;
    const cancelled = { value: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read < chunks.length) controller.enqueue(chunks[read++]);
        else controller.close();
      },
      cancel() {
        cancelled.value = true;
      },
    });
    return { response: new Response(body, { status: 200, headers }), cancelled };
  }

  it("refuses from the declared Content-Length without reading a single byte of the body", async () => {
    const { response, cancelled } = streamOf([new Uint8Array(10)], { "content-length": String(5 * 1024 * 1024 * 1024) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      new GoogleDriveService().downloadFile({ accessToken: "t", fileId: "f", maxBytes: 25 * 1024 * 1024 })
    ).rejects.toBeInstanceOf(GoogleFileTooLargeError);
    expect(cancelled.value).toBe(true);
  });

  it("stops reading as soon as a response with no/dishonest Content-Length exceeds the cap", async () => {
    const chunk = new Uint8Array(400);
    const { response, cancelled } = streamOf(Array.from({ length: 100 }, () => chunk));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      new GoogleDriveService().downloadFile({ accessToken: "t", fileId: "f", maxBytes: 1000 })
    ).rejects.toBeInstanceOf(GoogleFileTooLargeError);
    expect(cancelled.value).toBe(true);
  });

  it("returns the whole file when it is within the cap", async () => {
    const { response } = streamOf([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const buffer = await new GoogleDriveService().downloadFile({ accessToken: "t", fileId: "f", maxBytes: 1000 });

    expect([...buffer]).toEqual([1, 2, 3, 4, 5]);
  });

  it("classifies Drive 5xx as a transient GoogleApiError whose public message never carries the provider body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("internal detail: project-1234 quota shard", { status: 503 })));

    const err = await new GoogleDriveService().downloadFile({ accessToken: "t", fileId: "f" }).catch((e) => e);

    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.isTransient).toBe(true);
    expect(err.publicMessage).not.toContain("project-1234");
  });

  it("gives every Drive call an abort signal (explicit timeout)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new GoogleDriveService().listFiles({ accessToken: "t" } as never).catch(() => undefined);

    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("googleFailureResponse", () => {
  it("shows a user-safe message for Google failures, and NEVER echoes an internal (non-Google) error to the browser", async () => {
    vi.doMock("@/lib/observability/datadog", () => ({
      sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
      sendDatadogLog: vi.fn().mockResolvedValue(undefined),
    }));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { googleFailureResponse } = await import("@/lib/google-route-errors");
    const ctx = { route: "integrations/google/import", op: "import", userId: "u1" };

    const internal = googleFailureResponse(new Error("Invalid `prisma.material.create()` invocation: relation \"Material\" ..."), ctx);
    expect(internal.status).toBe(500);
    expect(JSON.stringify(await internal.json())).not.toMatch(/prisma|relation/i);

    const reconnect = googleFailureResponse(
      new GoogleApiError("grant dead", { status: 400, publicMessage: GOOGLE_RECONNECT_REQUIRED }),
      ctx
    );
    expect(reconnect.status).toBe(409);
    expect((await reconnect.json()).error).toBe(GOOGLE_RECONNECT_REQUIRED);

    const upstream = googleFailureResponse(
      new GoogleApiError("Google Drive request failed (503): raw body", { status: 503, publicMessage: "Google Drive is temporarily unavailable. Please try again in a moment." }),
      ctx
    );
    expect(upstream.status).toBe(502);
    expect(JSON.stringify(await upstream.json())).not.toContain("raw body");

    const timeout = googleFailureResponse(new RequestTimeoutError("Google Drive request", 20_000), ctx);
    expect(timeout.status).toBe(504);
    consoleSpy.mockRestore();
    vi.doUnmock("@/lib/observability/datadog");
  });
});
