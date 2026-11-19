import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeJobEventPubSub,
  createStreamEventId,
  emitProcessingJobEvent,
  getJobEventsRedisChannel,
  isRedisPubSubSseEnabled,
  subscribeToSingleJobEvents,
} from "@/lib/queue/events";

describe("Stage B — SSE Event Bus & Cross-Replica Redis Pub/Sub Bridge", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeJobEventPubSub();
  });

  it("resolves Redis Pub/Sub SSE opt-in cleanly and scopes channel by BULLMQ_QUEUE_NAME", () => {
    expect(isRedisPubSubSseEnabled({})).toBe(false);
    expect(getJobEventsRedisChannel({})).toBe("zenote-processing-jobs:job-events");
    expect(
      getJobEventsRedisChannel({ BULLMQ_QUEUE_NAME: "zenote-staging-jobs" })
    ).toBe("zenote-staging-jobs:job-events");
  });

  it("emits sanitized single-job SSE events cleanly without Redis when pub/sub is disabled", () => {
    const received: string[] = [];
    const unsubscribe = subscribeToSingleJobEvents("job-sse-1", (ev) => {
      received.push(`${ev.eventId}:${ev.status}:${ev.progress}`);
    });

    const emitted = emitProcessingJobEvent({
      eventId: "1760000000-1",
      jobId: "job-sse-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "DOCUMENT_EXTRACTION",
      status: "RUNNING",
      progress: 45,
      error: null,
    });

    unsubscribe();

    expect(emitted.progress).toBe(45);
    expect(received).toEqual(["1760000000-1:RUNNING:45"]);
  });

  it("embeds per-process random instance entropy in generated SSE event IDs for multi-replica dedup (NEW-02)", () => {
    const id1 = createStreamEventId(1760000000);
    const id2 = createStreamEventId(1760000000);
    expect(id1).toMatch(/^1760000000-[0-9a-f]{8}-\d+$/);
    expect(id1).not.toBe(id2);
  });
});
