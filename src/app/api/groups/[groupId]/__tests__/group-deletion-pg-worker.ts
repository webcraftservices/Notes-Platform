import { PrismaClient, type MemberRole, type Prisma } from "@prisma/client";
import {
  lockGroupForUpdate,
  lockGroupForShare,
  lockGroupMembersForUpdate,
  lockGroupInvitationForUpdate,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { completeJobWithin } from "@/lib/processing-jobs";
import { canChangeMemberRole } from "@/lib/group-role";
import {
  isIsolatedNonSharedDbUrl,
  verifyLiveIsolatedDatabaseIdentity,
} from "@/lib/testing/isolated-db-guard";

type WorkerMode =
  | "hold_for_update_then_delete"
  | "hold_for_update_then_rollback"
  | "hold_for_share_then_create_subject"
  | "contend_create_subject"
  | "contend_delete_group"
  | "hold_member_update_then_demote"
  | "contend_member_demote"
  | "hold_invitation_cancel"
  | "contend_invitation_accept"
  | "hold_material_delete_cancel_jobs"
  | "contend_complete_job"
  | "contend_sync_note_chunk";

interface WorkerConfig {
  mode: WorkerMode;
  databaseUrl: string;
  applicationName: string;
  groupId: string;
  userId: string;
  targetUserId?: string;
  newRole?: MemberRole;
  invitationToken?: string;
  materialId?: string;
  jobId?: string;
  noteId?: string;
  subjectName?: string;
}

function appendApplicationName(rawUrl: string, appName: string): string {
  const u = new URL(rawUrl);
  u.searchParams.set("application_name", appName);
  return u.toString();
}

/**
 * Parameterized, transaction-local application_name configuration.
 * Uses PostgreSQL set_config($1, $2, true) (equivalent to SET LOCAL) so
 * the setting is strictly bounded to the transaction and updates pg_stat_activity
 * without persistent pool connection pollution or raw string interpolation.
 */
async function setTxApplicationName(tx: Prisma.TransactionClient, appName: string) {
  await tx.$executeRaw`SELECT set_config('application_name', ${appName}, true)`;
}

function sendIpc(msg: Record<string, unknown>) {
  if (typeof process.send === "function") {
    process.send(msg);
  }
}

function waitForGo(): Promise<void> {
  return new Promise((resolve) => {
    const onMsg = (msg: unknown) => {
      if (msg && typeof msg === "object" && (msg as { type?: string }).type === "GO") {
        process.off("message", onMsg);
        resolve();
      }
    };
    process.on("message", onMsg);
  });
}

async function main() {
  const cfg = JSON.parse(process.env.LIM01_WORKER_CONFIG || "{}") as WorkerConfig;
  if (!cfg.databaseUrl || !cfg.groupId || !cfg.userId) {
    throw new Error("Missing LIM01_WORKER_CONFIG");
  }

  if (!isIsolatedNonSharedDbUrl(cfg.databaseUrl)) {
    throw new Error("Refusing non-isolated worker database URL");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: appendApplicationName(cfg.databaseUrl, cfg.applicationName) } },
  });

  try {
    await verifyLiveIsolatedDatabaseIdentity(prisma, cfg.databaseUrl);

    if (cfg.mode === "hold_for_update_then_delete") {
      const goPromise = waitForGo();
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        const locked = await lockGroupForUpdate(tx, cfg.groupId);
        sendIpc({ type: "LOCK_ACQUIRED", mode: cfg.mode, locked });
        await goPromise;

        if (!locked || locked.deletedAt !== null) {
          return { outcome: "not_found" };
        }

        const now = new Date();
        const { count } = await tx.group.updateMany({
          where: { id: cfg.groupId, deletedAt: null },
          data: { deletedAt: now },
        });
        if (count === 0) return { outcome: "not_found" };

        await tx.subject.updateMany({
          where: { groupId: cfg.groupId, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.chapter.updateMany({
          where: { subject: { groupId: cfg.groupId }, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.topic.updateMany({
          where: { chapter: { subject: { groupId: cfg.groupId } }, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.note.updateMany({
          where: { topic: { chapter: { subject: { groupId: cfg.groupId } } }, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.material.updateMany({
          where: { groupId: cfg.groupId, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.aIConversation.updateMany({
          where: {
            deletedAt: null,
            OR: [
              { groupId: cfg.groupId },
              { subject: { groupId: cfg.groupId } },
              { chapter: { subject: { groupId: cfg.groupId } } },
              { topic: { chapter: { subject: { groupId: cfg.groupId } } } },
            ],
          },
          data: { deletedAt: now },
        });
        await tx.groupInvitation.updateMany({
          where: { groupId: cfg.groupId, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        await tx.activityLog.create({
          data: {
            groupId: cfg.groupId,
            userId: cfg.userId,
            action: "group.deleted",
            targetType: "group",
            targetId: cfg.groupId,
            metadata: { source: cfg.applicationName },
          },
        });
        return { outcome: "deleted" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "hold_for_update_then_rollback") {
      const goPromise = waitForGo();
      let rolledBack = false;
      try {
        await prisma.$transaction(async (tx) => {
          await setTxApplicationName(tx, cfg.applicationName);
          const locked = await lockGroupForUpdate(tx, cfg.groupId);
          await tx.subject.updateMany({
            where: { groupId: cfg.groupId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          await tx.group.updateMany({
            where: { id: cfg.groupId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          sendIpc({ type: "LOCK_ACQUIRED", mode: cfg.mode, locked });
          await goPromise;
          throw new Error("INTENTIONAL_ROLLBACK_TEST");
        });
      } catch (err) {
        if (err instanceof Error && err.message === "INTENTIONAL_ROLLBACK_TEST") {
          rolledBack = true;
        } else {
          throw err;
        }
      }
      sendIpc({ type: "DONE", outcome: rolledBack ? "rolled_back" : "unexpected" });
      return;
    }

    if (cfg.mode === "hold_for_share_then_create_subject") {
      const goPromise = waitForGo();
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        await assertActiveGroupMemberForCreation(tx, cfg.groupId, cfg.userId, ["ADMIN", "OWNER"]);
        sendIpc({ type: "LOCK_ACQUIRED", mode: cfg.mode });
        await goPromise;

        const created = await tx.subject.create({
          data: {
            name: cfg.subjectName || "Concurrent Share Subject",
            groupId: cfg.groupId,
            workspaceId: null,
          },
        });
        return { outcome: "created", subjectId: created.id };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "contend_create_subject") {
      try {
        const result = await prisma.$transaction(async (tx) => {
          await setTxApplicationName(tx, cfg.applicationName);
          await assertActiveGroupMemberForCreation(tx, cfg.groupId, cfg.userId, ["ADMIN", "OWNER"]);
          const created = await tx.subject.create({
            data: {
              name: cfg.subjectName || "Contending Subject",
              groupId: cfg.groupId,
              workspaceId: null,
            },
          });
          return { outcome: "created", subjectId: created.id };
        });
        sendIpc({ type: "DONE", ...result });
      } catch (err) {
        if (err instanceof NotAuthorizedError) {
          sendIpc({ type: "DONE", outcome: "rejected_deleted" });
          return;
        }
        throw err;
      }
      return;
    }

    if (cfg.mode === "contend_delete_group") {
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        const locked = await lockGroupForUpdate(tx, cfg.groupId);
        if (!locked || locked.deletedAt !== null) {
          return { outcome: "not_found" };
        }
        const now = new Date();
        const { count } = await tx.group.updateMany({
          where: { id: cfg.groupId, deletedAt: null },
          data: { deletedAt: now },
        });
        if (count === 0) return { outcome: "not_found" };

        await tx.subject.updateMany({
          where: { groupId: cfg.groupId, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.activityLog.create({
          data: {
            groupId: cfg.groupId,
            userId: cfg.userId,
            action: "group.deleted",
            targetType: "group",
            targetId: cfg.groupId,
            metadata: { source: cfg.applicationName },
          },
        });
        return { outcome: "deleted" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "hold_member_update_then_demote") {
      if (!cfg.targetUserId) throw new Error("Missing targetUserId");
      const goPromise = waitForGo();
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        const lockedGroup = await lockGroupForShare(tx, cfg.groupId);
        if (!lockedGroup || lockedGroup.deletedAt !== null) {
          return { outcome: "group_deleted" };
        }
        const lockedMembers = await lockGroupMembersForUpdate(tx, cfg.groupId, [
          cfg.userId,
          cfg.targetUserId!,
        ]);
        sendIpc({ type: "LOCK_ACQUIRED", mode: cfg.mode });
        await goPromise;

        const actor = lockedMembers.find((m) => m.userId === cfg.userId);
        const target = lockedMembers.find((m) => m.userId === cfg.targetUserId);
        const nextRole: MemberRole = cfg.newRole ?? "MEMBER";
        if (!actor || !target || !canChangeMemberRole(actor.role, target.role, nextRole)) {
          return { outcome: "forbidden" };
        }
        await tx.groupMember.update({
          where: { groupId_userId: { groupId: cfg.groupId, userId: cfg.targetUserId! } },
          data: { role: nextRole },
        });
        return { outcome: "updated", newRole: nextRole };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "contend_member_demote") {
      if (!cfg.targetUserId) throw new Error("Missing targetUserId");
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        const lockedGroup = await lockGroupForShare(tx, cfg.groupId);
        if (!lockedGroup || lockedGroup.deletedAt !== null) {
          return { outcome: "group_deleted" };
        }
        const lockedMembers = await lockGroupMembersForUpdate(tx, cfg.groupId, [
          cfg.userId,
          cfg.targetUserId!,
        ]);
        const actor = lockedMembers.find((m) => m.userId === cfg.userId);
        const target = lockedMembers.find((m) => m.userId === cfg.targetUserId);
        const nextRole: MemberRole = cfg.newRole ?? "MEMBER";
        if (!actor || !target || !canChangeMemberRole(actor.role, target.role, nextRole)) {
          return { outcome: "forbidden" };
        }
        await tx.groupMember.update({
          where: { groupId_userId: { groupId: cfg.groupId, userId: cfg.targetUserId! } },
          data: { role: nextRole },
        });
        return { outcome: "updated", newRole: nextRole };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "hold_invitation_cancel") {
      if (!cfg.invitationToken) throw new Error("Missing invitationToken");
      const goPromise = waitForGo();
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        await assertActiveGroupMemberForCreation(tx, cfg.groupId, cfg.userId, ["ADMIN", "OWNER"]);
        const inv = await lockGroupInvitationForUpdate(tx, { token: cfg.invitationToken! });
        sendIpc({ type: "LOCK_ACQUIRED", mode: cfg.mode });
        await goPromise;

        if (!inv || inv.status !== "PENDING") {
          return { outcome: "conflict" };
        }
        await tx.groupInvitation.update({
          where: { id: inv.id },
          data: { status: "CANCELLED" },
        });
        return { outcome: "cancelled" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "contend_invitation_accept") {
      if (!cfg.invitationToken) throw new Error("Missing invitationToken");
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        const lockedGroup = await lockGroupForShare(tx, cfg.groupId);
        if (!lockedGroup || lockedGroup.deletedAt !== null) {
          return { outcome: "group_deleted" };
        }
        const inv = await lockGroupInvitationForUpdate(tx, { token: cfg.invitationToken! });
        if (!inv || inv.status !== "PENDING") {
          return { outcome: "conflict" };
        }
        await tx.groupInvitation.updateMany({
          where: { token: cfg.invitationToken!, status: "PENDING" },
          data: { status: "ACCEPTED" },
        });
        await tx.groupMember.create({
          data: { groupId: cfg.groupId, userId: cfg.userId, role: inv.role },
        });
        return { outcome: "accepted" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "hold_material_delete_cancel_jobs") {
      if (!cfg.materialId) throw new Error("Missing materialId");
      const goPromise = waitForGo();
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        await assertActiveGroupMemberForCreation(tx, cfg.groupId, cfg.userId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:DOCUMENT_EXTRACTION:${cfg.materialId}`}, 0))`;
        sendIpc({ type: "LOCK_ACQUIRED", mode: cfg.mode });
        await goPromise;

        const now = new Date();
        await tx.material.update({
          where: { id: cfg.materialId! },
          data: { deletedAt: now },
        });
        await tx.processingJob.updateMany({
          where: { materialId: cfg.materialId!, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status: "CANCELLED", completedAt: now },
        });
        return { outcome: "deleted" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "contend_complete_job") {
      if (!cfg.materialId || !cfg.jobId) throw new Error("Missing materialId or jobId");
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:DOCUMENT_EXTRACTION:${cfg.materialId}`}, 0))`;
        const completed = await completeJobWithin(tx, cfg.jobId!, cfg.materialId!);
        if (!completed) {
          return { outcome: "aborted_deleted" };
        }
        await tx.material.update({
          where: { id: cfg.materialId! },
          data: { status: "READY", extractedText: "should not overwrite deleted" },
        });
        return { outcome: "completed" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }

    if (cfg.mode === "contend_sync_note_chunk") {
      if (!cfg.noteId) throw new Error("Missing noteId");
      const result = await prisma.$transaction(async (tx) => {
        await setTxApplicationName(tx, cfg.applicationName);
        const lockedGroup = await lockGroupForShare(tx, cfg.groupId);
        if (!lockedGroup || lockedGroup.deletedAt !== null) {
          return { outcome: "aborted_group_deleted" };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note_chunks:${cfg.noteId}`}, 0))`;
        const freshNote = await tx.note.findUnique({
          where: { id: cfg.noteId! },
          select: {
            deletedAt: true,
            topic: {
              select: {
                deletedAt: true,
                chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
              },
            },
          },
        });
        if (
          !freshNote ||
          freshNote.deletedAt !== null ||
          freshNote.topic?.deletedAt !== null ||
          freshNote.topic?.chapter?.deletedAt !== null ||
          freshNote.topic?.chapter?.subject?.deletedAt !== null
        ) {
          await tx.noteChunk.deleteMany({ where: { noteId: cfg.noteId! } });
          return { outcome: "aborted_note_deleted" };
        }
        await tx.noteChunk.create({
          data: {
            noteId: cfg.noteId!,
            order: 0,
            content: "Concurrent chunk",
          },
        });
        return { outcome: "synced" };
      });
      sendIpc({ type: "DONE", ...result });
      return;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  sendIpc({
    type: "ERROR",
    message: err instanceof Error ? err.message : String(err),
    code: (err as { code?: string } | null)?.code ?? null,
  });
  process.exit(1);
});
