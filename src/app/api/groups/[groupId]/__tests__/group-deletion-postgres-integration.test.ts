import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { DELETE as deleteGroupRoute } from "@/app/api/groups/[groupId]/route";
import { POST as createSubjectRoute } from "@/app/api/subjects/route";
import { POST as createChapterRoute } from "@/app/api/subjects/[subjectId]/chapters/route";
import { POST as createTopicRoute } from "@/app/api/chapters/[chapterId]/topics/route";
import { POST as createInvitationRoute } from "@/app/api/groups/[groupId]/invitations/route";
import { POST as createConversationRoute } from "@/app/api/ai/conversations/route";
import {
  assertIsolatedTestDatabaseConfig,
  resolveIsolatedTestDatabaseUrl,
  verifyLiveIsolatedDatabaseIdentity,
} from "@/lib/testing/isolated-db-guard";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const RUN_ID = `lim01_pg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const isolatedUrl = resolveIsolatedTestDatabaseUrl();
const hasIsolatedTestDb = Boolean(isolatedUrl);

interface SpawnedWorkerHandle {
  child: ChildProcess;
  waitForLockAcquired: () => Promise<Record<string, unknown>>;
  sendGo: () => void;
  waitForDone: () => Promise<Record<string, unknown>>;
  kill: () => void;
}

function spawnWorkerProcess(
  bundlePath: string,
  config: Record<string, unknown>
): SpawnedWorkerHandle {
  const child = spawn(process.execPath, [bundlePath], {
    env: {
      ...process.env,
      LIM01_WORKER_CONFIG: JSON.stringify(config),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<(msg: Record<string, unknown>) => void> = [];
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("message", (raw) => {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as Record<string, unknown>;
    const idx = waiters.findIndex((fn) => {
      fn(msg);
      return true;
    });
    if (idx === -1) {
      messages.push(msg);
    }
  });

  function nextMatching(type: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const existingIdx = messages.findIndex((m) => m.type === type || m.type === "ERROR");
    if (existingIdx >= 0) {
      const [found] = messages.splice(existingIdx, 1);
      if (found?.type === "ERROR") {
        return Promise.reject(new Error(`Worker error: ${found.message} (stderr: ${stderr})`));
      }
      return Promise.resolve(found!);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for worker IPC '${type}'. stderr=${stderr}`));
      }, timeoutMs);

      const handler = (msg: Record<string, unknown>) => {
        if (msg.type === "ERROR") {
          clearTimeout(timer);
          reject(new Error(`Worker error: ${msg.message} (stderr: ${stderr})`));
          return;
        }
        if (msg.type === type) {
          clearTimeout(timer);
          resolve(msg);
          return;
        }
        messages.push(msg);
      };

      const wrapped = (msg: Record<string, unknown>) => {
        const i = waiters.indexOf(wrapped);
        if (i >= 0) waiters.splice(i, 1);
        handler(msg);
      };
      waiters.push(wrapped);
    });
  }

  return {
    child,
    waitForLockAcquired: () => nextMatching("LOCK_ACQUIRED"),
    sendGo: () => child.send({ type: "GO" }),
    waitForDone: async () => {
      const done = await nextMatching("DONE");
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
      });
      return done;
    },
    kill: () => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    },
  };
}

async function waitForBlockedApplicationInPgLocks(
  monitorDb: PrismaClient,
  blockedAppName: string,
  timeoutMs = 10_000
): Promise<{ appName: string; waitEvent: string | null; mode: string; locktype: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await monitorDb.$queryRaw<
      Array<{ app_name: string; wait_event: string | null; mode: string; locktype: string }>
    >`
      SELECT
        a.application_name AS app_name,
        a.wait_event AS wait_event,
        l.mode AS mode,
        l.locktype AS locktype
      FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid = a.pid
      WHERE a.application_name = ${blockedAppName}
        AND NOT l.granted
    `;
    if (rows.length > 0) {
      return {
        appName: rows[0]!.app_name,
        waitEvent: rows[0]!.wait_event,
        mode: rows[0]!.mode,
        locktype: rows[0]!.locktype,
      };
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `Deterministic lock contention verification failed: '${blockedAppName}' was never observed waiting on an ungranted pg_locks entry within ${timeoutMs}ms.`
  );
}

describe.skipIf(!hasIsolatedTestDb)(
  "LIM-01 Real Multi-Process PostgreSQL Concurrency & Serialization Verification",
  () => {
    let adminDb: PrismaClient;
    let bundleDir = "";
    let workerBundlePath = "";
    let ownerId = "";
    let adminId = "";

    async function cleanupLim01Fixtures() {
      const users = await adminDb.user.findMany({
        where: { email: { startsWith: "lim01_pg_", endsWith: "@zenote.test" } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      if (userIds.length === 0) return;

      const ownedGroups = await adminDb.groupMember.findMany({
        where: { userId: { in: userIds } },
        select: { groupId: true },
      });
      const groupIds = [...new Set(ownedGroups.map((m) => m.groupId))];

      if (groupIds.length > 0) {
        await adminDb.notification.deleteMany({ where: { userId: { in: userIds } } });
        await adminDb.activityLog.deleteMany({ where: { groupId: { in: groupIds } } });
        await adminDb.aIConversation.deleteMany({
          where: {
            OR: [
              { groupId: { in: groupIds } },
              { subject: { groupId: { in: groupIds } } },
              { chapter: { subject: { groupId: { in: groupIds } } } },
              { topic: { chapter: { subject: { groupId: { in: groupIds } } } } },
            ],
          },
        });
        await adminDb.groupInvitation.deleteMany({ where: { groupId: { in: groupIds } } });
        await adminDb.processingJob.deleteMany({
          where: { material: { groupId: { in: groupIds } } },
        });
        await adminDb.material.deleteMany({ where: { groupId: { in: groupIds } } });
        await adminDb.noteChunk.deleteMany({
          where: { note: { topic: { chapter: { subject: { groupId: { in: groupIds } } } } } },
        });
        await adminDb.noteVersion.deleteMany({
          where: { note: { topic: { chapter: { subject: { groupId: { in: groupIds } } } } } },
        });
        await adminDb.noteBlock.deleteMany({
          where: { note: { topic: { chapter: { subject: { groupId: { in: groupIds } } } } } },
        });
        await adminDb.note.deleteMany({
          where: { topic: { chapter: { subject: { groupId: { in: groupIds } } } } },
        });
        await adminDb.topic.deleteMany({
          where: { chapter: { subject: { groupId: { in: groupIds } } } },
        });
        await adminDb.chapter.deleteMany({
          where: { subject: { groupId: { in: groupIds } } },
        });
        await adminDb.subject.deleteMany({ where: { groupId: { in: groupIds } } });
        await adminDb.groupMember.deleteMany({ where: { groupId: { in: groupIds } } });
        await adminDb.group.deleteMany({ where: { id: { in: groupIds } } });
      }

      await adminDb.workspaceMember.deleteMany({ where: { userId: { in: userIds } } });
      await adminDb.workspace.deleteMany({ where: { ownerId: { in: userIds } } });
      await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    }

    async function createFixtureGroup(suffix: string) {
      const group = await adminDb.group.create({
        data: {
          name: `LIM01 Group ${suffix}`,
          owner: { connect: { id: ownerId } },
          members: {
            create: [
              { userId: ownerId, role: "OWNER" },
              { userId: adminId, role: "ADMIN" },
            ],
          },
        },
      });
      return group;
    }

    beforeAll(async () => {
      const verifiedUrl = assertIsolatedTestDatabaseConfig();
      adminDb = new PrismaClient({ datasources: { db: { url: verifiedUrl } } });
      await verifyLiveIsolatedDatabaseIdentity(adminDb, verifiedUrl);

      await cleanupLim01Fixtures();

      const owner = await adminDb.user.create({
        data: { email: `${RUN_ID}_owner@zenote.test`, name: "LIM01 Owner" },
      });
      const admin = await adminDb.user.create({
        data: { email: `${RUN_ID}_admin@zenote.test`, name: "LIM01 Admin" },
      });
      ownerId = owner.id;
      adminId = admin.id;

      bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenote-lim01-"));
      workerBundlePath = path.join(bundleDir, "lim01-worker.cjs");
      await build({
        entryPoints: [path.resolve(__dirname, "group-deletion-pg-worker.ts")],
        outfile: workerBundlePath,
        bundle: true,
        platform: "node",
        target: "node22",
        format: "cjs",
        packages: "external",
        tsconfig: path.resolve(process.cwd(), "tsconfig.json"),
      });
    });

    afterAll(async () => {
      await cleanupLim01Fixtures().catch(() => undefined);
      await adminDb?.$disconnect().catch(() => undefined);
      if (bundleDir) {
        fs.rmSync(bundleDir, { recursive: true, force: true });
      }
    });

    it("1. Ordering A (Multi-Process): DELETE holds FOR UPDATE; competing FOR SHARE Subject creation blocks in pg_locks then aborts with zero orphan rows", async () => {
      const group = await createFixtureGroup("order_a");
      const existingSubject = await adminDb.subject.create({
        data: { name: "Existing Group Subject", groupId: group.id, workspaceId: null },
      });

      const appA = `${RUN_ID}_proc_a_del`;
      const appB = `${RUN_ID}_proc_b_create`;

      const procA = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_for_update_then_delete",
        databaseUrl: isolatedUrl!,
        applicationName: appA,
        groupId: group.id,
        userId: ownerId,
      });

      let procB: SpawnedWorkerHandle | null = null;
      try {
        await procA.waitForLockAcquired();

        procB = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_create_subject",
          databaseUrl: isolatedUrl!,
          applicationName: appB,
          groupId: group.id,
          userId: adminId,
          subjectName: "Should Not Be Created",
        });

        // Deterministic proof via PostgreSQL pg_locks that Process B actually blocked on Process A's lock
        const blockedInfo = await waitForBlockedApplicationInPgLocks(adminDb, appB);
        expect(blockedInfo.appName).toBe(appB);

        // Allow Process A to finish deleting and committing
        procA.sendGo();
        const [doneA, doneB] = await Promise.all([procA.waitForDone(), procB.waitForDone()]);

        expect(doneA.outcome).toBe("deleted");
        expect(doneB.outcome).toBe("rejected_deleted");

        // Final database invariants: deleted group has 0 active children
        const refreshedGroup = await adminDb.group.findUnique({ where: { id: group.id } });
        expect(refreshedGroup?.deletedAt).not.toBeNull();

        const allSubjects = await adminDb.subject.findMany({ where: { groupId: group.id } });
        expect(allSubjects).toHaveLength(1);
        expect(allSubjects[0]?.id).toBe(existingSubject.id);
        expect(allSubjects[0]?.deletedAt).not.toBeNull();
      } finally {
        procA.kill();
        procB?.kill();
      }
    });

    it("2. Ordering B (Multi-Process): Subject creation holds FOR SHARE; DELETE blocks on FOR UPDATE until CREATE commits then cascades new Subject too", async () => {
      const group = await createFixtureGroup("order_b");
      const appA = `${RUN_ID}_proc_a_share`;
      const appB = `${RUN_ID}_proc_b_del`;

      const procA = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_for_share_then_create_subject",
        databaseUrl: isolatedUrl!,
        applicationName: appA,
        groupId: group.id,
        userId: adminId,
        subjectName: "Committed Before Delete",
      });

      let procB: SpawnedWorkerHandle | null = null;
      try {
        await procA.waitForLockAcquired();

        procB = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_delete_group",
          databaseUrl: isolatedUrl!,
          applicationName: appB,
          groupId: group.id,
          userId: ownerId,
        });

        const blockedInfo = await waitForBlockedApplicationInPgLocks(adminDb, appB);
        expect(blockedInfo.appName).toBe(appB);

        procA.sendGo();
        const [doneA, doneB] = await Promise.all([procA.waitForDone(), procB.waitForDone()]);

        expect(doneA.outcome).toBe("created");
        expect(doneB.outcome).toBe("deleted");

        // READ COMMITTED visibility invariant: newly created Subject was soft-deleted by unblocked DELETE
        const createdSubject = await adminDb.subject.findUnique({
          where: { id: String(doneA.subjectId) },
        });
        expect(createdSubject).not.toBeNull();
        expect(createdSubject?.deletedAt).not.toBeNull();

        const activeChildrenCount = await adminDb.subject.count({
          where: { groupId: group.id, deletedAt: null },
        });
        expect(activeChildrenCount).toBe(0);
      } finally {
        procA.kill();
        procB?.kill();
      }
    });

    it("3. Concurrent Double-Delete (Multi-Process): exactly 1 deletes group with 1 GROUP_DELETED log, second observes not_found cleanly", async () => {
      const group = await createFixtureGroup("double_delete");
      const appA = `${RUN_ID}_del_1`;
      const appB = `${RUN_ID}_del_2`;

      const procA = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_for_update_then_delete",
        databaseUrl: isolatedUrl!,
        applicationName: appA,
        groupId: group.id,
        userId: ownerId,
      });

      let procB: SpawnedWorkerHandle | null = null;
      try {
        await procA.waitForLockAcquired();

        procB = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_delete_group",
          databaseUrl: isolatedUrl!,
          applicationName: appB,
          groupId: group.id,
          userId: ownerId,
        });

        await waitForBlockedApplicationInPgLocks(adminDb, appB);
        procA.sendGo();

        const [doneA, doneB] = await Promise.all([procA.waitForDone(), procB.waitForDone()]);
        expect(doneA.outcome).toBe("deleted");
        expect(doneB.outcome).toBe("not_found");

        const logs = await adminDb.activityLog.findMany({
          where: { groupId: group.id, action: "group.deleted" },
        });
        expect(logs).toHaveLength(1);
      } finally {
        procA.kill();
        procB?.kill();
      }
    });

    it("4. Transaction Failure & Rollback (Multi-Process): failed DELETE rolls back all partial updates and unblocks CREATE to succeed cleanly", async () => {
      const group = await createFixtureGroup("rollback");
      const existingSubject = await adminDb.subject.create({
        data: { name: "Survives Rollback", groupId: group.id, workspaceId: null },
      });

      const appA = `${RUN_ID}_del_rollback`;
      const appB = `${RUN_ID}_create_after_rollback`;

      const procA = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_for_update_then_rollback",
        databaseUrl: isolatedUrl!,
        applicationName: appA,
        groupId: group.id,
        userId: ownerId,
      });

      let procB: SpawnedWorkerHandle | null = null;
      try {
        await procA.waitForLockAcquired();

        procB = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_create_subject",
          databaseUrl: isolatedUrl!,
          applicationName: appB,
          groupId: group.id,
          userId: adminId,
          subjectName: "Created After Rollback",
        });

        await waitForBlockedApplicationInPgLocks(adminDb, appB);
        procA.sendGo();

        const [doneA, doneB] = await Promise.all([procA.waitForDone(), procB.waitForDone()]);
        expect(doneA.outcome).toBe("rolled_back");
        expect(doneB.outcome).toBe("created");

        const refreshedGroup = await adminDb.group.findUnique({ where: { id: group.id } });
        expect(refreshedGroup?.deletedAt).toBeNull();

        const activeSubjects = await adminDb.subject.findMany({
          where: { groupId: group.id, deletedAt: null },
        });
        expect(activeSubjects.map((s) => s.id)).toContain(existingSubject.id);
        expect(activeSubjects).toHaveLength(2);
      } finally {
        procA.kill();
        procB?.kill();
      }
    });

    it("5. Direct HTTP route handlers cascade nested Subject/Chapter/Topic/AIConversation/Invitation cleanup cleanly against live PostgreSQL", async () => {
      const group = await createFixtureGroup("route_cascade");

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: adminId, name: "LIM01 Admin", email: `${RUN_ID}_admin@zenote.test` },
      } as never);

      const subjRes = await createSubjectRoute(
        new Request("https://example.test/api/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Live Route Subject", groupId: group.id }),
        })
      );
      expect(subjRes.status).toBe(201);
      const { subject } = (await subjRes.json()) as { subject: { id: string } };

      const chapRes = await createChapterRoute(
        new Request(`https://example.test/api/subjects/${subject.id}/chapters`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Live Route Chapter" }),
        }),
        { params: { subjectId: subject.id } }
      );
      expect(chapRes.status).toBe(201);
      const { chapter } = (await chapRes.json()) as { chapter: { id: string } };

      const topicRes = await createTopicRoute(
        new Request(`https://example.test/api/chapters/${chapter.id}/topics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Live Route Topic" }),
        }),
        { params: { chapterId: chapter.id } }
      );
      expect(topicRes.status).toBe(201);
      const { topic } = (await topicRes.json()) as { topic: { id: string } };

      const convRes = await createConversationRoute(
        new Request("https://example.test/api/ai/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId: topic.id }),
        })
      );
      expect(convRes.status).toBe(201);
      const { conversation } = (await convRes.json()) as { conversation: { id: string } };

      const invRes = await createInvitationRoute(
        new Request(`https://example.test/api/groups/${group.id}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: `${RUN_ID}_invitee@zenote.test`, role: "MEMBER" }),
        }),
        { params: { groupId: group.id } }
      );
      expect(invRes.status).toBe(201);

      // Concurrent delete via real DELETE route handler as OWNER
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: ownerId, name: "LIM01 Owner", email: `${RUN_ID}_owner@zenote.test` },
      } as never);

      const [del1, del2] = await Promise.all([
        deleteGroupRoute(new Request(`https://example.test/api/groups/${group.id}`, { method: "DELETE" }), {
          params: { groupId: group.id },
        }),
        deleteGroupRoute(new Request(`https://example.test/api/groups/${group.id}`, { method: "DELETE" }), {
          params: { groupId: group.id },
        }),
      ]);

      const statuses = [del1.status, del2.status].sort();
      expect(statuses).toEqual([200, 404]);

      const [gRow, sRow, cRow, tRow, convRow, invRows, logs] = await Promise.all([
        adminDb.group.findUnique({ where: { id: group.id } }),
        adminDb.subject.findUnique({ where: { id: subject.id } }),
        adminDb.chapter.findUnique({ where: { id: chapter.id } }),
        adminDb.topic.findUnique({ where: { id: topic.id } }),
        adminDb.aIConversation.findUnique({ where: { id: conversation.id } }),
        adminDb.groupInvitation.findMany({ where: { groupId: group.id } }),
        adminDb.activityLog.findMany({ where: { groupId: group.id, action: "group.deleted" } }),
      ]);

      expect(gRow?.deletedAt).not.toBeNull();
      expect(sRow?.deletedAt).not.toBeNull();
      expect(cRow?.deletedAt).not.toBeNull();
      expect(tRow?.deletedAt).not.toBeNull();
      expect(convRow?.deletedAt).not.toBeNull();
      expect(invRows).toHaveLength(1);
      expect(invRows[0]?.status).toBe("CANCELLED");
      expect(logs).toHaveLength(1);
    });

    it("6. Bidirectional Admin A <-> Admin B member mutations serialize in canonical ascending userId order with zero 40P01 deadlocks", async () => {
      const group = await adminDb.group.create({
        data: {
          name: "LIM01 Bidirectional Admins",
          owner: { connect: { id: ownerId } },
          members: {
            create: [{ userId: ownerId, role: "OWNER" }],
          },
        },
      });
      const userAlpha = await adminDb.user.create({
        data: { email: `${RUN_ID}_alpha@zenote.test`, name: "Alpha Admin" },
      });
      const userBeta = await adminDb.user.create({
        data: { email: `${RUN_ID}_beta@zenote.test`, name: "Beta Admin" },
      });
      const [firstId, secondId] = [userAlpha.id, userBeta.id].sort();
      await adminDb.groupMember.createMany({
        data: [
          { groupId: group.id, userId: firstId!, role: "ADMIN" },
          { groupId: group.id, userId: secondId!, role: "ADMIN" },
        ],
      });

      const procFirst = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_member_update_then_demote",
        databaseUrl: isolatedUrl!,
        applicationName: `${RUN_ID}_adm_first`,
        groupId: group.id,
        userId: firstId!,
        targetUserId: secondId!,
        newRole: "MEMBER",
      });

      let procSecond: SpawnedWorkerHandle | null = null;
      try {
        await procFirst.waitForLockAcquired();

        // Contending worker goes in opposite actor -> target direction; canonical sort guarantees no deadlock
        procSecond = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_member_demote",
          databaseUrl: isolatedUrl!,
          applicationName: `${RUN_ID}_adm_second`,
          groupId: group.id,
          userId: secondId!,
          targetUserId: firstId!,
          newRole: "MEMBER",
        });

        await waitForBlockedApplicationInPgLocks(adminDb, `${RUN_ID}_adm_second`);
        procFirst.sendGo();

        const [doneFirst, doneSecond] = await Promise.all([
          procFirst.waitForDone(),
          procSecond.waitForDone(),
        ]);
        expect(doneFirst.outcome).toBe("updated");
        expect(doneSecond.outcome).toBe("forbidden");

        const [mFirst, mSecond] = await Promise.all([
          adminDb.groupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId: firstId! } } }),
          adminDb.groupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId: secondId! } } }),
        ]);
        expect(mFirst?.role).toBe("ADMIN");
        expect(mSecond?.role).toBe("MEMBER");
      } finally {
        procFirst.kill();
        procSecond?.kill();
      }
    });

    it("7. Invitation Cancel vs Accept serializes under Group FOR SHARE -> GroupInvitation FOR UPDATE with no double transition", async () => {
      const group = await createFixtureGroup("inv_race");
      const invitee = await adminDb.user.create({
        data: { email: `${RUN_ID}_inv_race@zenote.test`, name: "Invitee" },
      });
      const token = `${RUN_ID}_tok_1`;
      await adminDb.groupInvitation.create({
        data: {
          groupId: group.id,
          email: invitee.email,
          role: "MEMBER",
          status: "PENDING",
          token,
          invitedBy: ownerId,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const procCancel = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_invitation_cancel",
        databaseUrl: isolatedUrl!,
        applicationName: `${RUN_ID}_inv_cancel`,
        groupId: group.id,
        userId: ownerId,
        invitationToken: token,
      });

      let procAccept: SpawnedWorkerHandle | null = null;
      try {
        await procCancel.waitForLockAcquired();

        procAccept = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_invitation_accept",
          databaseUrl: isolatedUrl!,
          applicationName: `${RUN_ID}_inv_accept`,
          groupId: group.id,
          userId: invitee.id,
          invitationToken: token,
        });

        await waitForBlockedApplicationInPgLocks(adminDb, `${RUN_ID}_inv_accept`);
        procCancel.sendGo();

        const [doneCancel, doneAccept] = await Promise.all([
          procCancel.waitForDone(),
          procAccept.waitForDone(),
        ]);
        expect(doneCancel.outcome).toBe("cancelled");
        expect(doneAccept.outcome).toBe("conflict");

        const membership = await adminDb.groupMember.findUnique({
          where: { groupId_userId: { groupId: group.id, userId: invitee.id } },
        });
        expect(membership).toBeNull();
      } finally {
        procCancel.kill();
        procAccept?.kill();
      }
    });

    it("8. Material Delete vs Active ProcessingJob completion + Note Chunk Sync vs Group Delete never leave READY/chunk orphans", async () => {
      const group = await createFixtureGroup("mat_note_race");
      const subject = await adminDb.subject.create({
        data: { name: "Race Subj", groupId: group.id, workspaceId: null },
      });
      const chapter = await adminDb.chapter.create({
        data: { name: "Race Chap", subjectId: subject.id, order: 0 },
      });
      const topic = await adminDb.topic.create({
        data: { name: "Race Topic", chapterId: chapter.id, order: 0 },
      });
      const note = await adminDb.note.create({
        data: {
          title: "Race Note",
          plainText: "Race Note",
          topicId: topic.id,
          authorId: ownerId,
        },
      });
      const material = await adminDb.material.create({
        data: {
          ownerId,
          groupId: group.id,
          subjectId: subject.id,
          chapterId: chapter.id,
          topicId: topic.id,
          type: "PDF",
          title: "Race PDF",
          status: "PROCESSING",
        },
      });
      const job = await adminDb.processingJob.create({
        data: {
          userId: ownerId,
          materialId: material.id,
          type: "DOCUMENT_EXTRACTION",
          status: "RUNNING",
          startedAt: new Date(),
        },
      });

      const procMatDel = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_material_delete_cancel_jobs",
        databaseUrl: isolatedUrl!,
        applicationName: `${RUN_ID}_mat_del`,
        groupId: group.id,
        userId: ownerId,
        materialId: material.id,
      });

      let procJobComplete: SpawnedWorkerHandle | null = null;
      try {
        await procMatDel.waitForLockAcquired();

        procJobComplete = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_complete_job",
          databaseUrl: isolatedUrl!,
          applicationName: `${RUN_ID}_job_complete`,
          groupId: group.id,
          userId: ownerId,
          materialId: material.id,
          jobId: job.id,
        });

        await waitForBlockedApplicationInPgLocks(adminDb, `${RUN_ID}_job_complete`);
        procMatDel.sendGo();

        const [doneDel, doneJob] = await Promise.all([
          procMatDel.waitForDone(),
          procJobComplete.waitForDone(),
        ]);
        expect(doneDel.outcome).toBe("deleted");
        expect(doneJob.outcome).toBe("aborted_deleted");

        const [refreshedMat, refreshedJob] = await Promise.all([
          adminDb.material.findUnique({ where: { id: material.id } }),
          adminDb.processingJob.findUnique({ where: { id: job.id } }),
        ]);
        expect(refreshedMat?.deletedAt).not.toBeNull();
        expect(refreshedJob?.status).toBe("CANCELLED");
      } finally {
        procMatDel.kill();
        procJobComplete?.kill();
      }

      // Now verify group deletion vs note chunk sync serialization
      const procGrpDel = spawnWorkerProcess(workerBundlePath, {
        mode: "hold_for_update_then_delete",
        databaseUrl: isolatedUrl!,
        applicationName: `${RUN_ID}_grp_del_chunk`,
        groupId: group.id,
        userId: ownerId,
      });
      let procChunkSync: SpawnedWorkerHandle | null = null;
      try {
        await procGrpDel.waitForLockAcquired();

        procChunkSync = spawnWorkerProcess(workerBundlePath, {
          mode: "contend_sync_note_chunk",
          databaseUrl: isolatedUrl!,
          applicationName: `${RUN_ID}_chunk_sync`,
          groupId: group.id,
          userId: ownerId,
          noteId: note.id,
        });

        await waitForBlockedApplicationInPgLocks(adminDb, `${RUN_ID}_chunk_sync`);
        procGrpDel.sendGo();

        const [doneGrp, doneChunk] = await Promise.all([
          procGrpDel.waitForDone(),
          procChunkSync.waitForDone(),
        ]);
        expect(doneGrp.outcome).toBe("deleted");
        expect(doneChunk.outcome).toBe("aborted_group_deleted");
        expect(await adminDb.noteChunk.count({ where: { noteId: note.id } })).toBe(0);
      } finally {
        procGrpDel.kill();
        procChunkSync?.kill();
      }
    });
  }
);
