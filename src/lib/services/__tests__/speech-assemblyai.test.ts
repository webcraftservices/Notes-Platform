import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssemblyAISpeechService } from "@/lib/services/speech-assemblyai";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const COMPLETED = {
  id: "t1",
  status: "completed",
  text: "hello world",
  language_code: "en",
  audio_duration: 4,
  utterances: [{ start: 0, end: 4000, text: "hello world", speaker: "A" }],
};

/** upload → create-transcript succeed; then `polls` are served in order. */
function stubFetch(polls: Array<() => Response | Promise<Response>>) {
  let pollIndex = 0;
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/v2/upload")) return json({ upload_url: "https://cdn.example/audio" });
    if (u.endsWith("/v2/transcript")) return json({ id: "t1" });
    const next = polls[Math.min(pollIndex++, polls.length - 1)]!;
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, pollCount: () => pollIndex };
}

async function runTranscription(service: AssemblyAISpeechService) {
  const promise = service.transcribe({ audioBuffer: Buffer.from("audio"), mimeType: "audio/mpeg" });
  // Attach a handler right away so a rejection while timers advance isn't reported as unhandled.
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error })
  );
  await vi.advanceTimersByTimeAsync(60_000);
  return settled;
}

describe("AssemblyAISpeechService — Phase 9.4 polling resilience", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("survives transient status-check failures (5xx, 429, dropped connection) on a transcript that is still running remotely", async () => {
    const { pollCount } = stubFetch([
      () => new Response("bad gateway", { status: 502 }),
      () => new Response("slow down", { status: 429 }),
      () => Promise.reject(new TypeError("fetch failed")),
      () => json(COMPLETED),
    ]);

    const outcome = await runTranscription(new AssemblyAISpeechService("key"));

    expect(outcome.ok).toBe(true);
    expect(pollCount()).toBe(4);
    if (outcome.ok) expect(outcome.value.segments[0]?.text).toBe("hello world");
  });

  it("gives up after 5 consecutive transient failures instead of polling a dead endpoint for 20 minutes", async () => {
    const { pollCount } = stubFetch([() => new Response("down", { status: 503 })]);

    const outcome = await runTranscription(new AssemblyAISpeechService("key"));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toMatch(/5 times in a row/);
    expect(pollCount()).toBe(5);
  });

  it("fails immediately on a non-transient error such as a revoked key (401) — retrying can't fix it", async () => {
    const { pollCount } = stubFetch([() => new Response("unauthorized", { status: 401 })]);

    const outcome = await runTranscription(new AssemblyAISpeechService("key"));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toMatch(/\(401\)/);
    expect(pollCount()).toBe(1);
  });

  it("resets the failure counter after a successful poll (isolated blips never add up)", async () => {
    const running = () => json({ id: "t1", status: "processing" });
    const blip = () => new Response("err", { status: 500 });
    const { pollCount } = stubFetch([blip, blip, blip, blip, running, blip, blip, blip, blip, () => json(COMPLETED)]);

    const outcome = await runTranscription(new AssemblyAISpeechService("key"));

    expect(outcome.ok).toBe(true);
    expect(pollCount()).toBe(10);
  });

  it("does not retry the billed create-transcript call: one failure is one call", async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).endsWith("/v2/upload")) return json({ upload_url: "https://cdn.example/audio" });
      return new Response("boom", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await runTranscription(new AssemblyAISpeechService("key"));

    expect(outcome.ok).toBe(false);
    const createCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v2/transcript"));
    expect(createCalls).toHaveLength(1);
  });

  it("gives every outbound call an abort signal (an explicit timeout)", async () => {
    const { fetchMock } = stubFetch([() => json(COMPLETED)]);

    await runTranscription(new AssemblyAISpeechService("key"));

    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("caps provider error bodies included in the (user-visible) failure message", async () => {
    stubFetch([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).endsWith("/v2/upload") ? new Response("x".repeat(5000), { status: 500 }) : json({})
      )
    );

    const outcome = await runTranscription(new AssemblyAISpeechService("key"));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message.length).toBeLessThan(400);
  });
});
