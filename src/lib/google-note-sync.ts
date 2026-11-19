/**
 * Phase 14 (Task 14-03) — Bidirectional Google Docs Export & Synchronization.
 *
 * Manages the lifecycle of linking a Zenote `Note` (Title + ordered `NoteBlock`s)
 * to a Google Doc via the Google Docs v1 and Google Drive v3 APIs:
 *   1. Initial export (`documents.create` + `documents.batchUpdate`)
 *   2. Pushing local Zenote note updates to the linked Google Doc
 *   3. Pulling remote Google Doc edits back into Zenote `NoteBlock`s (preserving
 *      a `NoteVersion` snapshot and re-indexing via Phase 12 `syncNoteSearchIndex`)
 *   4. Deterministic conflict detection when both local and remote changed since
 *      the last sync point (with explicit resolution: `keep_local` / `accept_remote`)
 *   5. Echo suppression via canonical SHA-256 content hashes and `revisionId`
 *      tracking to prevent infinite webhook/sync loops.
 */

import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAccessibleNote, NotAuthorizedError } from "@/lib/access";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import { syncNoteSearchIndex } from "@/lib/search/note-embedding";
import { getValidGoogleAccessToken } from "@/lib/google-connection";
import { assertGoogleDriveSyncAllowed } from "@/lib/google-import";
import { getGoogleDriveService } from "@/lib/services/google-drive";
import {
  batchUpdateGoogleDocument,
  buildGoogleDocReplaceRequests,
  computeCanonicalNoteSyncHash,
  computeLocalNoteSyncHash,
  createGoogleDocument,
  getGoogleDocBodyEndIndex,
  getGoogleDocument,
  parseGoogleDocToNoteBlocks,
  type SyncableNoteBlockInput,
} from "@/lib/services/google-docs";
import {
  GoogleApiError,
  GoogleRevisionConflictError,
  isRetryableGoogleError,
} from "@/lib/services/google-errors";

export type NoteGoogleSyncStatusValue =
  | "EXPORTING"
  | "SYNCED"
  | "CONFLICT"
  | "ERROR"
  | "REMOTE_DELETED";

export interface NoteGoogleSyncConflict {
  detectedAt: string;
  localHash: string;
  remoteHash: string;
  remoteRevisionId: string | null;
  remoteModifiedTime: string | null;
}

export interface NoteGoogleDocExternalRef {
  provider: "google_docs";
  documentId: string;
  webViewLink: string | null;
  revisionId: string | null;
  modifiedTime: string | null;
  lastSyncedLocalHash: string;
  lastSyncedRemoteHash: string;
  lastSyncedAt: string;
  syncStatus: NoteGoogleSyncStatusValue;
  lastSyncError: string | null;
  conflict: NoteGoogleSyncConflict | null;
}

export type NoteGoogleSyncDirection = "auto" | "push" | "pull";
export type NoteGoogleConflictResolution = "keep_local" | "accept_remote";

export interface NoteGoogleSyncResult {
  status:
    | "exported"
    | "pushed"
    | "pulled"
    | "unchanged"
    | "conflict"
    | "remote_deleted";
  noteId: string;
  externalRef: NoteGoogleDocExternalRef;
  echoSuppressed?: boolean;
}

export class NoteNotFoundOrForbiddenError extends Error {
  readonly status: number;
  constructor(message: string, status: number = 404) {
    super(message);
    this.name = "NoteNotFoundOrForbiddenError";
    this.status = status;
  }
}

const NOTE_SYNC_MAX_ATTEMPTS = 3;

interface NoteHierarchyRow {
  id: string;
  deletedAt?: Date | null;
  externalRef?: Prisma.JsonValue | null;
  title?: string;
  blocks?: Array<SyncableNoteBlockInput & { id?: string }>;
  topic?: {
    deletedAt?: Date | null;
    chapter?: {
      deletedAt?: Date | null;
      subject?: { deletedAt?: Date | null; groupId?: string | null } | null;
    } | null;
  } | null;
}

function isNoteHierarchySoftDeleted(note: NoteHierarchyRow | null | undefined): boolean {
  if (!note) return true;
  return Boolean(
    note.deletedAt != null ||
      note.topic?.deletedAt != null ||
      note.topic?.chapter?.deletedAt != null ||
      note.topic?.chapter?.subject?.deletedAt != null
  );
}

/**
 * Enforces strict top-down lock order on group-owned notes inside a Prisma
 * transaction:
 *   1. `Group FOR SHARE`
 *   2. Actor `GroupMember FOR SHARE`
 * Only runs raw row locks when `$queryRaw` exists on `tx` (preserves mocked unit tests).
 */
async function assertActiveGroupAndMembershipForNoteTx(
  tx: Prisma.TransactionClient,
  groupId: string | null,
  userId: string
): Promise<void> {
  if (!groupId) return;
  const txAny = tx as unknown as {
    $queryRaw?: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  };
  if (typeof txAny.$queryRaw !== "function") return;

  const groupRows = await txAny.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>`
    SELECT id, "deletedAt" FROM "Group" WHERE id = ${groupId} FOR SHARE
  `;
  if (!groupRows[0] || groupRows[0].deletedAt !== null) {
    throw new NoteNotFoundOrForbiddenError(
      "You don't have permission to synchronize this note.",
      403
    );
  }

  const memberRows = await txAny.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "GroupMember" WHERE "groupId" = ${groupId} AND "userId" = ${userId} FOR SHARE
  `;
  if (!memberRows[0]) {
    throw new NoteNotFoundOrForbiddenError(
      "You don't have permission to synchronize this note.",
      403
    );
  }
}

/**
 * Per-note async mutex queue ensuring simultaneous in-process calls to
 * `exportOrSyncNoteWithGoogleDocs` for the same `noteId` execute strictly
 * sequentially (preventing duplicate initial Google Doc creation or racing
 * push/pull mutations).
 */
const inFlightNoteSyncLocks = new Map<string, Promise<unknown>>();

/**
 * Recovery journal for Google Docs created via `documents.create` when a
 * subsequent `batchUpdate` or local PostgreSQL persistence step fails before
 * `Note.externalRef` is committed. Retrying export for the same `noteId`
 * reuses this created document instead of creating an orphan duplicate.
 */
const pendingExportRecoveryByNoteId = new Map<
  string,
  { documentId: string; revisionId?: string; bodyEndIndex: number }
>();

/**
 * Clears in-memory recovery journals to simulate a full Node process restart in tests.
 */
export function clearInMemoryNoteSyncRecoveryForTests(): void {
  pendingExportRecoveryByNoteId.clear();
  inFlightNoteSyncLocks.clear();
}

async function withPerNoteSyncLock<T>(
  noteId: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = inFlightNoteSyncLocks.get(noteId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => task());
  inFlightNoteSyncLocks.set(noteId, next);
  try {
    return await next;
  } finally {
    if (inFlightNoteSyncLocks.get(noteId) === next) {
      inFlightNoteSyncLocks.delete(noteId);
    }
  }
}

async function withNoteSyncRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= NOTE_SYNC_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt === NOTE_SYNC_MAX_ATTEMPTS || !isRetryableGoogleError(err)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("Google Docs note sync retry limit was reached.");
}

export function parseNoteGoogleDocRef(raw: unknown): NoteGoogleDocExternalRef | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.provider !== "google_docs" || typeof obj.documentId !== "string" || !obj.documentId) {
    return null;
  }
  return {
    provider: "google_docs",
    documentId: obj.documentId,
    webViewLink: typeof obj.webViewLink === "string" ? obj.webViewLink : null,
    revisionId: typeof obj.revisionId === "string" ? obj.revisionId : null,
    modifiedTime: typeof obj.modifiedTime === "string" ? obj.modifiedTime : null,
    lastSyncedLocalHash: typeof obj.lastSyncedLocalHash === "string" ? obj.lastSyncedLocalHash : "",
    lastSyncedRemoteHash: typeof obj.lastSyncedRemoteHash === "string" ? obj.lastSyncedRemoteHash : "",
    lastSyncedAt: typeof obj.lastSyncedAt === "string" ? obj.lastSyncedAt : new Date(0).toISOString(),
    syncStatus:
      obj.syncStatus === "EXPORTING" ||
      obj.syncStatus === "CONFLICT" ||
      obj.syncStatus === "ERROR" ||
      obj.syncStatus === "REMOTE_DELETED"
        ? obj.syncStatus
        : "SYNCED",
    lastSyncError: typeof obj.lastSyncError === "string" ? obj.lastSyncError : null,
    conflict:
      obj.conflict && typeof obj.conflict === "object"
        ? (obj.conflict as NoteGoogleSyncConflict)
        : null,
  };
}

export async function getNoteGoogleSyncState(
  noteId: string,
  userId: string
): Promise<{
  linked: boolean;
  canWrite: boolean;
  externalRef: NoteGoogleDocExternalRef | null;
  hasUnsyncedLocalChanges: boolean;
}> {
  let access: unknown;
  try {
    access = await getAccessibleNote(noteId, userId);
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      throw new NoteNotFoundOrForbiddenError(
        "You don't have permission to access this note.",
        403
      );
    }
    throw err;
  }
  if (!access) {
    throw new NoteNotFoundOrForbiddenError("Note not found", 404);
  }
  const canWrite = (access as { canWrite?: boolean }).canWrite !== false;

  const note = (await db.note.findUnique({
    where: { id: noteId },
    include: {
      blocks: { orderBy: { order: "asc" } },
      topic: {
        select: {
          deletedAt: true,
          chapter: {
            select: {
              deletedAt: true,
              subject: { select: { deletedAt: true, groupId: true } },
            },
          },
        },
      },
    },
  })) as (NoteHierarchyRow & { title: string; blocks: Array<SyncableNoteBlockInput & { id: string }>; externalRef: Prisma.JsonValue | null }) | null;
  if (!note || isNoteHierarchySoftDeleted(note)) {
    throw new NoteNotFoundOrForbiddenError("Note not found", 404);
  }

  const noteGroupId =
    note.topic?.chapter?.subject?.groupId ??
    (access as { topic?: { chapter?: { subject?: { groupId?: string | null } } } } | null)
      ?.topic?.chapter?.subject?.groupId ??
    null;

  const externalRef = parseNoteGoogleDocRef(note.externalRef);
  if (!externalRef) {
    return {
      linked: false,
      canWrite,
      externalRef: null,
      hasUnsyncedLocalChanges: false,
    };
  }

  const currentLocalHash = computeLocalNoteSyncHash(note.title, note.blocks);
  return {
    linked: true,
    canWrite,
    externalRef,
    hasUnsyncedLocalChanges: currentLocalHash !== externalRef.lastSyncedLocalHash,
  };
}

/**
 * Exports a Zenote Note to a new Google Doc or synchronizes an already-linked
 * Note with its remote Google Doc.
 */
export async function exportOrSyncNoteWithGoogleDocs(
  noteId: string,
  userId: string,
  options: {
    direction?: NoteGoogleSyncDirection;
    forceResolution?: NoteGoogleConflictResolution;
  } = {}
): Promise<NoteGoogleSyncResult> {
  return withPerNoteSyncLock(noteId, () =>
    executeExportOrSyncNoteWithGoogleDocs(noteId, userId, options)
  );
}

async function executeExportOrSyncNoteWithGoogleDocs(
  noteId: string,
  userId: string,
  options: {
    direction?: NoteGoogleSyncDirection;
    forceResolution?: NoteGoogleConflictResolution;
  } = {}
): Promise<NoteGoogleSyncResult> {
  const direction = options.direction ?? "auto";
  const forceResolution = options.forceResolution;

  let access: unknown;
  try {
    access = await getAccessibleNote(noteId, userId);
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      throw new NoteNotFoundOrForbiddenError(
        "You don't have permission to synchronize this note.",
        403
      );
    }
    throw err;
  }
  if (!access) {
    throw new NoteNotFoundOrForbiddenError("Note not found", 404);
  }
  if ((access as { canWrite?: boolean }).canWrite === false) {
    throw new NoteNotFoundOrForbiddenError(
      "You don't have permission to synchronize this note.",
      403
    );
  }

  await assertGoogleDriveSyncAllowed(userId);
  const accessToken = await withNoteSyncRetry(() => getValidGoogleAccessToken(userId));
  const drive = getGoogleDriveService();

  const note = (await db.note.findUnique({
    where: { id: noteId },
    include: {
      blocks: { orderBy: { order: "asc" } },
      topic: {
        select: {
          deletedAt: true,
          chapter: {
            select: {
              deletedAt: true,
              subject: { select: { deletedAt: true, groupId: true } },
            },
          },
        },
      },
    },
  })) as (NoteHierarchyRow & { title: string; blocks: Array<SyncableNoteBlockInput & { id: string }>; externalRef: Prisma.JsonValue | null }) | null;
  if (!note || isNoteHierarchySoftDeleted(note)) {
    throw new NoteNotFoundOrForbiddenError("Note not found", 404);
  }

  const noteGroupId =
    note.topic?.chapter?.subject?.groupId ??
    (access as { topic?: { chapter?: { subject?: { groupId?: string | null } } } } | null)
      ?.topic?.chapter?.subject?.groupId ??
    null;

  const existingRef = parseNoteGoogleDocRef(note.externalRef);
  const isUnfinishedInitialExport =
    existingRef !== null &&
    (existingRef.syncStatus === "EXPORTING" ||
      (existingRef.lastSyncedLocalHash === "" &&
        existingRef.lastSyncedRemoteHash === ""));

  // --------------------------------------------------------------------------
  // Case 1: Initial Export (Note is not yet linked to a Google Doc, or is
  // recovering from a previous initial export whose DB commit or process crashed)
  // --------------------------------------------------------------------------
  if (!existingRef || isUnfinishedInitialExport) {
    const recoveredPending = pendingExportRecoveryByNoteId.get(noteId);
    let targetDocId: string;
    let initialRevisionId: string | undefined;
    let endIndex: number;

    if (existingRef?.documentId) {
      targetDocId = existingRef.documentId;
      const existingRemoteDoc = await withNoteSyncRetry(() =>
        getGoogleDocument({ accessToken, documentId: targetDocId })
      ).catch(() => null);
      initialRevisionId = existingRemoteDoc?.revisionId ?? existingRef.revisionId ?? undefined;
      endIndex = existingRemoteDoc ? getGoogleDocBodyEndIndex(existingRemoteDoc) : 1;
    } else if (recoveredPending) {
      targetDocId = recoveredPending.documentId;
      const recoveredRemoteDoc = await withNoteSyncRetry(() =>
        getGoogleDocument({ accessToken, documentId: targetDocId })
      ).catch(() => null);
      initialRevisionId =
        recoveredRemoteDoc?.revisionId ?? recoveredPending.revisionId;
      endIndex = recoveredRemoteDoc
        ? getGoogleDocBodyEndIndex(recoveredRemoteDoc)
        : recoveredPending.bodyEndIndex;
    } else {
      const createdDoc = await withNoteSyncRetry(() =>
        createGoogleDocument({ accessToken, title: note.title || "Untitled Note" })
      );
      targetDocId = createdDoc.documentId;
      initialRevisionId = createdDoc.revisionId;
      endIndex = getGoogleDocBodyEndIndex(createdDoc);

      // 1. In-memory recovery journal for immediate same-process retry if DB is unreachable
      pendingExportRecoveryByNoteId.set(noteId, {
        documentId: targetDocId,
        revisionId: initialRevisionId,
        bodyEndIndex: endIndex,
      });

      // 2. Durable PostgreSQL pre-batchUpdate checkpoint (Phase 15 / LIM-18 resolution):
      // Persist `documentId` with `syncStatus: "EXPORTING"` immediately so that if the
      // Node/worker process crashes or restarts before `batchUpdateGoogleDocument` or
      // the final transaction completes, a retry after process restart recovers
      // `targetDocId` from PostgreSQL and never creates a duplicate Google Doc.
      const exportingCheckpoint: NoteGoogleDocExternalRef = {
        provider: "google_docs",
        documentId: targetDocId,
        webViewLink: `https://docs.google.com/document/d/${encodeURIComponent(targetDocId)}/edit`,
        revisionId: initialRevisionId ?? null,
        modifiedTime: null,
        lastSyncedLocalHash: "",
        lastSyncedRemoteHash: "",
        lastSyncedAt: new Date(0).toISOString(),
        syncStatus: "EXPORTING",
        lastSyncError: null,
        conflict: null,
      };
      try {
        await db.note.update({
          where: { id: noteId },
          data: { externalRef: exportingCheckpoint as unknown as Prisma.InputJsonValue },
        });
      } catch {
        // Best-effort checkpoint write; in-memory recovery journal remains active
      }
    }

    const { requests, canonicalSections } = buildGoogleDocReplaceRequests({
      title: note.title,
      blocks: note.blocks,
      existingDocEndIndex: endIndex,
    });

    if (requests.length > 0) {
      await withNoteSyncRetry(() =>
        batchUpdateGoogleDocument({
          accessToken,
          documentId: targetDocId,
          requests,
        })
      );
    }

    const [updatedDoc, driveMeta] = await Promise.all([
      withNoteSyncRetry(() =>
        getGoogleDocument({ accessToken, documentId: targetDocId })
      ).catch(() => ({ documentId: targetDocId, revisionId: initialRevisionId })),
      withNoteSyncRetry(() =>
        drive.getFileSyncMetadata({ accessToken, fileId: targetDocId })
      ).catch(() => null),
    ]);

    const syncHash = computeCanonicalNoteSyncHash({
      title: note.title,
      sections: canonicalSections,
    });

    const newRef: NoteGoogleDocExternalRef = {
      provider: "google_docs",
      documentId: targetDocId,
      webViewLink:
        driveMeta?.webViewLink ??
        `https://docs.google.com/document/d/${encodeURIComponent(targetDocId)}/edit`,
      revisionId: updatedDoc.revisionId ?? initialRevisionId ?? null,
      modifiedTime: driveMeta?.modifiedTime ?? new Date().toISOString(),
      lastSyncedLocalHash: syncHash,
      lastSyncedRemoteHash: syncHash,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: "SYNCED",
      lastSyncError: null,
      conflict: null,
    };

    const persistedRef = await db.$transaction(async (tx) => {
      await assertActiveGroupAndMembershipForNoteTx(tx, noteGroupId, userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google-note-sync:${noteId}`}, 0))`;
      const freshNote = (await tx.note.findUnique({
        where: { id: noteId },
        select: {
          id: true,
          deletedAt: true,
          externalRef: true,
          topic: {
            select: {
              deletedAt: true,
              chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
            },
          },
        },
      })) as NoteHierarchyRow | null;
      if (isNoteHierarchySoftDeleted(freshNote)) {
        throw new NoteNotFoundOrForbiddenError("Note not found", 404);
      }
      const concurrentRef = parseNoteGoogleDocRef(freshNote?.externalRef);
      if (
        concurrentRef &&
        concurrentRef.lastSyncedLocalHash !== "" &&
        concurrentRef.documentId !== targetDocId
      ) {
        return concurrentRef;
      }
      await tx.note.update({
        where: { id: noteId },
        data: { externalRef: newRef as unknown as Prisma.InputJsonValue },
      });
      return newRef;
    });

    pendingExportRecoveryByNoteId.delete(noteId);

    return {
      status: "exported",
      noteId,
      externalRef: persistedRef,
    };
  }

  // --------------------------------------------------------------------------
  // Case 2: Synchronize Existing Linked Google Doc
  // --------------------------------------------------------------------------
  const documentId = existingRef.documentId;

  let remoteDoc;
  let driveMeta = null;
  try {
    [remoteDoc, driveMeta] = await Promise.all([
      withNoteSyncRetry(() => getGoogleDocument({ accessToken, documentId })),
      withNoteSyncRetry(() => drive.getFileSyncMetadata({ accessToken, fileId: documentId })).catch(
        () => null
      ),
    ]);
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) {
      const deletedRef: NoteGoogleDocExternalRef = {
        ...existingRef,
        syncStatus: "REMOTE_DELETED",
        lastSyncError: "The linked Google Doc was deleted or is no longer accessible in Google Drive.",
      };
      await db.note.update({
        where: { id: noteId },
        data: { externalRef: deletedRef as unknown as Prisma.InputJsonValue },
      });
      return {
        status: "remote_deleted",
        noteId,
        externalRef: deletedRef,
      };
    }

    const errorRef: NoteGoogleDocExternalRef = {
      ...existingRef,
      syncStatus: "ERROR",
      lastSyncError: err instanceof GoogleApiError ? err.publicMessage : "Google Docs synchronization failed.",
    };
    await db.note
      .update({
        where: { id: noteId },
        data: { externalRef: errorRef as unknown as Prisma.InputJsonValue },
      })
      .catch(() => undefined);
    throw err;
  }

  if (driveMeta?.trashed) {
    const trashedRef: NoteGoogleDocExternalRef = {
      ...existingRef,
      syncStatus: "REMOTE_DELETED",
      lastSyncError: "The linked Google Doc is in Google Drive Trash.",
    };
    await db.note.update({
      where: { id: noteId },
      data: { externalRef: trashedRef as unknown as Prisma.InputJsonValue },
    });
    return {
      status: "remote_deleted",
      noteId,
      externalRef: trashedRef,
    };
  }

  const currentLocalHash = computeLocalNoteSyncHash(note.title, note.blocks);
  const parsedRemote = parseGoogleDocToNoteBlocks(remoteDoc, note.blocks);
  const currentRemoteHash = computeCanonicalNoteSyncHash({
    title: parsedRemote.title,
    sections: parsedRemote.canonicalSections,
  });

  const localChanged = currentLocalHash !== existingRef.lastSyncedLocalHash;
  const remoteChanged = currentRemoteHash !== existingRef.lastSyncedRemoteHash;

  // Echo suppression / loop prevention: if neither side's canonical content
  // has changed (or both sides already match each other), do not push or pull.
  if (
    !forceResolution &&
    ((!localChanged && !remoteChanged) || currentLocalHash === currentRemoteHash)
  ) {
    const syncedRef: NoteGoogleDocExternalRef = {
      ...existingRef,
      webViewLink: driveMeta?.webViewLink ?? existingRef.webViewLink,
      revisionId: remoteDoc.revisionId ?? existingRef.revisionId,
      modifiedTime: driveMeta?.modifiedTime ?? existingRef.modifiedTime,
      lastSyncedLocalHash: currentLocalHash,
      lastSyncedRemoteHash: currentRemoteHash,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: "SYNCED",
      lastSyncError: null,
      conflict: null,
    };
    await db.note.update({
      where: { id: noteId },
      data: { externalRef: syncedRef as unknown as Prisma.InputJsonValue },
    });
    return {
      status: "unchanged",
      noteId,
      externalRef: syncedRef,
      echoSuppressed: true,
    };
  }

  // Conflict detection: both Zenote and Google Docs diverged since the last sync,
  // or the caller requested a one-way push/pull when the opposite side also changed.
  const isConflict =
    !forceResolution &&
    ((localChanged && remoteChanged) ||
      (direction === "push" && remoteChanged && !localChanged) ||
      (direction === "pull" && localChanged && !remoteChanged));

  if (isConflict) {
    const conflictRef: NoteGoogleDocExternalRef = {
      ...existingRef,
      webViewLink: driveMeta?.webViewLink ?? existingRef.webViewLink,
      syncStatus: "CONFLICT",
      lastSyncError:
        "Both the Zenote note and the linked Google Doc were modified since the last sync. Choose which version to keep.",
      conflict: {
        detectedAt: new Date().toISOString(),
        localHash: currentLocalHash,
        remoteHash: currentRemoteHash,
        remoteRevisionId: remoteDoc.revisionId ?? null,
        remoteModifiedTime: driveMeta?.modifiedTime ?? null,
      },
    };
    await db.note.update({
      where: { id: noteId },
      data: { externalRef: conflictRef as unknown as Prisma.InputJsonValue },
    });
    return {
      status: "conflict",
      noteId,
      externalRef: conflictRef,
    };
  }

  const shouldPushLocal =
    forceResolution === "keep_local" ||
    (!forceResolution && localChanged && !remoteChanged && direction !== "pull");

  if (shouldPushLocal) {
    const endIndex = getGoogleDocBodyEndIndex(remoteDoc);
    const { requests } = buildGoogleDocReplaceRequests({
      title: note.title,
      blocks: note.blocks,
      existingDocEndIndex: endIndex,
    });

    try {
      if (requests.length > 0) {
        await withNoteSyncRetry(() =>
          batchUpdateGoogleDocument({
            accessToken,
            documentId,
            requests,
            requiredRevisionId: remoteDoc.revisionId,
          })
        );
      }
    } catch (err) {
      if (err instanceof GoogleRevisionConflictError) {
        const conflictRef: NoteGoogleDocExternalRef = {
          ...existingRef,
          syncStatus: "CONFLICT",
          lastSyncError: err.message,
          conflict: {
            detectedAt: new Date().toISOString(),
            localHash: currentLocalHash,
            remoteHash: currentRemoteHash,
            remoteRevisionId: remoteDoc.revisionId ?? null,
            remoteModifiedTime: driveMeta?.modifiedTime ?? null,
          },
        };
        await db.note.update({
          where: { id: noteId },
          data: { externalRef: conflictRef as unknown as Prisma.InputJsonValue },
        });
        return {
          status: "conflict",
          noteId,
          externalRef: conflictRef,
        };
      }
      throw err;
    }

    const [afterDoc, afterDriveMeta] = await Promise.all([
      withNoteSyncRetry(() => getGoogleDocument({ accessToken, documentId })).catch(() => remoteDoc),
      withNoteSyncRetry(() => drive.getFileSyncMetadata({ accessToken, fileId: documentId })).catch(
        () => driveMeta
      ),
    ]);

    const pushedRef: NoteGoogleDocExternalRef = {
      ...existingRef,
      webViewLink: afterDriveMeta?.webViewLink ?? existingRef.webViewLink,
      revisionId: afterDoc.revisionId ?? remoteDoc.revisionId ?? existingRef.revisionId,
      modifiedTime: afterDriveMeta?.modifiedTime ?? new Date().toISOString(),
      lastSyncedLocalHash: currentLocalHash,
      lastSyncedRemoteHash: currentLocalHash,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: "SYNCED",
      lastSyncError: null,
      conflict: null,
    };

    const dbWithTx = db as unknown as {
      $transaction?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
    };
    if (typeof dbWithTx.$transaction === "function") {
      await dbWithTx.$transaction(async (tx) => {
        await assertActiveGroupAndMembershipForNoteTx(tx, noteGroupId, userId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google-note-sync:${noteId}`}, 0))`;
        await tx.note.update({
          where: { id: noteId },
          data: { externalRef: pushedRef as unknown as Prisma.InputJsonValue },
        });
      });
    } else {
      await db.note.update({
        where: { id: noteId },
        data: { externalRef: pushedRef as unknown as Prisma.InputJsonValue },
      });
    }

    return {
      status: "pushed",
      noteId,
      externalRef: pushedRef,
    };
  }

  // --------------------------------------------------------------------------
  // Pull Remote Changes into Zenote NoteBlocks
  // --------------------------------------------------------------------------
  const newPlainText = buildNotePlainText(parsedRemote.title, parsedRemote.blocks);
  const pulledRef: NoteGoogleDocExternalRef = {
    ...existingRef,
    webViewLink: driveMeta?.webViewLink ?? existingRef.webViewLink,
    revisionId: remoteDoc.revisionId ?? existingRef.revisionId,
    modifiedTime: driveMeta?.modifiedTime ?? new Date().toISOString(),
    lastSyncedLocalHash: currentRemoteHash,
    lastSyncedRemoteHash: currentRemoteHash,
    lastSyncedAt: new Date().toISOString(),
    syncStatus: "SYNCED",
    lastSyncError: null,
    conflict: null,
  };

  const pullOutcome = await db.$transaction(async (tx) => {
    await assertActiveGroupAndMembershipForNoteTx(tx, noteGroupId, userId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google-note-sync:${noteId}`}, 0))`;

    const freshNote = (await tx.note.findUnique({
      where: { id: note.id },
      include: {
        blocks: { orderBy: { order: "asc" } },
        topic: {
          select: {
            deletedAt: true,
            chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
          },
        },
      },
    })) as (NoteHierarchyRow & { title: string; blocks: Array<SyncableNoteBlockInput & { id?: string }> }) | null;
    if (freshNote && isNoteHierarchySoftDeleted(freshNote)) {
      throw new NoteNotFoundOrForbiddenError("Note not found", 404);
    }
    const blocksToSnapshot = freshNote?.blocks ?? note.blocks;

    // Guard against concurrent local Zenote modifications that occurred while
    // `getGoogleDocument` was in flight: never overwrite newer local edits unless
    // the caller explicitly resolved the conflict (`forceResolution === "accept_remote"`).
    if (!forceResolution && freshNote) {
      const latestLocalHash = computeLocalNoteSyncHash(
        freshNote.title,
        freshNote.blocks
      );
      if (
        latestLocalHash !== currentLocalHash &&
        latestLocalHash !== existingRef.lastSyncedLocalHash &&
        latestLocalHash !== currentRemoteHash
      ) {
        const racedConflictRef: NoteGoogleDocExternalRef = {
          ...existingRef,
          webViewLink: driveMeta?.webViewLink ?? existingRef.webViewLink,
          syncStatus: "CONFLICT",
          lastSyncError:
            "The Zenote note was modified locally while remote Google Doc changes were being fetched. Choose which version to keep.",
          conflict: {
            detectedAt: new Date().toISOString(),
            localHash: latestLocalHash,
            remoteHash: currentRemoteHash,
            remoteRevisionId: remoteDoc.revisionId ?? null,
            remoteModifiedTime: driveMeta?.modifiedTime ?? null,
          },
        };
        await tx.note.update({
          where: { id: note.id },
          data: { externalRef: racedConflictRef as unknown as Prisma.InputJsonValue },
        });
        return { kind: "conflict" as const, externalRef: racedConflictRef };
      }
    }

    // Snapshot the pre-pull blocks into NoteVersion so the user's prior local
    // state is always preserved in version history.
    await tx.noteVersion.create({
      data: {
        id: nanoid(21),
        noteId: note.id,
        editedById: userId,
        snapshot: blocksToSnapshot.map((b: SyncableNoteBlockInput & { id?: string }) => ({
          id: b.id,
          kind: b.kind,
          heading: b.heading,
          content: b.content,
          order: b.order,
          metadata: b.metadata ?? null,
        })) as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.noteBlock.deleteMany({ where: { noteId: note.id } });
    await tx.noteBlock.createMany({
      data: parsedRemote.blocks.map((block, index) => ({
        id: nanoid(21),
        noteId: note.id,
        kind: block.kind,
        heading: block.heading,
        content: block.content as Prisma.InputJsonValue,
        order: index,
        metadata: (block.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
      })),
    });

    await tx.note.update({
      where: { id: note.id },
      data: {
        title: parsedRemote.title,
        plainText: newPlainText,
        externalRef: pulledRef as unknown as Prisma.InputJsonValue,
      },
    });

    return { kind: "pulled" as const, externalRef: pulledRef };
  });

  if (pullOutcome.kind === "conflict") {
    return {
      status: "conflict",
      noteId,
      externalRef: pullOutcome.externalRef,
    };
  }

  // Synchronize Phase 12 hybrid search index (NoteChunk embeddings + FTS).
  await syncNoteSearchIndex(note.id, newPlainText, { userId });

  return {
    status: "pulled",
    noteId,
    externalRef: pulledRef,
  };
}

