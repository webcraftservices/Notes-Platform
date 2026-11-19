import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockRedisConn {
  status: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
}

const createdConns: MockRedisConn[] = [];
const nextSubscribeBehavior: Array<() => Promise<unknown>> = [];

const connectionMocks = vi.hoisted(() => ({
  isBullMqEnabled: vi.fn(() => true),
  createBullMqRedisConnection: vi.fn(),
}));

vi.mock("@/lib/queue/connection", () => connectionMocks);

function makeMockConn(initialStatus = "connecting"): MockRedisConn {
  const conn: MockRedisConn = {
    status: initialStatus,
    on: vi.fn(),
    subscribe: vi.fn(async () => {
      const fn = nextSubscribeBehavior.shift();
      if (fn) {
        return fn();
      }
      conn.status = "ready";
      return 1;
    }),
    publish: vi.fn().mockResolvedValue(1),
    quit: vi.fn(async () => {
      conn.status = "end";
      return "OK";
    }),
    disconnect: vi.fn(() => {
      conn.status = "end";
    }),
    removeAllListeners: vi.fn(),
  };
  createdConns.push(conn);
  return conn;
}

describe("Stage B / AUD-06 — Redis Pub/Sub Subscriber Lifecycle & Reconnect Cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdConns.length = 0;
    nextSubscribeBehavior.length = 0;
    process.env.SSE_REDIS_PUBSUB_ENABLED = "true";
    connectionMocks.isBullMqEnabled.mockReturnValue(true);
    connectionMocks.createBullMqRedisConnection.mockImplementation(() =>
      makeMockConn("connecting")
    );
  });

  afterEach(async () => {
    const eventsMod = await import("@/lib/queue/events");
    await eventsMod.closeJobEventPubSub();
    delete process.env.SSE_REDIS_PUBSUB_ENABLED;
  });

  it("reuses active connecting/reconnecting subscribers, coalesces concurrent calls, and detaches dead clients before replacement", async () => {
    const { ensureJobEventSubscriber, closeJobEventPubSub } = await import(
      "@/lib/queue/events"
    );

    // Concurrent calls share a single subscriber connection
    const [ok1, ok2] = await Promise.all([
      ensureJobEventSubscriber(),
      ensureJobEventSubscriber(),
    ]);
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(1);

    const firstConn = createdConns[0]!;
    // Reconnecting status must still reuse existing owned subscriber (zero leaks)
    firstConn.status = "reconnecting";
    expect(await ensureJobEventSubscriber()).toBe(true);
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(1);

    // Terminal "end" state triggers cleanup + single fresh replacement
    firstConn.status = "end";
    expect(await ensureJobEventSubscriber()).toBe(true);
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(2);
    expect(firstConn.removeAllListeners).toHaveBeenCalledTimes(1);

    // Concurrent close during in-flight subscribe cleans up newly created socket cleanly
    await closeJobEventPubSub();
    let releaseSubscribe: () => void = () => {};
    nextSubscribeBehavior.push(
      () =>
        new Promise<void>((resolve) => {
          releaseSubscribe = resolve;
        })
    );

    const pendingEnsure = ensureJobEventSubscriber();
    const inFlightConn = createdConns[2]!;
    await closeJobEventPubSub();
    releaseSubscribe();
    const afterShutdownResult = await pendingEnsure;

    expect(afterShutdownResult).toBe(false);
    expect(inFlightConn.disconnect).toHaveBeenCalled();
    expect(inFlightConn.removeAllListeners).toHaveBeenCalled();
  });

  it("prevents stale subscribe generation from clearing a newer subscriberPromise and allows clean retry on errors (NEW-02)", async () => {
    const { ensureJobEventSubscriber, closeJobEventPubSub } = await import(
      "@/lib/queue/events"
    );

    let resolveCallA!: () => void;
    let resolveCallB!: () => void;
    nextSubscribeBehavior.push(
      () =>
        new Promise<void>((resolve) => {
          resolveCallA = resolve;
        }),
      () =>
        new Promise<void>((resolve) => {
          resolveCallB = resolve;
        })
    );

    // 1. Start Call A (gen 0) and leave it pending on subA.subscribe()
    const promiseA = ensureJobEventSubscriber();
    const connA = createdConns[0]!;
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(1);

    // 2. Advance generation via closeJobEventPubSub(), then start Call B (gen 1)
    await closeJobEventPubSub();
    const promiseB = ensureJobEventSubscriber();
    const connB = createdConns[1]!;
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(2);

    // 3. Resolve stale Call A AFTER Call B is already in-flight; Call A's finally must NOT clear promiseB
    resolveCallA();
    await expect(promiseA).resolves.toBe(false);
    expect(connA.disconnect).toHaveBeenCalled();

    // 4. Call C joins while Call B is still pending -> MUST coalesce onto promiseB without creating connC
    const promiseC = ensureJobEventSubscriber();
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(2);

    // 5. Resolve Call B -> mark active and share result cleanly between B and C
    connB.status = "ready";
    resolveCallB();
    const [resB, resC] = await Promise.all([promiseB, promiseC]);
    expect(resB).toBe(true);
    expect(resC).toBe(true);
    expect(connectionMocks.createBullMqRedisConnection).toHaveBeenCalledTimes(2);

    // 6. Clean shutdown closes active gen-1 subscriber
    await closeJobEventPubSub();
    expect(connB.quit).toHaveBeenCalled();

    // 7. Failed initialization (async reject OR synchronous constructor throw) clears cache so subsequent retry succeeds
    connectionMocks.createBullMqRedisConnection.mockImplementationOnce(() => {
      throw new Error("sync constructor failure");
    });
    await expect(ensureJobEventSubscriber()).resolves.toBe(false);

    nextSubscribeBehavior.push(async () => {
      throw new Error("async subscribe failure");
    });
    await expect(ensureJobEventSubscriber()).resolves.toBe(false);

    await expect(ensureJobEventSubscriber()).resolves.toBe(true);
  });
});
