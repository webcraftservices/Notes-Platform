import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { logServerError } from "@/lib/api-response";
import { sendDatadogMetric } from "@/lib/observability/datadog";
import { sendAzureMonitorMetric } from "@/lib/observability/azure-monitor";
import { getStorageService } from "@/lib/services/storage";
import { hasStrictIsolatedTestDb } from "@/lib/testing/isolated-db-guard";

export type OrphanCleanupStatus = "PENDING" | "EXHAUSTED";

export const DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS = 10;
export const DEFAULT_CLEANUP_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export interface StorageCleanupFailureRecord {
  storageKey: string;
  route: string;
  op: string;
  materialId?: string;
  userId?: string;
  ownerId?: string;
  reason?: string;
  error: string;
  status: OrphanCleanupStatus;
  recordedAt: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  lastAttemptedAt: string | null;
  persistedInDb: boolean;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
  claimedBy?: string | null;
  claimToken?: string | null;
}

export interface ClaimCleanupResult {
  claimed: boolean;
  claimToken: string | null;
}

export interface SafeStorageCleanupResult {
  deleted: boolean;
  storageKey: string;
  reconciliationRecorded: boolean;
  outboxCleared?: boolean;
  exhausted?: boolean;
  skippedReason?:
  | "empty_key"
  | "invalid_storage_key"
  | "ownership_mismatch"
  | "active_material_protected"
  | "lease_lost";
  error?: string;
}

interface OrphanCleanupDbRow {
  storageKey: string;
  route: string;
  op: string;
  materialId: string | null;
  userId: string | null;
  ownerId?: string | null;
  reason: string | null;
  error: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  lastAttemptedAt: Date | null;
  claimedAt?: Date | null;
  claimExpiresAt?: Date | null;
  claimedBy?: string | null;
  claimToken?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

interface OrphanCleanupDbDelegate {
  findUnique?: (args: { where: { storageKey: string } }) => Promise<OrphanCleanupDbRow | null>;
  findMany?: (args: {
    where?: Record<string, unknown>;
    orderBy?: unknown;
    take?: number;
  }) => Promise<OrphanCleanupDbRow[]>;
  upsert?: (args: {
    where: { storageKey: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<OrphanCleanupDbRow>;
  updateMany?: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;
  deleteMany?: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
  count?: (args?: { where?: Record<string, unknown> }) => Promise<number>;
}

const MAX_PENDING_ORPHAN_RECORDS = 500;
const pendingOrphanCleanups = new Map<string, StorageCleanupFailureRecord>();

/**
 * Exponential backoff schedule for failed storage deletions:
 * - Attempt 1 (initial inline delete failed): eligible immediately on next worker reconciliation pass
 * - Attempt 2+: 30s * 2^(attempts - 2), capped at 60 minutes.
 */
export function computeOrphanCleanupNextRetryAt(
  attempts: number,
  nowMs: number = Date.now()
): Date {
  if (attempts <= 1) {
    return new Date(nowMs);
  }
  const delayMs = Math.min(60 * 60 * 1000, 30 * 1000 * 2 ** (attempts - 2));
  return new Date(nowMs + delayMs);
}

function isUnmockedRealPrismaUnavailableForTests(): boolean {
  const dbAny = db as unknown as { $connect?: unknown };
  const isRealPrisma = typeof dbAny?.$connect === "function";
  if (!isRealPrisma) {
    return false;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    return true;
  }
  if (process.env.VITEST === "true" && !hasStrictIsolatedTestDb()) {
    return true;
  }
  return false;
}

function getOrphanCleanupDb(): OrphanCleanupDbDelegate | null {
  if (isUnmockedRealPrismaUnavailableForTests()) {
    return null;
  }
  const dbAny = db as unknown as { orphanStorageCleanup?: OrphanCleanupDbDelegate } | null | undefined;
  const delegate = dbAny?.orphanStorageCleanup;
  if (!delegate) return null;
  if (
    typeof delegate.upsert !== "function" &&
    typeof delegate.findMany !== "function" &&
    typeof delegate.findUnique !== "function"
  ) {
    return null;
  }
  return delegate;
}

function getMaterialFindFirst():
  | ((args: { where: Record<string, unknown>; select: { id: boolean } }) => Promise<{ id: string } | null>)
  | null {
  if (isUnmockedRealPrismaUnavailableForTests()) {
    return null;
  }
  const dbAny = db as unknown as {
    material?: {
      findFirst?: (args: {
        where: Record<string, unknown>;
        select: { id: boolean };
      }) => Promise<{ id: string } | null>;
    };
  };
  return typeof dbAny?.material?.findFirst === "function" ? dbAny.material.findFirst : null;
}

function mapRowToRecord(row: OrphanCleanupDbRow): StorageCleanupFailureRecord {
  const status: OrphanCleanupStatus = row.status === "EXHAUSTED" ? "EXHAUSTED" : "PENDING";
  return {
    storageKey: row.storageKey,
    route: row.route,
    op: row.op,
    ...(row.materialId ? { materialId: row.materialId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    ...(row.ownerId ? { ownerId: row.ownerId } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    error: row.error,
    status,
    recordedAt: row.createdAt.toISOString(),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextRetryAt: row.nextRetryAt.toISOString(),
    lastAttemptedAt: row.lastAttemptedAt ? row.lastAttemptedAt.toISOString() : null,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    claimExpiresAt: row.claimExpiresAt ? row.claimExpiresAt.toISOString() : null,
    claimedBy: row.claimedBy ?? null,
    claimToken: row.claimToken ?? null,
    persistedInDb: true,
  };
}

function recordOrphanCleanupFailureInMemory(
  entry: {
    storageKey: string;
    route: string;
    op: string;
    materialId?: string;
    userId?: string;
    ownerId?: string;
    reason?: string;
    error: string;
  },
  maxAttempts: number = DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS,
  nowMs: number = Date.now()
): { exhausted: boolean; attempts: number } {
  const existing = pendingOrphanCleanups.get(entry.storageKey);
  const attempts = (existing?.attempts ?? 0) + 1;
  const effectiveMax = existing?.maxAttempts ?? maxAttempts;
  const exhausted = attempts >= effectiveMax;
  const status: OrphanCleanupStatus = exhausted ? "EXHAUSTED" : "PENDING";
  const nextRetryAt = computeOrphanCleanupNextRetryAt(attempts, nowMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const record: StorageCleanupFailureRecord = {
    ...entry,
    status,
    recordedAt: existing?.recordedAt ?? nowIso,
    attempts,
    maxAttempts: effectiveMax,
    nextRetryAt,
    lastAttemptedAt: nowIso,
    claimedAt: null,
    claimExpiresAt: null,
    claimedBy: null,
    claimToken: null,
    persistedInDb: false,
  };
  pendingOrphanCleanups.delete(entry.storageKey);
  pendingOrphanCleanups.set(entry.storageKey, record);

  if (pendingOrphanCleanups.size > MAX_PENDING_ORPHAN_RECORDS) {
    const oldest = pendingOrphanCleanups.keys().next().value;
    if (oldest) pendingOrphanCleanups.delete(oldest);
  }

  return { exhausted, attempts };
}

async function persistOrphanCleanupFailure(entry: {
  storageKey: string;
  route: string;
  op: string;
  materialId?: string;
  userId?: string;
  ownerId?: string;
  reason?: string;
  error: string;
}): Promise<{ persistedInDb: boolean; exhausted: boolean; attempts: number }> {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const delegate = getOrphanCleanupDb();

  if (delegate && typeof delegate.upsert === "function") {
    try {
      const existing =
        typeof delegate.findUnique === "function"
          ? await delegate.findUnique({ where: { storageKey: entry.storageKey } })
          : null;
      const inMemExisting = pendingOrphanCleanups.get(entry.storageKey);
      const baseAttempts = existing?.attempts ?? inMemExisting?.attempts ?? 0;
      const maxAttempts = existing?.maxAttempts ?? DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS;
      const nextAttempts = baseAttempts + 1;
      const exhausted = nextAttempts >= maxAttempts;
      const status: OrphanCleanupStatus = exhausted ? "EXHAUSTED" : "PENDING";
      const nextRetryAt = computeOrphanCleanupNextRetryAt(nextAttempts, nowMs);

      const isActivelyClaimed = Boolean(
        existing?.claimExpiresAt &&
        existing.claimExpiresAt.getTime() > nowMs &&
        existing?.claimToken
      );

      await delegate.upsert({
        where: { storageKey: entry.storageKey },
        create: {
          storageKey: entry.storageKey,
          route: entry.route,
          op: entry.op,
          materialId: entry.materialId ?? null,
          userId: entry.userId ?? null,
          ownerId: entry.ownerId ?? null,
          reason: entry.reason ?? null,
          error: entry.error,
          status,
          attempts: nextAttempts,
          maxAttempts,
          nextRetryAt,
          lastAttemptedAt: now,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
          claimToken: null,
        },
        update: {
          route: entry.route,
          op: entry.op,
          ...(entry.materialId !== undefined ? { materialId: entry.materialId } : {}),
          ...(entry.userId !== undefined ? { userId: entry.userId } : {}),
          ...(entry.ownerId !== undefined ? { ownerId: entry.ownerId } : {}),
          ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
          error: entry.error,
          status,
          attempts: nextAttempts,
          nextRetryAt,
          lastAttemptedAt: now,
          // Preserve in-flight active worker claim if lease is still active
          ...(isActivelyClaimed
            ? {}
            : { claimedAt: null, claimExpiresAt: null, claimedBy: null, claimToken: null }),
        },
      });

      pendingOrphanCleanups.delete(entry.storageKey);

      if (exhausted) {
        emitExhaustedTelemetry(entry);
      }

      return { persistedInDb: true, exhausted, attempts: nextAttempts };
    } catch (dbErr) {
      logServerError(
        {
          route: entry.route,
          op: `${entry.op}:persist-orphan-db-fallback`,
          storageKey: entry.storageKey,
          materialId: entry.materialId,
          userId: entry.userId,
        },
        dbErr
      );
      if (process.env.NODE_ENV === "production") {
        void sendDatadogMetric("storage.cleanup.db_persistence_failures", 1, {
          type: "count",
          tags: [`op:${entry.op}`],
        });
        void sendAzureMonitorMetric("storage.cleanup.db_persistence_failures", 1, {
          properties: { op: entry.op, route: entry.route, storageKey: entry.storageKey },
        });
      }
    }
  }

  const memOutcome = recordOrphanCleanupFailureInMemory(entry, DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS, nowMs);
  if (memOutcome.exhausted) {
    emitExhaustedTelemetry(entry);
  }
  return { persistedInDb: false, exhausted: memOutcome.exhausted, attempts: memOutcome.attempts };
}

export async function clearOrphanCleanupRecord(storageKey: string, claimToken?: string): Promise<boolean> {
  const trimmedKey = storageKey?.trim();
  if (!trimmedKey) {
    return false;
  }
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const trimmedToken = claimToken?.trim();

  // STRICT FAIL-CLOSED VALIDATION:
  // If claimToken argument was supplied, it MUST be a non-empty string.
  // Passing an empty or whitespace string fails closed immediately.
  if (claimToken !== undefined && !trimmedToken) {
    return false;
  }

  const delegate = getOrphanCleanupDb();
  let dbCleared = false;

  if (delegate && typeof delegate.deleteMany === "function") {
    try {
      // If trimmedToken is present: require exact claimToken match!
      // If no token was provided (inline caller): can ONLY delete if the row is NOT actively claimed!
      // A row is unclaimed only if claimToken is null, or if it had a lease that explicitly expired.
      // If a row has a populated claimToken but claimExpiresAt is null (malformed/indefinite claim),
      // it MUST NOT be cleared by an unauthenticated inline caller.
      const whereCondition = trimmedToken
        ? {
            storageKey: trimmedKey,
            claimToken: trimmedToken,
          }
        : {
            storageKey: trimmedKey,
            OR: [
              { claimToken: null },
              {
                AND: [
                  { claimExpiresAt: { not: null } },
                  { claimExpiresAt: { lte: now } },
                ],
              },
            ],
          };

      const res = await delegate.deleteMany({ where: whereCondition });
      dbCleared = res.count > 0;
    } catch {
      dbCleared = false;
    }
  }

  // Mirror exact fail-closed semantics in memory fallback
  const inMem = pendingOrphanCleanups.get(trimmedKey);
  let memCleared = false;
  if (inMem) {
    if (trimmedToken) {
      if (inMem.claimToken === trimmedToken) {
        pendingOrphanCleanups.delete(trimmedKey);
        memCleared = true;
      }
    } else if (claimToken === undefined) {
      const hasToken = Boolean(inMem.claimToken);
      const memExpires = inMem.claimExpiresAt ? new Date(inMem.claimExpiresAt).getTime() : null;
      // An inline caller can ONLY clear if:
      // 1. claimToken is null/unpopulated, OR
      // 2. claimExpiresAt is non-null and expired (<= nowMs)
      const canClearInline = !hasToken || (memExpires !== null && memExpires <= nowMs);
      if (canClearInline) {
        pendingOrphanCleanups.delete(trimmedKey);
        memCleared = true;
      }
    }
  }

  return delegate ? dbCleared : memCleared;
}

function emitFailureTelemetry(
  context: { route: string; op: string; storageKey: string; materialId?: string; userId?: string; reason?: string },
  err: unknown
): void {
  logServerError(
    {
      route: context.route,
      op: context.op,
      storageKey: context.storageKey,
      materialId: context.materialId,
      userId: context.userId,
      reason: context.reason,
    },
    err
  );
  void sendDatadogMetric("storage.cleanup.failures", 1, {
    type: "count",
    tags: [`op:${context.op}`],
  });
  void sendAzureMonitorMetric("storage.cleanup.failures", 1, {
    properties: { op: context.op, route: context.route },
  });
}

function emitExhaustedTelemetry(entry: {
  storageKey: string;
  route: string;
  op: string;
  materialId?: string;
  userId?: string;
  error: string;
}): void {
  logServerError(
    {
      route: entry.route,
      op: `${entry.op}:exhausted`,
      storageKey: entry.storageKey,
      materialId: entry.materialId,
      userId: entry.userId,
    },
    new Error(`Orphan storage cleanup exhausted retry budget: ${entry.error}`)
  );
  void sendDatadogMetric("storage.cleanup.exhausted", 1, {
    type: "count",
    tags: [`op:${entry.op}`],
  });
  void sendAzureMonitorMetric("storage.cleanup.exhausted", 1, {
    properties: { op: entry.op, route: entry.route },
  });
}

export function isValidCleanupStorageKey(storageKey: string): boolean {
  if (!storageKey || storageKey.trim() !== storageKey || storageKey.length === 0) {
    return false;
  }
  if (
    storageKey.startsWith("/") ||
    storageKey.startsWith("\\") ||
    storageKey.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(storageKey)
  ) {
    return false;
  }
  const segments = storageKey.split("/");
  return segments.every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}

export function extractStorageKeyOwner(storageKey: string): string | null {
  const segments = storageKey.split("/");
  if (segments.length >= 3 && segments[0] === "materials" && segments[1]) {
    return segments[1];
  }
  return null;
}

export function getPendingOrphanStorageCleanups(): StorageCleanupFailureRecord[] {
  return [...pendingOrphanCleanups.values()];
}

export async function getDurableOrphanStorageCleanups(options: {
  includeExhausted?: boolean;
  limit?: number;
} = {}): Promise<StorageCleanupFailureRecord[]> {
  const includeExhausted = options.includeExhausted ?? true;
  const limit = options.limit ?? 500;
  const byKey = new Map<string, StorageCleanupFailureRecord>();

  const delegate = getOrphanCleanupDb();
  if (delegate && typeof delegate.findMany === "function") {
    try {
      const rows = await delegate.findMany({
        where: includeExhausted ? {} : { status: "PENDING" },
        orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      });
      for (const row of rows) {
        byKey.set(row.storageKey, mapRowToRecord(row));
      }
    } catch {
      // Fall through to in-memory records
    }
  }

  for (const mem of pendingOrphanCleanups.values()) {
    if (!includeExhausted && mem.status === "EXHAUSTED") continue;
    if (!byKey.has(mem.storageKey)) {
      byKey.set(mem.storageKey, mem);
    }
  }

  return [...byKey.values()];
}

export function _resetPendingOrphanStorageCleanupsForTesting(): void {
  pendingOrphanCleanups.clear();
}

/**
 * Atomically claims an outbox record for processing by a worker instance.
 * Uses atomic CAS via `updateMany` to ensure only one worker can process a given key.
 * Generates and returns a unique fencing token (`claimToken`).
 * If another worker already claimed the row and the claim has not expired, returns `{ claimed: false, claimToken: null }`.
 */
export async function claimOrphanStorageCleanup(
  storageKey: string,
  workerId: string,
  claimDurationMs: number = DEFAULT_CLEANUP_CLAIM_TIMEOUT_MS,
  customToken?: string
): Promise<ClaimCleanupResult> {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const claimExpiresAt = new Date(nowMs + claimDurationMs);
  const claimToken = customToken ?? `${workerId}:${randomUUID()}`;
  const delegate = getOrphanCleanupDb();

  if (delegate && typeof delegate.updateMany === "function") {
    try {
      const res = await delegate.updateMany({
        where: {
          storageKey,
          status: "PENDING",
          OR: [
            { claimExpiresAt: null },
            { claimExpiresAt: { lte: now } },
          ],
        },
        data: {
          claimedAt: now,
          claimExpiresAt,
          claimedBy: workerId,
          claimToken,
        },
      });
      if (res.count > 0) {
        return { claimed: true, claimToken };
      }
      return { claimed: false, claimToken: null };
    } catch {
      // Fall through to in-memory check
    }
  }

  const inMem = pendingOrphanCleanups.get(storageKey);
  if (inMem && inMem.status === "PENDING") {
    const memExpires = inMem.claimExpiresAt ? new Date(inMem.claimExpiresAt).getTime() : 0;
    if (!inMem.claimExpiresAt || memExpires <= nowMs) {
      inMem.claimedAt = now.toISOString();
      inMem.claimExpiresAt = claimExpiresAt.toISOString();
      inMem.claimedBy = workerId;
      inMem.claimToken = claimToken;
      return { claimed: true, claimToken };
    }
  }
  return { claimed: false, claimToken: null };
}

/**
 * Renews an active worker lease before it expires, requiring matching `workerId`
 * and fencing token (`claimToken`). Fails closed if any identifier is missing or whitespace.
 */
export async function renewOrphanStorageCleanupClaim(
  storageKey: string,
  workerId: string,
  claimToken: string,
  claimDurationMs: number = DEFAULT_CLEANUP_CLAIM_TIMEOUT_MS
): Promise<boolean> {
  const trimmedKey = typeof storageKey === "string" ? storageKey.trim() : "";
  const trimmedWorker = typeof workerId === "string" ? workerId.trim() : "";
  const trimmedToken = typeof claimToken === "string" ? claimToken.trim() : "";

  // Strict fail-closed: all identifiers are required non-empty strings
  if (!trimmedKey || !trimmedWorker || !trimmedToken) {
    return false;
  }

  const nowMs = Date.now();
  const now = new Date(nowMs);
  const newExpiresAt = new Date(nowMs + claimDurationMs);
  const delegate = getOrphanCleanupDb();

  if (delegate && typeof delegate.updateMany === "function") {
    try {
      const res = await delegate.updateMany({
        where: {
          storageKey: trimmedKey,
          claimedBy: trimmedWorker,
          claimToken: trimmedToken,
          claimExpiresAt: { gt: now },
        },
        data: {
          claimExpiresAt: newExpiresAt,
        },
      });
      return res.count > 0;
    } catch {
      // fall through
    }
  }

  const inMem = pendingOrphanCleanups.get(trimmedKey);
  if (
    inMem &&
    inMem.status === "PENDING" &&
    inMem.claimedBy === trimmedWorker &&
    inMem.claimToken === trimmedToken
  ) {
    const memExpires = inMem.claimExpiresAt ? new Date(inMem.claimExpiresAt).getTime() : 0;
    if (memExpires > nowMs) {
      inMem.claimExpiresAt = newExpiresAt.toISOString();
      return true;
    }
  }
  return false;
}

/**
 * Releases a worker lease after cleanup failure or error, incrementing retry attempts
 * and updating the backoff schedule. Enforces strict conditional ownership via `claimToken`
 * and `workerId` so a stale worker cannot modify, release, or corrupt a newer claim.
 */
export async function releaseOrphanStorageCleanupClaim(
  storageKey: string,
  workerId: string,
  options: {
    claimToken: string;
    incrementAttempts?: boolean;
    error?: string;
  }
): Promise<boolean> {
  const trimmedKey = typeof storageKey === "string" ? storageKey.trim() : "";
  const trimmedWorker = typeof workerId === "string" ? workerId.trim() : "";
  const trimmedToken = typeof options?.claimToken === "string" ? options.claimToken.trim() : "";

  // Strict fail-closed: workerId and claimToken are mandatory non-empty strings
  if (!trimmedKey || !trimmedWorker || !trimmedToken) {
    return false;
  }

  const nowMs = Date.now();
  const now = new Date(nowMs);
  const delegate = getOrphanCleanupDb();

  if (delegate) {
    try {
      const existing =
        typeof delegate.findUnique === "function"
          ? await delegate.findUnique({ where: { storageKey: trimmedKey } })
          : null;
      if (existing) {
        // Stale worker guard: if claimToken or claimedBy does not match DB, abort immediately
        if (existing.claimToken !== trimmedToken || existing.claimedBy !== trimmedWorker) {
          return false;
        }

        const nextAttempts = options.incrementAttempts ? existing.attempts + 1 : existing.attempts;
        const exhausted = nextAttempts >= existing.maxAttempts;
        const status: OrphanCleanupStatus = exhausted ? "EXHAUSTED" : "PENDING";
        const nextRetryAt = computeOrphanCleanupNextRetryAt(nextAttempts, nowMs);

        if (typeof delegate.updateMany === "function") {
          const res = await delegate.updateMany({
            where: {
              storageKey: trimmedKey,
              claimedBy: trimmedWorker,
              claimToken: trimmedToken,
              status: "PENDING",
            },
            data: {
              claimedAt: null,
              claimExpiresAt: null,
              claimedBy: null,
              claimToken: null,
              attempts: nextAttempts,
              status,
              nextRetryAt,
              lastAttemptedAt: now,
              ...(options.error ? { error: options.error } : {}),
            },
          });
          if (res.count === 0) {
            return false;
          }
        }
        if (exhausted) {
          emitExhaustedTelemetry({
            storageKey: trimmedKey,
            route: existing.route,
            op: existing.op,
            materialId: existing.materialId ?? undefined,
            userId: existing.userId ?? undefined,
            error: options.error ?? existing.error,
          });
        }
        return true;
      }
    } catch {
      // best-effort
    }
  }

  const inMem = pendingOrphanCleanups.get(trimmedKey);
  if (inMem) {
    if (inMem.claimToken !== trimmedToken || inMem.claimedBy !== trimmedWorker) {
      return false;
    }
    inMem.claimedAt = null;
    inMem.claimExpiresAt = null;
    inMem.claimedBy = null;
    inMem.claimToken = null;
    if (options.incrementAttempts) {
      inMem.attempts += 1;
      if (inMem.attempts >= inMem.maxAttempts) {
        inMem.status = "EXHAUSTED";
        emitExhaustedTelemetry({
          storageKey: trimmedKey,
          route: inMem.route,
          op: inMem.op,
          materialId: inMem.materialId,
          userId: inMem.userId,
          error: options.error ?? inMem.error,
        });
      }
      inMem.nextRetryAt = computeOrphanCleanupNextRetryAt(inMem.attempts, nowMs).toISOString();
    }
    return true;
  }
  return false;
}

/**
 * Operational reset: allows operators to un-stick EXHAUSTED records and re-queue them for retry.
 */
export async function resetExhaustedOrphanStorageCleanup(
  storageKey: string,
  options: { maxAttempts?: number } = {}
): Promise<boolean> {
  const now = new Date();
  const delegate = getOrphanCleanupDb();
  let resetInDb = false;

  if (delegate && typeof delegate.updateMany === "function") {
    try {
      const res = await delegate.updateMany({
        where: { storageKey },
        data: {
          status: "PENDING",
          attempts: 0,
          nextRetryAt: now,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
          claimToken: null,
          ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
        },
      });
      resetInDb = res.count > 0;
    } catch {
      // ignore
    }
  }

  const inMem = pendingOrphanCleanups.get(storageKey);
  if (inMem) {
    inMem.status = "PENDING";
    inMem.attempts = 0;
    inMem.nextRetryAt = now.toISOString();
    inMem.claimedAt = null;
    inMem.claimExpiresAt = null;
    inMem.claimedBy = null;
    if (options.maxAttempts) inMem.maxAttempts = options.maxAttempts;
    return true;
  }

  return resetInDb;
}

/**
 * Directly schedules an orphan storage cleanup entry into the durable outbox table.
 */
export async function scheduleDurableOrphanCleanup(entry: {
  storageKey: string;
  route: string;
  op: string;
  materialId?: string;
  userId?: string;
  ownerId?: string;
  reason?: string;
  error: string;
  maxAttempts?: number;
}): Promise<{ persistedInDb: boolean; status: OrphanCleanupStatus }> {
  const rec = await persistOrphanCleanupFailure(entry);
  return {
    persistedInDb: rec.persistedInDb,
    status: rec.exhausted ? "EXHAUSTED" : "PENDING",
  };
}

export interface DeleteStorageObjectContext {
  route: string;
  op: string;
  materialId?: string;
  userId?: string;
  /** Expected owner ID encoded in `materials/<ownerId>/...` when distinct from acting `userId` (e.g., group admin delete). */
  ownerId?: string;
  reason?: string;
  claimToken?: string;
  workerId?: string;
  isLeaseActive?: () => boolean;
  storageService?: { deleteObject?: (key: string) => Promise<void> } | null;
}

/**
 * Deletes a storage object with:
 * - structural storage-key validation & user ownership enforcement (`materials/<ownerId>/...`)
 * - active-material protection (never deletes a key still attached to an active READY/PROCESSING Material)
 * - structured error reporting & observability metrics
 * - durable PostgreSQL-backed outbox (`OrphanStorageCleanup`) with bounded retry backoff, plus an
 *   in-process bounded fallback Map if DB writes fail or DB delegates aren't available in tests.
 */
export async function deleteStorageObjectSafely(
  storageKey: string,
  context: DeleteStorageObjectContext
): Promise<SafeStorageCleanupResult> {
  if (!storageKey) {
    return { deleted: false, storageKey: "", reconciliationRecorded: false, error: "Empty storageKey" };
  }

  if (!isValidCleanupStorageKey(storageKey)) {
    const msg = "Refusing unsafe or malformed storageKey.";
    logServerError(
      {
        route: context.route,
        op: `${context.op}:invalid-key`,
        storageKey,
        materialId: context.materialId,
        userId: context.userId,
        reason: context.reason,
      },
      new Error(msg)
    );
    await clearOrphanCleanupRecord(storageKey, context.claimToken);
    return {
      deleted: false,
      storageKey,
      reconciliationRecorded: false,
      skippedReason: "invalid_storage_key",
      error: msg,
    };
  }

  const keyOwner = extractStorageKeyOwner(storageKey);
  const expectedOwner = context.ownerId ?? context.userId;
  if (expectedOwner && keyOwner !== null && keyOwner !== expectedOwner) {
    const msg = "Storage key ownership mismatch; refusing deletion.";
    logServerError(
      {
        route: context.route,
        op: `${context.op}:ownership-mismatch`,
        storageKey,
        materialId: context.materialId,
        userId: context.userId,
        ownerId: context.ownerId,
        reason: context.reason,
      },
      new Error(msg)
    );
    await clearOrphanCleanupRecord(storageKey, context.claimToken);
    return {
      deleted: false,
      storageKey,
      reconciliationRecorded: false,
      skippedReason: "ownership_mismatch",
      error: msg,
    };
  }

  const findActiveMaterial = getMaterialFindFirst();
  if (findActiveMaterial) {
    try {
      const activeOwner = await findActiveMaterial({
        where: {
          storageKey,
          deletedAt: null,
          status: { in: ["READY", "PROCESSING"] },
        },
        select: { id: true },
      });
      if (activeOwner) {
        const msg = `Storage key is currently owned by active material '${activeOwner.id}'; refusing deletion.`;
        logServerError(
          {
            route: context.route,
            op: `${context.op}:active-material-protected`,
            storageKey,
            materialId: activeOwner.id,
            userId: context.userId,
            reason: context.reason,
          },
          new Error(msg)
        );
        await clearOrphanCleanupRecord(storageKey, context.claimToken);
        return {
          deleted: false,
          storageKey,
          reconciliationRecorded: false,
          skippedReason: "active_material_protected",
          error: msg,
        };
      }
    } catch {
      // Fail-safe: if DB lookup unexpectedly fails during rollback, still proceed with storage cleanup check if key was explicitly targeted by caller
    }
  }

  let storage: { deleteObject?: (key: string) => Promise<void> } | null | undefined;
  try {
    storage = context.storageService ?? getStorageService();
  } catch (resolveErr) {
    const errMsg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
    emitFailureTelemetry({ ...context, storageKey }, resolveErr);
    if (context.claimToken) {
      await releaseOrphanStorageCleanupClaim(storageKey, context.workerId ?? "unknown-worker", {
        claimToken: context.claimToken,
        incrementAttempts: true,
        error: errMsg,
      });
      return {
        deleted: false,
        storageKey,
        reconciliationRecorded: true,
        error: errMsg,
      };
    }
    const rec = await persistOrphanCleanupFailure({
      storageKey,
      route: context.route,
      op: context.op,
      materialId: context.materialId,
      userId: context.userId,
      ownerId: context.ownerId,
      reason: context.reason,
      error: errMsg,
    });
    const durableRecorded = process.env.NODE_ENV === "production" ? rec.persistedInDb : true;
    return {
      deleted: false,
      storageKey,
      reconciliationRecorded: durableRecorded,
      ...(rec.exhausted ? { exhausted: true } : {}),
      error: errMsg,
    };
  }

  if (!storage || typeof storage.deleteObject !== "function") {
    const msg = "Storage service unavailable or does not implement deleteObject.";
    emitFailureTelemetry({ ...context, storageKey }, new Error(msg));
    if (context.claimToken) {
      await releaseOrphanStorageCleanupClaim(storageKey, context.workerId ?? "unknown-worker", {
        claimToken: context.claimToken,
        incrementAttempts: true,
        error: msg,
      });
      return {
        deleted: false,
        storageKey,
        reconciliationRecorded: true,
        error: msg,
      };
    }
    const rec = await persistOrphanCleanupFailure({
      storageKey,
      route: context.route,
      op: context.op,
      materialId: context.materialId,
      userId: context.userId,
      ownerId: context.ownerId,
      reason: context.reason,
      error: msg,
    });
    const durableRecorded = process.env.NODE_ENV === "production" ? rec.persistedInDb : true;
    return {
      deleted: false,
      storageKey,
      reconciliationRecorded: durableRecorded,
      ...(rec.exhausted ? { exhausted: true } : {}),
      error: msg,
    };
  }

  if (context.isLeaseActive && !context.isLeaseActive()) {
    return {
      deleted: false,
      storageKey,
      reconciliationRecorded: true,
      skippedReason: "lease_lost",
      error: "Worker lease lost before storage deletion; aborted",
    };
  }

  try {
    await storage.deleteObject(storageKey);
    if (context.isLeaseActive && !context.isLeaseActive()) {
      return {
        deleted: true,
        outboxCleared: false,
        storageKey,
        reconciliationRecorded: true,
        skippedReason: "lease_lost",
        error: "Worker lease lost after storage deletion; aborted outbox clearance",
      };
    }
    const cleared = await clearOrphanCleanupRecord(storageKey, context.claimToken);
    if (!cleared && context.claimToken) {
      await releaseOrphanStorageCleanupClaim(storageKey, context.workerId ?? "unknown-worker", {
        claimToken: context.claimToken,
        incrementAttempts: false,
        error: "Storage deleted but outbox record clearance failed; released claim for next retry pass",
      });
    }
    return {
      deleted: true,
      outboxCleared: cleared,
      storageKey,
      reconciliationRecorded: false,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emitFailureTelemetry({ ...context, storageKey }, err);
    if (context.claimToken) {
      await releaseOrphanStorageCleanupClaim(storageKey, context.workerId ?? "unknown-worker", {
        claimToken: context.claimToken,
        incrementAttempts: true,
        error: errMsg,
      });
      return {
        deleted: false,
        storageKey,
        reconciliationRecorded: true,
        error: errMsg,
      };
    }
    const rec = await persistOrphanCleanupFailure({
      storageKey,
      route: context.route,
      op: context.op,
      materialId: context.materialId,
      userId: context.userId,
      ownerId: context.ownerId,
      reason: context.reason,
      error: errMsg,
    });
    const durableRecorded = process.env.NODE_ENV === "production" ? rec.persistedInDb : true;
    return {
      deleted: false,
      storageKey,
      reconciliationRecorded: durableRecorded,
      ...(rec.exhausted ? { exhausted: true } : {}),
      error: errMsg,
    };
  }
}

/**
 * Retries previously failed orphan object cleanups persisted in PostgreSQL
 * (`OrphanStorageCleanup` where `status = "PENDING"` and `nextRetryAt <= now`)
 * as well as any in-memory fallback entries recorded during temporary DB outages.
 */
export async function retryPendingOrphanStorageCleanups(
  options: {
    limit?: number;
    now?: Date;
    forceDue?: boolean;
    workerId?: string;
    claimDurationMs?: number;
    storageService?: { deleteObject?: (key: string) => Promise<void> } | null;
  } = {}
): Promise<{
  attempted: number;
  cleaned: number;
  remaining: number;
}> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const limit = options.limit ?? 50;
  const workerId =
    options.workerId ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const claimDurationMs = options.claimDurationMs ?? DEFAULT_CLEANUP_CLAIM_TIMEOUT_MS;
  const dueByKey = new Map<string, StorageCleanupFailureRecord>();

  const delegate = getOrphanCleanupDb();
  if (delegate && typeof delegate.findMany === "function") {
    try {
      const dbRows = await delegate.findMany({
        where: {
          status: "PENDING",
          ...(options.forceDue ? {} : { nextRetryAt: { lte: now } }),
          OR: [
            { claimExpiresAt: null },
            { claimExpiresAt: { lte: now } },
          ],
        },
        orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      });
      for (const row of dbRows) {
        dueByKey.set(row.storageKey, mapRowToRecord(row));
      }
    } catch {
      // Continue with in-memory fallback records if DB read fails
    }
  }

  for (const entry of pendingOrphanCleanups.values()) {
    if (dueByKey.size >= limit) break;
    if (entry.status !== "PENDING") continue;
    if (!options.forceDue && new Date(entry.nextRetryAt).getTime() > nowMs) continue;
    const memExpires = entry.claimExpiresAt ? new Date(entry.claimExpiresAt).getTime() : 0;
    if (entry.claimExpiresAt && memExpires > nowMs) continue;
    if (!dueByKey.has(entry.storageKey)) {
      dueByKey.set(entry.storageKey, entry);
    }
  }

  const entries = [...dueByKey.values()];
  let cleaned = 0;
  let attempted = 0;

  for (const entry of entries) {
    const claimRes = await claimOrphanStorageCleanup(entry.storageKey, workerId, claimDurationMs);
    if (!claimRes.claimed || !claimRes.claimToken) {
      continue;
    }
    attempted += 1;
    const claimToken = claimRes.claimToken;

    let heartbeatActive = true;
    let leaseLost = false;
    const heartbeatIntervalMs = Math.max(500, Math.min(Math.floor(claimDurationMs / 2), 15000));
    const heartbeatTimer = setInterval(async () => {
      if (!heartbeatActive) return;
      try {
        const renewed = await renewOrphanStorageCleanupClaim(
          entry.storageKey,
          workerId,
          claimToken,
          claimDurationMs
        );
        if (!renewed && heartbeatActive) {
          leaseLost = true;
        }
      } catch {
        // network/transient error during renewal
      }
    }, heartbeatIntervalMs);

    try {
      const res = await deleteStorageObjectSafely(entry.storageKey, {
        route: entry.route,
        op: entry.op.endsWith(":retry") ? entry.op : `${entry.op}:retry`,
        materialId: entry.materialId,
        userId: entry.userId,
        ownerId: entry.ownerId,
        reason: entry.reason,
        claimToken,
        workerId,
        isLeaseActive: () => !leaseLost && heartbeatActive,
        storageService: options.storageService,
      });

      heartbeatActive = false;
      clearInterval(heartbeatTimer);

      if (res.deleted && res.outboxCleared !== false && !leaseLost) {
        cleaned += 1;
      }
    } catch (unhandledErr) {
      heartbeatActive = false;
      clearInterval(heartbeatTimer);
      // In case deleteStorageObjectSafely threw an unhandled exception, release lease
      const errMsg = unhandledErr instanceof Error ? unhandledErr.message : String(unhandledErr);
      await releaseOrphanStorageCleanupClaim(entry.storageKey, workerId, {
        claimToken,
        incrementAttempts: true,
        error: errMsg,
      });
    } finally {
      heartbeatActive = false;
      clearInterval(heartbeatTimer);
    }
  }

  let dbPendingCount = 0;
  if (delegate && typeof delegate.count === "function") {
    dbPendingCount = await delegate.count({ where: { status: "PENDING" } }).catch(() => 0);
  } else if (delegate && typeof delegate.findMany === "function") {
    const rows = await delegate
      .findMany({ where: { status: "PENDING" }, take: 500 })
      .catch(() => []);
    dbPendingCount = rows.length;
  }

  let memPendingCount = 0;
  for (const entry of pendingOrphanCleanups.values()) {
    if (entry.status === "PENDING") memPendingCount += 1;
  }

  return {
    attempted,
    cleaned,
    remaining: Math.max(dbPendingCount, memPendingCount),
  };
}
