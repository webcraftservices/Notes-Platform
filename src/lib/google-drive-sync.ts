/**
 * Phase 14 (Task 14-01) — Google Drive Push Notification Webhook Receiver,
 * Watch-Channel Lifecycle Manager, and Incremental Changes API Synchronizer.
 */

import crypto from "crypto";
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getValidGoogleAccessToken,
  GoogleNotConnectedError,
} from "@/lib/google-connection";
import { lockGroupForShare } from "@/lib/access";
import {
  assertGoogleDriveSyncAllowed,
  runGoogleImportJob,
} from "@/lib/google-import";
import { exportOrSyncNoteWithGoogleDocs } from "@/lib/google-note-sync";
import { createJobIfNoneActiveWithin } from "@/lib/processing-jobs";
import { dispatchProcessingJob } from "@/lib/queue/dispatcher";
import {
  getGoogleDriveService,
  type DriveChange,
} from "@/lib/services/google-drive";
import {
  GoogleApiError,
  GoogleInvalidPageTokenError,
  GOOGLE_RECONNECT_REQUIRED,
  isRetryableGoogleError,
} from "@/lib/services/google-errors";

const PROVIDER = "GOOGLE_DRIVE" as const;

/** Default watch channel TTL requested from Google Drive (7 days). */
export const DEFAULT_WATCH_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Renew watch channels when within 24 hours of expiration. */
export const WATCH_RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Maximum Changes API pages fetched in a single sync pass to bound execution time. */
export const MAX_CHANGE_PAGES_PER_SYNC = 20;

const DRIVE_SYNC_MAX_ATTEMPTS = 3;

/** Coalesces and serializes concurrent incremental sync passes for the same userId in-process. */
const inFlightUserSyncs = new Map<string, Promise<GoogleDriveSyncSummary>>();
const pendingFollowUpSyncUsers = new Set<string>();

function getWebhookSigningSecret(): string {
  const configured = (
    process.env.GOOGLE_WEBHOOK_SECRET ||
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||
    process.env.NEXTAUTH_SECRET ||
    ""
  ).trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Google Drive webhook signing secret is not configured. Set GOOGLE_WEBHOOK_SECRET or GOOGLE_TOKEN_ENCRYPTION_KEY or NEXTAUTH_SECRET."
    );
  }
  return "zenote-phase14-default-webhook-secret";
}

/**
 * Computes a deterministic HMAC-SHA256 digest of a watch channel verification token.
 * The database stores only this digest (`watchTokenHash`), never the raw token.
 */
export function hashWatchChannelToken(rawToken: string): string {
  return crypto
    .createHmac("sha256", getWebhookSigningSecret())
    .update(rawToken, "utf8")
    .digest("hex");
}

/**
 * Generates a cryptographically signed channel verification token for a
 * `(accountId, channelId)` pair.
 */
export function generateWatchChannelToken(accountId: string, channelId: string): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = crypto
    .createHmac("sha256", getWebhookSigningSecret())
    .update(`${accountId}:${channelId}:${nonce}`, "utf8")
    .digest("hex");
  return `v1.${nonce}.${sig}`;
}

/**
 * Constant-time verification of an incoming `X-Goog-Channel-Token` header against
 * the stored `watchTokenHash`.
 */
export function verifyWatchChannelToken(
  incomingToken: string | null | undefined,
  expectedTokenHash: string | null | undefined
): boolean {
  if (!incomingToken || !expectedTokenHash) return false;
  const computedHash = hashWatchChannelToken(incomingToken);
  const a = Buffer.from(computedHash, "utf8");
  const b = Buffer.from(expectedTokenHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function resolveGoogleWebhookAddress(overrideUrl?: string): string | null {
  const raw = (
    overrideUrl ||
    process.env.GOOGLE_DRIVE_WEBHOOK_URL ||
    (process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/api/integrations/google/webhook`
      : "")
  ).trim();
  if (!raw) return null;
  return raw;
}

async function withDriveSyncRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= DRIVE_SYNC_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt === DRIVE_SYNC_MAX_ATTEMPTS || !isRetryableGoogleError(err)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw new Error("Google Drive sync retry limit was reached.");
}

export interface EnsureWatchChannelResult {
  watchRegistered: boolean;
  channelId: string | null;
  resourceId: string | null;
  expiresAt: Date | null;
  changesPageToken: string;
  reason?: "reused_active" | "registered" | "webhook_requires_https" | "webhook_url_missing";
}

/**
 * Initializes the user's Changes API `changesPageToken` if absent and registers
 * or renews their Google Drive push notification watch channel (`changes.watch`).
 */
export async function ensureDriveWatchChannel(
  userId: string,
  options: {
    forceRenew?: boolean;
    webhookAddress?: string;
  } = {}
): Promise<EnsureWatchChannelResult> {
  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) {
    throw new GoogleNotConnectedError();
  }

  const accessToken = await withDriveSyncRetry(() => getValidGoogleAccessToken(userId));
  const drive = getGoogleDriveService();

  let pageToken = account.changesPageToken;
  if (!pageToken) {
    pageToken = await withDriveSyncRetry(() => drive.getStartPageToken({ accessToken }));
    await db.connectedAccount.update({
      where: { id: account.id },
      data: { changesPageToken: pageToken },
    });
  }

  const now = Date.now();
  const hasHealthyChannel =
    !options.forceRenew &&
    Boolean(account.watchChannelId) &&
    Boolean(account.watchResourceId) &&
    Boolean(account.watchTokenHash) &&
    Boolean(account.watchExpiresAt) &&
    account.watchExpiresAt!.getTime() - now > WATCH_RENEWAL_THRESHOLD_MS;

  if (hasHealthyChannel) {
    return {
      watchRegistered: true,
      channelId: account.watchChannelId,
      resourceId: account.watchResourceId,
      expiresAt: account.watchExpiresAt,
      changesPageToken: pageToken,
      reason: "reused_active",
    };
  }

  const webhookAddress = resolveGoogleWebhookAddress(options.webhookAddress);
  if (!webhookAddress) {
    return {
      watchRegistered: false,
      channelId: null,
      resourceId: null,
      expiresAt: null,
      changesPageToken: pageToken,
      reason: "webhook_url_missing",
    };
  }

  if (!webhookAddress.startsWith("https://")) {
    return {
      watchRegistered: false,
      channelId: null,
      resourceId: null,
      expiresAt: null,
      changesPageToken: pageToken,
      reason: "webhook_requires_https",
    };
  }

  const newChannelId = `zenote-watch-${nanoid(21)}`;
  const rawToken = generateWatchChannelToken(account.id, newChannelId);
  const tokenHash = hashWatchChannelToken(rawToken);
  const requestedExpirationMs = now + DEFAULT_WATCH_EXPIRATION_MS;

  let watchRes;
  try {
    watchRes = await withDriveSyncRetry(() =>
      drive.watchChanges({
        accessToken,
        pageToken: pageToken!,
        channelId: newChannelId,
        webhookAddress,
        channelToken: rawToken,
        expirationMs: requestedExpirationMs,
      })
    );
  } catch (err) {
    if (err instanceof GoogleInvalidPageTokenError) {
      pageToken = await withDriveSyncRetry(() => drive.getStartPageToken({ accessToken }));
      watchRes = await withDriveSyncRetry(() =>
        drive.watchChanges({
          accessToken,
          pageToken: pageToken!,
          channelId: newChannelId,
          webhookAddress,
          channelToken: rawToken,
          expirationMs: requestedExpirationMs,
        })
      );
    } else {
      throw err;
    }
  }

  // Stop the previous watch channel best-effort so Google does not keep sending
  // duplicate notifications on both the old and new channels.
  if (account.watchChannelId && account.watchResourceId && account.watchChannelId !== watchRes.id) {
    await drive
      .stopWatchChannel({
        accessToken,
        channelId: account.watchChannelId,
        resourceId: account.watchResourceId,
      })
      .catch(() => undefined);
  }

  const expiresAt = watchRes.expiration
    ? new Date(Number(watchRes.expiration))
    : new Date(requestedExpirationMs);

  await db.connectedAccount.update({
    where: { id: account.id },
    data: {
      changesPageToken: pageToken,
      watchChannelId: watchRes.id,
      watchResourceId: watchRes.resourceId,
      watchTokenHash: tokenHash,
      watchExpiresAt: Number.isNaN(expiresAt.getTime())
        ? new Date(requestedExpirationMs)
        : expiresAt,
      lastWebhookMessageNumber: null,
    },
  });

  return {
    watchRegistered: true,
    channelId: watchRes.id,
    resourceId: watchRes.resourceId,
    expiresAt,
    changesPageToken: pageToken,
    reason: "registered",
  };
}

/**
 * Renews all active Google Drive watch channels that are expiring within `thresholdMs`
 * (or have already expired).
 */
export async function renewExpiringWatchChannels(
  thresholdMs: number = WATCH_RENEWAL_THRESHOLD_MS
): Promise<{
  checked: number;
  renewed: number;
  failed: number;
}> {
  const cutoff = new Date(Date.now() + thresholdMs);
  const expiringAccounts = await db.connectedAccount.findMany({
    where: {
      provider: PROVIDER,
      revokedAt: null,
      watchChannelId: { not: null },
      watchExpiresAt: { lte: cutoff },
    },
    select: { userId: true },
  });

  let renewed = 0;
  let failed = 0;
  for (const acc of expiringAccounts) {
    try {
      const res = await ensureDriveWatchChannel(acc.userId, { forceRenew: true });
      if (res.watchRegistered) renewed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    checked: expiringAccounts.length,
    renewed,
    failed,
  };
}

export interface GoogleDriveSyncSummary {
  userId: string;
  changesFetched: number;
  uniqueFilesChanged: number;
  materialsUpdated: number;
  materialsMarkedDeleted: number;
  materialsSkippedUnchanged: number;
  notesSynced: number;
  notesConflicted: number;
  notesMarkedDeleted: number;
  pageTokenReset: boolean;
  newStartPageToken: string;
}

/**
 * Targeted fallback reconciliation used ONLY when Google Drive reports that a
 * stored `changesPageToken` has expired (`410 Gone`). Checks only the specific
 * Drive `fileId`s already imported as `Material`s or linked as `Note`s by this
 * user — never performs a full-Drive or full-folder listing scan.
 */
async function collectTargetedChangesOnExpiredToken(
  userId: string,
  accessToken: string
): Promise<DriveChange[]> {
  const drive = getGoogleDriveService();
  const [materials, notes] = await Promise.all([
    db.material.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { externalRef: true },
    }),
    db.note.findMany({
      where: { authorId: userId, deletedAt: null },
      select: { externalRef: true },
    }),
  ]);

  const trackedFileIds = new Set<string>();
  for (const m of materials) {
    const ref = m.externalRef as { provider?: string; fileId?: string } | null;
    if (ref?.provider === "google_drive" && typeof ref.fileId === "string" && ref.fileId) {
      trackedFileIds.add(ref.fileId);
    }
  }
  for (const n of notes) {
    const ref = n.externalRef as { provider?: string; documentId?: string } | null;
    if (ref?.provider === "google_docs" && typeof ref.documentId === "string" && ref.documentId) {
      trackedFileIds.add(ref.documentId);
    }
  }

  const changes: DriveChange[] = [];
  for (const fileId of trackedFileIds) {
    try {
      const meta = await withDriveSyncRetry(() =>
        drive.getFileSyncMetadata({ accessToken, fileId })
      );
      changes.push({
        fileId,
        removed: Boolean(meta.trashed),
        file: meta,
      });
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) {
        changes.push({
          fileId,
          removed: true,
        });
      } else {
        throw err;
      }
    }
  }

  return changes;
}

/**
 * Executes an incremental Google Drive Changes API synchronization pass for `userId`.
 * Serializes concurrent calls for the same `userId`: if a second notification
 * arrives while a sync pass is already in flight, schedules one chained follow-up
 * pass so changes occurring after the first `changes.list` read are never missed.
 */
export async function syncGoogleDriveChangesForUser(
  userId: string,
  options: {
    awaitImportJobs?: boolean;
  } = {}
): Promise<GoogleDriveSyncSummary> {
  const existingSync = inFlightUserSyncs.get(userId);
  if (existingSync) {
    pendingFollowUpSyncUsers.add(userId);
    return existingSync;
  }

  const runSerialized = async (): Promise<GoogleDriveSyncSummary> => {
    let summary = await executeUserDriveSync(userId, options);
    while (pendingFollowUpSyncUsers.has(userId)) {
      pendingFollowUpSyncUsers.delete(userId);
      const followUp = await executeUserDriveSync(userId, options);
      summary = {
        userId,
        changesFetched: summary.changesFetched + followUp.changesFetched,
        uniqueFilesChanged: summary.uniqueFilesChanged + followUp.uniqueFilesChanged,
        materialsUpdated: summary.materialsUpdated + followUp.materialsUpdated,
        materialsMarkedDeleted:
          summary.materialsMarkedDeleted + followUp.materialsMarkedDeleted,
        materialsSkippedUnchanged:
          summary.materialsSkippedUnchanged + followUp.materialsSkippedUnchanged,
        notesSynced: summary.notesSynced + followUp.notesSynced,
        notesConflicted: summary.notesConflicted + followUp.notesConflicted,
        notesMarkedDeleted: summary.notesMarkedDeleted + followUp.notesMarkedDeleted,
        pageTokenReset: summary.pageTokenReset || followUp.pageTokenReset,
        newStartPageToken: followUp.newStartPageToken,
      };
    }
    return summary;
  };

  const syncPromise = runSerialized();
  inFlightUserSyncs.set(userId, syncPromise);
  try {
    return await syncPromise;
  } finally {
    pendingFollowUpSyncUsers.delete(userId);
    inFlightUserSyncs.delete(userId);
  }
}

async function executeUserDriveSync(
  userId: string,
  options: {
    awaitImportJobs?: boolean;
  }
): Promise<GoogleDriveSyncSummary> {
  await assertGoogleDriveSyncAllowed(userId);

  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) {
    throw new GoogleNotConnectedError();
  }

  await db.connectedAccount.update({
    where: { id: account.id },
    data: { syncStatus: "SYNCING", lastSyncError: null },
  });

  try {
    const accessToken = await withDriveSyncRetry(() => getValidGoogleAccessToken(userId));
    const drive = getGoogleDriveService();

    let pageToken = account.changesPageToken;
    let pageTokenReset = false;
    const allChanges: DriveChange[] = [];
    let newStartPageToken: string | undefined;
    let lastNextPageToken: string | undefined;

    if (!pageToken) {
      pageToken = await withDriveSyncRetry(() => drive.getStartPageToken({ accessToken }));
    }

    try {
      let currentToken: string | undefined = pageToken;
      let pagesFetched = 0;

      while (currentToken && pagesFetched < MAX_CHANGE_PAGES_PER_SYNC) {
        pagesFetched += 1;
        const page = await withDriveSyncRetry(() =>
          drive.listChanges({ accessToken, pageToken: currentToken! })
        );
        if (Array.isArray(page.changes) && page.changes.length > 0) {
          allChanges.push(...page.changes);
        }
        if (page.newStartPageToken) {
          newStartPageToken = page.newStartPageToken;
        }
        currentToken = page.nextPageToken;
        lastNextPageToken = page.nextPageToken;
      }
    } catch (err) {
      if (err instanceof GoogleInvalidPageTokenError) {
        pageTokenReset = true;
        newStartPageToken = await withDriveSyncRetry(() =>
          drive.getStartPageToken({ accessToken })
        );
        const targeted = await collectTargetedChangesOnExpiredToken(userId, accessToken);
        allChanges.push(...targeted);
      } else {
        throw err;
      }
    }

    const finalPageToken = newStartPageToken ?? lastNextPageToken ?? pageToken;

    // Deduplicate changes by fileId, preserving the latest change state in the window.
    const latestChangeByFileId = new Map<string, DriveChange>();
    for (const change of allChanges) {
      if (change && typeof change.fileId === "string" && change.fileId.length > 0) {
        latestChangeByFileId.set(change.fileId, change);
      }
    }

    let materialsUpdated = 0;
    let materialsMarkedDeleted = 0;
    let materialsSkippedUnchanged = 0;
    let notesSynced = 0;
    let notesConflicted = 0;
    let notesMarkedDeleted = 0;

    if (latestChangeByFileId.size > 0) {
      const [userMaterials, userNotes] = await Promise.all([
        db.material.findMany({
          where: { ownerId: userId, deletedAt: null },
        }),
        db.note.findMany({
          where: { authorId: userId, deletedAt: null },
          select: { id: true, externalRef: true },
        }),
      ]);

      const importJobPromises: Promise<void>[] = [];

      for (const material of userMaterials) {
        const ref = material.externalRef as Record<string, unknown> | null;
        if (!ref || ref.provider !== "google_drive" || typeof ref.fileId !== "string") {
          continue;
        }
        const change = latestChangeByFileId.get(ref.fileId);
        if (!change) continue;

        const isDeletedOrTrashed = Boolean(change.removed || change.file?.trashed);
        if (isDeletedOrTrashed) {
          const deletedRef = {
            ...ref,
            remoteDeleted: true,
            syncStatus: "REMOTE_DELETED",
            lastSyncedAt: new Date().toISOString(),
          };
          await db.material.update({
            where: { id: material.id },
            data: { externalRef: deletedRef as Prisma.InputJsonValue },
          });
          materialsMarkedDeleted += 1;
          continue;
        }

        const remoteFile = change.file;
        const previousModifiedTime =
          typeof ref.modifiedTime === "string" ? ref.modifiedTime : null;
        const previousRevisionId =
          typeof ref.revisionId === "string" ? ref.revisionId : null;

        const modifiedUnchanged =
          Boolean(remoteFile?.modifiedTime) &&
          remoteFile!.modifiedTime === previousModifiedTime &&
          (!remoteFile?.headRevisionId ||
            !previousRevisionId ||
            remoteFile.headRevisionId === previousRevisionId);

        if (modifiedUnchanged && material.status === "READY") {
          materialsSkippedUnchanged += 1;
          continue;
        }

        const updatedRef = {
          ...ref,
          ...(remoteFile?.webViewLink ? { webViewLink: remoteFile.webViewLink } : {}),
          ...(remoteFile?.modifiedTime
            ? {
                pendingModifiedTime: remoteFile.modifiedTime,
                ...(previousModifiedTime ? {} : { modifiedTime: remoteFile.modifiedTime }),
              }
            : {}),
          ...(remoteFile?.headRevisionId
            ? {
                pendingRevisionId: remoteFile.headRevisionId,
                ...(previousRevisionId ? {} : { revisionId: remoteFile.headRevisionId }),
              }
            : {}),
          remoteDeleted: false,
          syncStatus: "SYNCING",
          lastSyncedAt: new Date().toISOString(),
        };

        const jobId = await db.$transaction(async (tx) => {
          if (material.groupId && typeof (tx as { $queryRaw?: unknown }).$queryRaw === "function") {
            const lockedGroup = await lockGroupForShare(tx, material.groupId);
            if (!lockedGroup || lockedGroup.deletedAt !== null) return null;
          }
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google-import:${userId}:${ref.fileId as string}`}, 0))`;

          await tx.material.update({
            where: { id: material.id },
            data: {
              ...(remoteFile?.name ? { title: remoteFile.name } : {}),
              externalRef: updatedRef as Prisma.InputJsonValue,
              status: "PROCESSING",
            },
          });

          const { job, created } = await createJobIfNoneActiveWithin(tx, {
            userId,
            materialId: material.id,
            type: "GOOGLE_SYNC",
          });
          return created && job ? job.id : null;
        });

        if (jobId) {
          materialsUpdated += 1;
          const runPromise = dispatchProcessingJob(jobId, "GOOGLE_SYNC", {
            inProcessRunner: runGoogleImportJob,
            awaitInProcess: options.awaitImportJobs !== false,
          }).then(() => undefined);
          if (options.awaitImportJobs !== false) {
            importJobPromises.push(runPromise);
          }
        }
      }

      if (importJobPromises.length > 0) {
        await Promise.all(importJobPromises);
      }

      for (const note of userNotes) {
        const ref = note.externalRef as Record<string, unknown> | null;
        if (!ref || ref.provider !== "google_docs" || typeof ref.documentId !== "string") {
          continue;
        }
        const change = latestChangeByFileId.get(ref.documentId);
        if (!change) continue;

        if (change.removed || change.file?.trashed) {
          const deletedNoteRef = {
            ...ref,
            syncStatus: "REMOTE_DELETED",
            lastSyncError: "The linked Google Doc was deleted or moved to Trash in Google Drive.",
          };
          await db.note.update({
            where: { id: note.id },
            data: { externalRef: deletedNoteRef as Prisma.InputJsonValue },
          });
          notesMarkedDeleted += 1;
          continue;
        }

        const syncRes = await exportOrSyncNoteWithGoogleDocs(note.id, userId, {
          direction: "auto",
        });
        if (syncRes.status === "pulled" || syncRes.status === "pushed") {
          notesSynced += 1;
        } else if (syncRes.status === "conflict") {
          notesConflicted += 1;
        } else if (syncRes.status === "remote_deleted") {
          notesMarkedDeleted += 1;
        }
      }
    }

    await db.connectedAccount.update({
      where: { id: account.id },
      data: {
        changesPageToken: finalPageToken,
        lastSyncedAt: new Date(),
        syncStatus: "IDLE",
        lastSyncError: null,
      },
    });

    // Proactively renew the watch channel if it is approaching expiration.
    if (
      account.watchChannelId &&
      account.watchExpiresAt &&
      account.watchExpiresAt.getTime() - Date.now() <= WATCH_RENEWAL_THRESHOLD_MS
    ) {
      await ensureDriveWatchChannel(userId, { forceRenew: true }).catch(() => undefined);
    }

    return {
      userId,
      changesFetched: allChanges.length,
      uniqueFilesChanged: latestChangeByFileId.size,
      materialsUpdated,
      materialsMarkedDeleted,
      materialsSkippedUnchanged,
      notesSynced,
      notesConflicted,
      notesMarkedDeleted,
      pageTokenReset,
      newStartPageToken: finalPageToken,
    };
  } catch (err) {
    const isReconnect =
      err instanceof GoogleApiError && (err.status === 400 || err.status === 401);
    const errorStatus = isReconnect ? "RECONNECT_REQUIRED" : "ERROR";
    const errorMessage = isReconnect
      ? GOOGLE_RECONNECT_REQUIRED
      : err instanceof GoogleApiError
        ? err.publicMessage
        : "Google Drive incremental synchronization failed.";

    await db.connectedAccount
      .update({
        where: { id: account.id },
        data: {
          syncStatus: errorStatus,
          lastSyncError: errorMessage,
        },
      })
      .catch(() => undefined);

    throw err;
  }
}

export interface WebhookHeadersInput {
  channelId: string | null;
  channelToken: string | null;
  resourceId: string | null;
  resourceState: string | null;
  messageNumber: string | null;
  channelExpiration?: string | null;
}

export type DriveWebhookOutcome =
  | {
      ok: true;
      httpStatus: 200;
      status: "sync_ack" | "duplicate_ignored" | "processed";
      summary?: GoogleDriveSyncSummary;
    }
  | {
      ok: false;
      httpStatus: 400 | 401 | 404;
      error: string;
    };

const VALID_RESOURCE_STATES = new Set([
  "sync",
  "change",
  "update",
  "add",
  "remove",
  "trash",
  "untrash",
  "exists",
]);

/**
 * Validates and processes an incoming Google Drive push notification webhook.
 */
export async function handleGoogleDriveWebhook(
  headers: WebhookHeadersInput,
  options: { awaitImportJobs?: boolean } = {}
): Promise<DriveWebhookOutcome> {
  const channelId = headers.channelId?.trim() ?? "";
  const channelToken = headers.channelToken?.trim() ?? "";
  const resourceId = headers.resourceId?.trim() ?? "";
  const resourceState = headers.resourceState?.trim().toLowerCase() ?? "";
  const rawMessageNum = headers.messageNumber?.trim() ?? "";

  if (!channelId || !resourceId || !resourceState) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Missing required Google Drive webhook headers.",
    };
  }

  if (!VALID_RESOURCE_STATES.has(resourceState)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Unsupported Google Drive webhook resource state.",
    };
  }

  let parsedMessageNumber: bigint | null = null;
  if (rawMessageNum) {
    if (!/^\d+$/.test(rawMessageNum)) {
      return {
        ok: false,
        httpStatus: 400,
        error: "Invalid X-Goog-Message-Number header.",
      };
    }
    parsedMessageNumber = BigInt(rawMessageNum);
  }

  const account = await db.connectedAccount.findFirst({
    where: {
      watchChannelId: channelId,
      provider: PROVIDER,
      revokedAt: null,
    },
  });

  if (!account) {
    return {
      ok: false,
      httpStatus: 404,
      error: "Watch channel not found or inactive.",
    };
  }

  if (account.watchResourceId && account.watchResourceId !== resourceId) {
    return {
      ok: false,
      httpStatus: 401,
      error: "Watch resource identifier mismatch.",
    };
  }

  if (!verifyWatchChannelToken(channelToken, account.watchTokenHash)) {
    return {
      ok: false,
      httpStatus: 401,
      error: "Invalid webhook channel token.",
    };
  }

  // Initial watch channel verification handshake from Google Drive.
  if (resourceState === "sync") {
    if (
      parsedMessageNumber !== null &&
      (account.lastWebhookMessageNumber === null ||
        parsedMessageNumber > account.lastWebhookMessageNumber)
    ) {
      await db.connectedAccount.update({
        where: { id: account.id },
        data: { lastWebhookMessageNumber: parsedMessageNumber },
      });
    }
    return {
      ok: true,
      httpStatus: 200,
      status: "sync_ack",
    };
  }

  // Duplicate / out-of-order message number suppression:
  // If we already processed this exact or a newer message number for this channel,
  // acknowledge idempotently without re-running duplicate work.
  if (
    parsedMessageNumber !== null &&
    account.lastWebhookMessageNumber !== null &&
    parsedMessageNumber <= account.lastWebhookMessageNumber
  ) {
    return {
      ok: true,
      httpStatus: 200,
      status: "duplicate_ignored",
    };
  }

  const summary = await syncGoogleDriveChangesForUser(account.userId, {
    awaitImportJobs: options.awaitImportJobs,
  });

  // Only advance the webhook message watermark AFTER the incremental sync pass
  // completes without throwing, so a failed webhook execution can be safely
  // retried by Google Drive with the same X-Goog-Message-Number.
  if (parsedMessageNumber !== null) {
    const freshAccount = await db.connectedAccount.findFirst({
      where: { id: account.id },
      select: { lastWebhookMessageNumber: true },
    });
    if (
      !freshAccount ||
      freshAccount.lastWebhookMessageNumber === null ||
      parsedMessageNumber > freshAccount.lastWebhookMessageNumber
    ) {
      await db.connectedAccount.update({
        where: { id: account.id },
        data: { lastWebhookMessageNumber: parsedMessageNumber },
      });
    }
  }

  return {
    ok: true,
    httpStatus: 200,
    status: "processed",
    summary,
  };
}

