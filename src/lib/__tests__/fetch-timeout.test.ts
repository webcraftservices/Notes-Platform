import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/fetch-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes an abort signal to fetch and returns the response unchanged on success", async () => {
    const response = new Response("ok");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWithTimeout("https://example.test/x", { method: "POST" }, { timeoutMs: 1000, label: "Test call" });

    expect(result).toBe(response);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("actually aborts a request that never answers, with a message that names the call but not the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
          })
      )
    );

    const error = await fetchWithTimeout("https://example.test/secret?token=abc", undefined, {
      timeoutMs: 20,
      label: "Google Drive request",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error.message).toMatch(/Google Drive request timed out/);
    expect(error.message).not.toContain("token=abc");
  });

  it("does not disguise unrelated network errors as timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const error = await fetchWithTimeout("https://example.test/x", undefined, { timeoutMs: 1000, label: "x" }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
  });
});
