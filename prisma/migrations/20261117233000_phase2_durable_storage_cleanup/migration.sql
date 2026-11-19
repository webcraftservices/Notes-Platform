-- Phase 2 Pre-CI Safety Hardening: Durable database-backed storage orphan cleanup queue.
-- Replaces volatile in-memory-only tracking so failed R2/S3/local object deletions survive
-- web/worker process restarts and deployments, with bounded retry attempts & backoff.

CREATE TABLE "OrphanStorageCleanup" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "materialId" TEXT,
    "userId" TEXT,
    "ownerId" TEXT,
    "reason" TEXT,
    "error" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "claimToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrphanStorageCleanup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrphanStorageCleanup_storageKey_key" ON "OrphanStorageCleanup"("storageKey");
CREATE INDEX "OrphanStorageCleanup_status_nextRetryAt_claimExpiresAt_idx" ON "OrphanStorageCleanup"("status", "nextRetryAt", "claimExpiresAt");
CREATE INDEX "OrphanStorageCleanup_materialId_idx" ON "OrphanStorageCleanup"("materialId");
CREATE INDEX "OrphanStorageCleanup_userId_idx" ON "OrphanStorageCleanup"("userId");
