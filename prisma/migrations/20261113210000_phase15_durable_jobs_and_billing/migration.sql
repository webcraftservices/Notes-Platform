-- Phase 15: Durable Background Job Tracking & Stripe Subscription Billing Infrastructure
-- Forward-only migration: adds queue execution metadata to ProcessingJob,
-- Stripe subscription columns to Subscription, and BillingWebhookEvent idempotency table.

-- AlterTable: ProcessingJob
ALTER TABLE "ProcessingJob"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "workerId" TEXT,
  ADD COLUMN IF NOT EXISTS "queueJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ProcessingJob_status_createdAt_idx" ON "ProcessingJob"("status", "createdAt");

-- AlterTable: Subscription
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "externalSubscriptionId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalPriceId" TEXT,
  ADD COLUMN IF NOT EXISTS "billingInterval" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastWebhookEventAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_externalSubscriptionId_key" ON "Subscription"("externalSubscriptionId");
CREATE INDEX IF NOT EXISTS "Subscription_externalCustomerId_idx" ON "Subscription"("externalCustomerId");

-- CreateTable: BillingWebhookEvent
CREATE TABLE IF NOT EXISTS "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventCreatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "userId" TEXT,
    "payloadHash" TEXT,
    "error" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingWebhookEvent_externalEventId_key" ON "BillingWebhookEvent"("externalEventId");
CREATE INDEX IF NOT EXISTS "BillingWebhookEvent_userId_idx" ON "BillingWebhookEvent"("userId");
CREATE INDEX IF NOT EXISTS "BillingWebhookEvent_eventType_idx" ON "BillingWebhookEvent"("eventType");

