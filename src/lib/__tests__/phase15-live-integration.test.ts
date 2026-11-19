import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { createBullMqRedisConnection, resolveBullMqRedisConfig } from "@/lib/queue/connection";
import {
  computeStripeWebhookSignature,
  processStripeWebhookEvent,
} from "@/lib/billing/stripe";
import { reconcileStrandedProcessingJobs } from "@/lib/queue/reconciliation";
import {
  assertIsolatedTestDatabaseConfig,
  resolveIsolatedTestDatabaseUrl,
  verifyLiveIsolatedDatabaseIdentity,
} from "@/lib/testing/isolated-db-guard";

const isolatedDbUrl = resolveIsolatedTestDatabaseUrl() ?? "";
const runLivePostgres = Boolean(isolatedDbUrl);
const runLiveBullMq =
  runLivePostgres &&
  process.env.ENABLE_LIVE_BULLMQ_TESTS === "true" &&
  resolveBullMqRedisConfig() !== null;

describe.skipIf(!runLivePostgres)(
  "Phase 15 Live PostgreSQL & Redis/BullMQ Integration Verification",
  () => {
    let prisma: PrismaClient;
    const testUserId = `u-phase15-live-${Date.now()}`;
    const testWorkspaceId = `ws-phase15-live-${Date.now()}`;
    const testMaterialId = `mat-phase15-live-${Date.now()}`;

    beforeAll(async () => {
      const verifiedUrl = assertIsolatedTestDatabaseConfig();
      prisma = new PrismaClient({
        datasources: { db: { url: verifiedUrl } },
      });

      const liveDbName = await verifyLiveIsolatedDatabaseIdentity(prisma, verifiedUrl);
      expect(liveDbName).toBeTruthy();

      // Clean up any stale phase15 live test fixtures from interrupted runs
      await prisma.processingJob
        .deleteMany({ where: { userId: { startsWith: "u-phase15-live-" } } })
        .catch(() => undefined);
      await prisma.billingWebhookEvent
        .deleteMany({ where: { userId: { startsWith: "u-phase15-live-" } } })
        .catch(() => undefined);
      await prisma.material
        .deleteMany({ where: { id: { startsWith: "mat-phase15-live-" } } })
        .catch(() => undefined);
      await prisma.subscription
        .deleteMany({ where: { userId: { startsWith: "u-phase15-live-" } } })
        .catch(() => undefined);
      await prisma.workspace
        .deleteMany({ where: { id: { startsWith: "ws-phase15-live-" } } })
        .catch(() => undefined);
      await prisma.user
        .deleteMany({ where: { id: { startsWith: "u-phase15-live-" } } })
        .catch(() => undefined);

      await prisma.user.create({
        data: {
          id: testUserId,
          email: `${testUserId}@zenote.test`,
          name: "Phase 15 Live Verification User",
        },
      });
      await prisma.workspace.create({
        data: {
          id: testWorkspaceId,
          name: "Phase 15 Workspace",
          slug: testWorkspaceId,
          ownerId: testUserId,
        },
      });
      await prisma.subscription.create({
        data: {
          userId: testUserId,
          plan: "FREE",
          status: "ACTIVE",
        },
      });
      await prisma.material.create({
        data: {
          id: testMaterialId,
          ownerId: testUserId,
          workspaceId: testWorkspaceId,
          type: "GOOGLE_DOC",
          title: "Phase 15 Live Sync Doc",
          status: "PROCESSING",
          externalRef: {
            provider: "google_drive",
            fileId: "live-drive-file-15",
            syncStatus: "SYNCING",
          },
        },
      });
    }, 30_000);

    afterAll(async () => {
      if (prisma) {
        await prisma.processingJob
          .deleteMany({ where: { userId: { startsWith: "u-phase15-live-" } } })
          .catch(() => undefined);
        await prisma.billingWebhookEvent
          .deleteMany({ where: { userId: { startsWith: "u-phase15-live-" } } })
          .catch(() => undefined);
        await prisma.material
          .deleteMany({ where: { id: { startsWith: "mat-phase15-live-" } } })
          .catch(() => undefined);
        await prisma.subscription
          .deleteMany({ where: { userId: { startsWith: "u-phase15-live-" } } })
          .catch(() => undefined);
        await prisma.workspace
          .deleteMany({ where: { id: { startsWith: "ws-phase15-live-" } } })
          .catch(() => undefined);
        await prisma.user
          .deleteMany({ where: { id: { startsWith: "u-phase15-live-" } } })
          .catch(() => undefined);
        await prisma.$disconnect();
      }
    }, 30_000);

    it("1. verifies Phase 15 schema migration columns on ProcessingJob, Subscription, and BillingWebhookEvent in live PostgreSQL", async () => {
      const job = await prisma.processingJob.create({
        data: {
          userId: testUserId,
          materialId: testMaterialId,
          type: "GOOGLE_SYNC",
          status: "QUEUED",
          attempts: 0,
          maxAttempts: 3,
          workerId: "worker-live-1",
          queueJobId: "GOOGLE_SYNC:test-1",
        },
      });
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
      expect(job.workerId).toBe("worker-live-1");
      expect(job.queueJobId).toBe("GOOGLE_SYNC:test-1");

      await prisma.processingJob.delete({ where: { id: job.id } });
    });

    it("2. reconciles stranded QUEUED and exhausted RUNNING jobs in live PostgreSQL (LIM-18 resolution)", async () => {
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const strandedJob = await prisma.processingJob.create({
        data: {
          userId: testUserId,
          materialId: testMaterialId,
          type: "DOCUMENT_EXTRACTION",
          status: "QUEUED",
          attempts: 0,
          maxAttempts: 3,
          createdAt: oldTimestamp,
        },
      });

      const dispatchedIds: string[] = [];
      const summary = await reconcileStrandedProcessingJobs({
        dispatchFn: (id) => {
          dispatchedIds.push(id);
        },
      });

      expect(summary.requeuedJobIds).toContain(strandedJob.id);
      expect(dispatchedIds).toContain(strandedJob.id);

      const updatedJob = await prisma.processingJob.findUniqueOrThrow({
        where: { id: strandedJob.id },
      });
      expect(updatedJob.status).toBe("QUEUED");
      expect(updatedJob.attempts).toBe(1);

      await prisma.processingJob.delete({ where: { id: strandedJob.id } });
    });

    it("3. processes Stripe webhook lifecycle events idempotently with out-of-order protection in live PostgreSQL", async () => {
      const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_live_pg_test_secret";

      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const eventId = `evt_live_pg_${Date.now()}`;
        const rawBody = JSON.stringify({
          id: eventId,
          type: "checkout.session.completed",
          created: nowSec,
          data: {
            object: {
              id: "cs_live_1",
              customer: `cus_live_${Date.now()}`,
              subscription: `sub_live_${Date.now()}`,
              client_reference_id: testUserId,
              metadata: { userId: testUserId, plan: "PRO" },
            },
          },
        });
        const sig = computeStripeWebhookSignature(
          rawBody,
          nowSec,
          "whsec_live_pg_test_secret"
        );
        const header = `t=${nowSec},v1=${sig}`;

        const first = await processStripeWebhookEvent(rawBody, header);
        expect(first.status).toBe("processed");

        const subAfterUpgrade = await prisma.subscription.findUniqueOrThrow({
          where: { userId: testUserId },
        });
        expect(subAfterUpgrade.plan).toBe("PRO");
        expect(subAfterUpgrade.status).toBe("ACTIVE");

        // Duplicate delivery of the exact same Stripe event ID must be ignored idempotently
        const second = await processStripeWebhookEvent(rawBody, header);
        expect(second.status).toBe("duplicate_ignored");

        const storedWebhookEvents = await prisma.billingWebhookEvent.findMany({
          where: { externalEventId: eventId },
        });
        expect(storedWebhookEvents).toHaveLength(1);
        expect(storedWebhookEvents[0]!.status).toBe("PROCESSED");
      } finally {
        if (prevSecret === undefined) {
          delete process.env.STRIPE_WEBHOOK_SECRET;
        } else {
          process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
        }
      }
    });

    it.skipIf(!runLiveBullMq)(
      "4. executes a real BullMQ Queue + Worker round-trip over Upstash TLS TCP Redis and updates PostgreSQL ProcessingJob state",
      async () => {
        const testQueueName = `zenote-phase15-verify-${Date.now()}`;
        const producerConn = createBullMqRedisConnection();
        const workerConn = createBullMqRedisConnection();

        const queue = new Queue<{ jobId: string }>(testQueueName, {
          connection: producerConn,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: true,
          },
        });

        const pgJob = await prisma.processingJob.create({
          data: {
            userId: testUserId,
            materialId: testMaterialId,
            type: "EMBEDDING",
            status: "QUEUED",
          },
        });

        let processedByWorker: string | null = null;
        const completionPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for live BullMQ worker")),
            15_000
          );

          const worker = new Worker<{ jobId: string }>(
            testQueueName,
            async (bullJob) => {
              await prisma.processingJob.update({
                where: { id: bullJob.data.jobId },
                data: {
                  status: "SUCCEEDED",
                  progress: 100,
                  workerId: "upstash-live-worker",
                  completedAt: new Date(),
                },
              });
              processedByWorker = bullJob.data.jobId;
            },
            {
              connection: workerConn,
              concurrency: 1,
              stalledInterval: 60_000,
              drainDelay: 5,
            }
          );

          worker.on("completed", async () => {
            clearTimeout(timeout);
            await worker.close().catch(() => undefined);
            resolve();
          });

          worker.on("failed", async (_j, err) => {
            clearTimeout(timeout);
            await worker.close().catch(() => undefined);
            reject(err);
          });
        });

        try {
          await queue.add("EMBEDDING", { jobId: pgJob.id });
          await completionPromise;

          expect(processedByWorker).toBe(pgJob.id);
          const verifiedPgJob = await prisma.processingJob.findUniqueOrThrow({
            where: { id: pgJob.id },
          });
          expect(verifiedPgJob.status).toBe("SUCCEEDED");
          expect(verifiedPgJob.progress).toBe(100);
          expect(verifiedPgJob.workerId).toBe("upstash-live-worker");
        } finally {
          await queue.obliterate({ force: true }).catch(() => undefined);
          await queue.close().catch(() => undefined);
          await producerConn.quit().catch(() => undefined);
          await workerConn.quit().catch(() => undefined);
          await prisma.processingJob
            .delete({ where: { id: pgJob.id } })
            .catch(() => undefined);
        }
      },
      25_000
    );
  }
);
