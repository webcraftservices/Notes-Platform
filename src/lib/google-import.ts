import { nanoid } from "nanoid";
import { Prisma, type Material, type MaterialType, type ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { getPrimaryWorkspace, assertActiveGroupMemberForCreation } from "@/lib/access";
import {
  resolveMaterialScope,
  ScopeNotFoundError,
  type MaterialScope,
} from "@/lib/materials-scope";
import { guessExtension } from "@/lib/mime";
import { classifyGoogleFile } from "@/lib/google-file-classifier";
import { getGoogleDriveService, GOOGLE_SLIDES_MIME } from "@/lib/services/google-drive";
import { extractGoogleDocText } from "@/lib/services/google-docs";
import { extractGoogleSlidesPresentation } from "@/lib/services/google-slides";
import { getGoogleConnectionStatus, getValidGoogleAccessToken, GoogleNotConnectedError } from "@/lib/google-connection";
import { isRetryableGoogleError } from "@/lib/services/google-errors";
import {
  claimJob,
  completeJobWithin,
  createJobIfNoneActiveWithin,
  failJob,
  isJobActive,
  notifyJobStatusChange,
  registerJobContext,
} from "@/lib/processing-jobs";
import { getStorageService } from "@/lib/services/storage";
import { deleteStorageObjectSafely } from "@/lib/services/storage-cleanup";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { extractMetadata } from "@/lib/metadata-extraction";
import { getStorageUsage } from "@/lib/storage-usage";
import { getPlanLimits } from "@/lib/plans";
import { queueEmbeddingJob } from "@/lib/ingestion";
import { queueDocumentExtractionIfNeeded } from "@/lib/document-extraction";
import { dispatchProcessingJob } from "@/lib/queue/dispatcher";
import { ActivityAction, createActivityLog } from "@/lib/activity";

export class GoogleFileUnsupportedError extends Error { }
export class GoogleDriveNotEnabledError extends Error {
  constructor() {
    super(
      "Google Drive import isn't available on the Free plan. Upgrade your plan in Settings to connect Google Drive."
    );
    this.name = "GoogleDriveNotEnabledError";
  }
}

export async function assertGoogleDriveSyncAllowed(userId: string): Promise<void> {
  const subscription = await db.subscription.findUnique({ where: { userId } });
  const effectiveTier =
    !subscription || subscription.status === "CANCELLED"
      ? "FREE"
      : (subscription.plan ?? "FREE");
  const plan = getPlanLimits(effectiveTier);
  if (!plan.advancedFeatures.googleDriveSync) {
    throw new GoogleDriveNotEnabledError();
  }
}

export { classifyGoogleFile };


export interface GoogleImportRequest {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  force?: boolean;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

export interface GoogleImportResult {
  material: { id: string; title: string; status: string };
  duplicate: boolean;
  changed: boolean;
}

/** Finds a previously-imported Material for this exact Google file in this exact destination. */
async function findExistingImport(
  client: Prisma.TransactionClient,
  input: {
    ownerId: string;
    scope: MaterialScope;
    fileId: string;
  }
) {
  return client.material.findFirst({
    where: {
      deletedAt: null,
      ownerId: input.ownerId,
      workspaceId: input.scope.workspaceId,
      groupId: input.scope.groupId,
      subjectId: input.scope.subjectId,
      chapterId: input.scope.chapterId,
      topicId: input.scope.topicId,
      AND: [
        { externalRef: { path: ["provider"], equals: "google_drive" } },
        { externalRef: { path: ["fileId"], equals: input.fileId } },
      ],
    },
  });
}

/**
 * Creates (or, with force=true, refreshes) a Material from a selected Drive
 * file/Doc and kicks off the async import job. Mirrors upload-url route's
 * scope resolution, plan-limit checks, and Material.create shape as closely
 * as possible so Google-imported materials behave identically to uploaded
 * ones everywhere else in the app (spec §15).
 */
export async function importGoogleFile(
  userId: string,
  input: GoogleImportRequest
): Promise<GoogleImportResult> {
  await assertGoogleDriveSyncAllowed(userId);

  const classification = classifyGoogleFile(input.mimeType);
  if (classification.kind === "unsupported") {
    throw new GoogleFileUnsupportedError(classification.reason);
  }

  // Fail here, before any Material row exists, rather than creating a
  // Material + job that can only ever fail with "not connected" inside the
  // background job.
  const connection = await getGoogleConnectionStatus(userId);
  if (!connection.connected) throw new GoogleNotConnectedError();

  const workspace = await getPrimaryWorkspace(userId);
  const scope = await resolveMaterialScope(
    { subjectId: input.subjectId, chapterId: input.chapterId, topicId: input.topicId },
    userId,
    workspace.id
  );

  const materialType: MaterialType =
    classification.kind === "google_doc"
      ? "GOOGLE_DOC"
      : classification.kind === "google_slides"
        ? "PPTX"
        : classification.materialType;

  const externalRef = {
    provider: "google_drive" as const,
    fileId: input.fileId,
    webViewLink: input.webViewLink ?? null,
    modifiedTime: input.modifiedTime ?? null,
    mimeType: input.mimeType,
    ...(classification.kind === "google_slides" ? { nativeKind: "google_slides" as const } : {}),
  };

  // Phase 9.4: the lookup, the create/update and the job creation are one
  // transaction serialized per (user, Drive file). Previously this was
  // findFirst → create → job create as independent statements, so a
  // double-click on "Import" (or a client retry after a timeout) could
  // create two Materials for the same Drive file, each with its own
  // import job — and nothing in the schema prevents that.
  const outcome = await db.$transaction(async (tx) => {
    // Acquire parent Group FOR SHARE (and revalidate active group membership)
    // BEFORE the per-(user, file) advisory lock to enforce top-down lock ordering.
    if (scope.groupId && typeof assertActiveGroupMemberForCreation === "function") {
      await assertActiveGroupMemberForCreation(tx, scope.groupId, userId);
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google-import:${userId}:${input.fileId}`}, 0))`;

    if (scope.topicId && typeof tx.topic?.findFirst === "function") {
      const activeTopic = await tx.topic.findFirst({
        where: { id: scope.topicId, deletedAt: null },
        select: { id: true },
      });
      if (!activeTopic) throw new ScopeNotFoundError("topic");
    }
    if (scope.chapterId && typeof tx.chapter?.findFirst === "function") {
      const activeChapter = await tx.chapter.findFirst({
        where: { id: scope.chapterId, deletedAt: null },
        select: { id: true },
      });
      if (!activeChapter) throw new ScopeNotFoundError("chapter");
    }
    if (scope.subjectId && typeof tx.subject?.findFirst === "function") {
      const activeSubject = await tx.subject.findFirst({
        where: { id: scope.subjectId, deletedAt: null },
        select: { id: true },
      });
      if (!activeSubject) throw new ScopeNotFoundError("subject");
    }

    const existing = await findExistingImport(tx, { ownerId: userId, scope, fileId: input.fileId });

    if (existing && !input.force) {
      const previousModifiedTime = (existing.externalRef as Record<string, unknown> | null)?.modifiedTime as
        | string
        | undefined;
      const changed = !!input.modifiedTime && previousModifiedTime !== input.modifiedTime;
      return { kind: "duplicate" as const, material: existing, changed };
    }

    let material: Material;
    if (existing && input.force) {
      // The previous content (extractedText/pages, stored bytes) is
      // deliberately left in place until the job replaces it: if this
      // refresh fails, the material must not be left worse off than before
      // the user pressed "re-import" (see runGoogleImportJob's failure
      // path). The job itself clears stale extraction output when it
      // writes new bytes.
      material = await tx.material.update({
        where: { id: existing.id },
        data: {
          title: input.name,
          type: materialType,
          mimeType: input.mimeType,
          externalRef,
          status: "PROCESSING",
        },
      });
    } else {
      material = await tx.material.create({
        data: {
          id: nanoid(21),
          ownerId: userId,
          workspaceId: scope.workspaceId,
          groupId: scope.groupId,
          subjectId: scope.subjectId,
          chapterId: scope.chapterId,
          topicId: scope.topicId,
          type: materialType,
          title: input.name,
          originalFilename: input.name,
          mimeType: input.mimeType,
          externalRef,
          status: "PROCESSING",
        },
      });
    }

    const { job, created } = await createJobIfNoneActiveWithin(tx, {
      userId,
      materialId: material.id,
      type: "GOOGLE_SYNC",
    });
    return { kind: "started" as const, material, job, created };
  });

  if (outcome.kind === "duplicate") {
    return { material: outcome.material, duplicate: true, changed: outcome.changed };
  }
  // An import of this exact file is already running: report it as such
  // rather than starting a second runner over the same material.
  if (!outcome.created || !outcome.job) {
    return { material: outcome.material, duplicate: true, changed: false };
  }

  void dispatchProcessingJob(outcome.job.id, "GOOGLE_SYNC", {
    inProcessRunner: runGoogleImportJob,
  });

  return { material: outcome.material, duplicate: false, changed: false };
}

async function logMaterialAddedIfGroup(material: { id: string; groupId: string | null; title: string }, userId: string) {
  if (!material.groupId) return;
  await createActivityLog(db, {
    groupId: material.groupId,
    userId,
    action: ActivityAction.MATERIAL_ADDED,
    targetType: "material",
    targetId: material.id,
    metadata: { targetName: material.title },
  });
}

async function writeImportedBytes(storageKey: string, data: Buffer, contentType: string): Promise<void> {
  const storage = getStorageService();
  if (storage instanceof LocalStorageService) {
    await storage.writeFile(storageKey, data);
    return;
  }
  if (storage instanceof S3StorageService) {
    await storage.putObjectBuffer(storageKey, data, contentType);
    return;
  }
  throw new Error("Unknown storage backend — cannot write imported Google Drive file.");
}

const GOOGLE_IMPORT_MAX_ATTEMPTS = 3;

async function withGoogleImportRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= GOOGLE_IMPORT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt === GOOGLE_IMPORT_MAX_ATTEMPTS || !isRetryableGoogleError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error("Google import retry limit was reached.");
}

/** Post-success side effects (activity log, indexing) must never turn an import that already succeeded into a reported failure. */
async function bestEffort(label: string, materialId: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.error(`[google-import] ${label} failed after a successful import`, {
      materialId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * A failed (re-)import must not leave the Material worse off than it was
 * before the job started. A brand-new import that never produced content
 * is FAILED; a re-import of a material that already has content (text or
 * stored bytes — both are only replaced on success) goes back to READY,
 * and the failure stays visible on the job record.
 */
async function settleMaterialAfterFailedImport(materialId: string): Promise<void> {
  try {
    const current = await db.material.findUnique({
      where: { id: materialId },
      select: { extractedText: true, storageKey: true, externalRef: true },
    });
    if (!current) return;
    const hadPriorContent = current.extractedText !== null || current.storageKey !== null;
    const existingRef =
      current.externalRef && typeof current.externalRef === "object"
        ? (current.externalRef as Record<string, unknown>)
        : null;
    const settledExternalRef =
      existingRef && existingRef.syncStatus === "SYNCING"
        ? ({
          ...existingRef,
          syncStatus: "ERROR",
        } as Prisma.InputJsonValue)
        : undefined;

    await db.material.updateMany({
      where: { id: materialId, status: "PROCESSING" },
      data: {
        status: hadPriorContent ? "READY" : "FAILED",
        ...(settledExternalRef ? { externalRef: settledExternalRef } : {}),
      },
    });
  } catch (err) {
    console.error("[google-import] could not settle material status after a failed import", {
      materialId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildSyncedDriveExternalRef(
  rawRef: unknown,
  fileId: string,
  extra: Record<string, unknown> = {}
): Prisma.InputJsonValue {
  const base =
    rawRef && typeof rawRef === "object"
      ? { ...(rawRef as Record<string, unknown>) }
      : {};
  const pendingModifiedTime =
    typeof base.pendingModifiedTime === "string" ? base.pendingModifiedTime : undefined;
  const pendingRevisionId =
    typeof base.pendingRevisionId === "string" ? base.pendingRevisionId : undefined;
  delete base.pendingModifiedTime;
  delete base.pendingRevisionId;

  return {
    ...base,
    provider: "google_drive",
    fileId,
    ...(pendingModifiedTime ? { modifiedTime: pendingModifiedTime } : {}),
    ...(pendingRevisionId ? { revisionId: pendingRevisionId } : {}),
    ...extra,
    remoteDeleted: false,
    lastSyncedAt: new Date().toISOString(),
    syncStatus: "SYNCED",
  } as Prisma.InputJsonValue;
}

/**
 * Runs a single GOOGLE_SYNC job end to end, same execution model (and same
 * serverless caveat) as runTranscriptionJob/runEmbeddingJob: RUNNING →
 * fetch a valid access token → extract or download the real content → READY
 * (+ kick off embedding for text content), or FAILED with a real error
 * message. Never fabricates a successful import.
 */
export async function runGoogleImportJob(jobId: string): Promise<void> {
  // Phase 9.4: see runTranscriptionJob — everything runs inside the try
  // and `failJob` never throws.
  let job: ProcessingJob | null = null;
  let newlyWrittenStorageKey: string | null = null;
  let stagedStorageOwnerId: string | undefined;

  try {
    job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== "GOOGLE_SYNC" || !job.materialId) return;
    registerJobContext(job);
    if (!(await claimJob(jobId))) return;

    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material || material.deletedAt != null) throw new Error("Material could not be found.");
    const ref = material.externalRef as { fileId?: string; mimeType?: string; nativeKind?: string } | null;
    if (!ref?.fileId) throw new Error("This material has no associated Google file.");
    const fileId = ref.fileId;
    const userId = job.userId;
    const previousStorageKey = material.storageKey ?? null;

    const accessToken = await withGoogleImportRetry(() => getValidGoogleAccessToken(userId));

    if (material.type === "GOOGLE_DOC") {
      const text = await withGoogleImportRetry(() => extractGoogleDocText({ accessToken, documentId: fileId }));
      if (!(await isJobActive(jobId, material.id))) return;
      const syncedDocRef = buildSyncedDriveExternalRef(material.externalRef, fileId);
      // Material content and job completion commit atomically inside interactive tx.
      const txResult = await db.$transaction(async (tx) => {
        if (!(await completeJobWithin(tx, jobId, material.id))) {
          return { committed: false as const, updated: null };
        }
        const updated = await tx.material.update({
          where: { id: material.id },
          data: {
            status: "READY",
            extractedText: text,
            sizeBytes: Buffer.byteLength(text, "utf8"),
            externalRef: syncedDocRef,
          },
        });
        return { committed: true as const, updated };
      });
      if (!txResult.committed || !txResult.updated) return;
      const updated = txResult.updated;
      notifyJobStatusChange({
        jobId,
        userId,
        materialId: material.id,
        type: "GOOGLE_SYNC",
        status: "SUCCEEDED",
        progress: 100,
      });

      await bestEffort("activity log", material.id, () => logMaterialAddedIfGroup(updated, userId));
      // Real, chunkable text is now available — index it right away, same
      // pattern as runTranscriptionJob triggering runEmbeddingJob.
      await queueEmbeddingJob(userId, material.id);
      return;
    }

    const isNativeGoogleSlides =
      material.mimeType === GOOGLE_SLIDES_MIME ||
      ref?.mimeType === GOOGLE_SLIDES_MIME ||
      ref?.nativeKind === "google_slides";

    if (isNativeGoogleSlides) {
      const slidesResult = await withGoogleImportRetry(() =>
        extractGoogleSlidesPresentation({ accessToken, presentationId: fileId })
      );
      if (!(await isJobActive(jobId, material.id))) return;

      const updatedExternalRef = buildSyncedDriveExternalRef(material.externalRef, fileId, {
        mimeType: GOOGLE_SLIDES_MIME,
        nativeKind: "google_slides",
        ...(slidesResult.revisionId ? { revisionId: slidesResult.revisionId } : {}),
      });

      const txResult = await db.$transaction(async (tx) => {
        if (!(await completeJobWithin(tx, jobId, material.id))) {
          return { committed: false as const, updated: null };
        }
        const updated = await tx.material.update({
          where: { id: material.id },
          data: {
            status: "READY",
            extractedText: slidesResult.text,
            extractedPages: slidesResult.pages as unknown as Prisma.InputJsonValue,
            sizeBytes: Buffer.byteLength(slidesResult.text, "utf8"),
            externalRef: updatedExternalRef,
            metadata: {
              pageCount: slidesResult.pages.length,
              slideCount: slidesResult.pages.length,
              presentationId: slidesResult.presentationId,
              revisionId: slidesResult.revisionId ?? null,
            },
          },
        });
        return { committed: true as const, updated };
      });
      if (!txResult.committed || !txResult.updated) return;
      const updated = txResult.updated;
      notifyJobStatusChange({
        jobId,
        userId,
        materialId: material.id,
        type: "GOOGLE_SYNC",
        status: "SUCCEEDED",
        progress: 100,
      });

      await bestEffort("activity log", material.id, () => logMaterialAddedIfGroup(updated, userId));
      await queueEmbeddingJob(userId, material.id);
      return;
    }

    // Concrete binary type (or the generic GOOGLE_DRIVE_FILE fallback):
    // download real bytes and store them to a versioned unique key so any
    // pre-existing storageKey on forced re-import stays completely intact
    // until the DB transaction commits.
    const subscription = await db.subscription.findUnique({ where: { userId } });
    const effectiveTier =
      !subscription || subscription.status === "CANCELLED"
        ? "FREE"
        : (subscription.plan ?? "FREE");
    const plan = getPlanLimits(effectiveTier);

    const drive = getGoogleDriveService();
    const buffer = await withGoogleImportRetry(() =>
      drive.downloadFile({ accessToken, fileId, maxBytes: plan.maxFileSizeBytes })
    );

    const { remainingBytes } = await getStorageUsage(userId);
    if (buffer.byteLength > remainingBytes + (material.sizeBytes ?? 0)) {
      throw new Error("This would exceed your plan's storage limit.");
    }

    const storageOwnerId = material.ownerId || userId;
    const storageKey = `materials/${storageOwnerId}/${material.id}-${nanoid(8)}.${guessExtension(material.mimeType ?? "")}`;
    await withGoogleImportRetry(() =>
      writeImportedBytes(storageKey, buffer, material.mimeType ?? "application/octet-stream")
    );
    newlyWrittenStorageKey = storageKey;
    stagedStorageOwnerId = storageOwnerId;

    const metadata: { durationSeconds?: number; pageCount?: number; width?: number; height?: number; extractionError?: string } =
      await extractMetadata(material.type, buffer).catch(() => ({ extractionError: "unknown" }));

    if (!(await isJobActive(jobId, material.id))) {
      await deleteStorageObjectSafely(newlyWrittenStorageKey, {
        route: "lib/google-import",
        op: "cleanup-cancelled-import",
        materialId: material.id,
        userId,
        ownerId: storageOwnerId,
        reason: "job-cancelled-before-commit",
      });
      newlyWrittenStorageKey = null;
      return;
    }

    const syncedBinaryRef = buildSyncedDriveExternalRef(material.externalRef, fileId);
    const txOutcome = await db.$transaction(async (tx) => {
      if (!(await completeJobWithin(tx, jobId, material.id))) {
        return { committed: false as const, updated: null };
      }
      const updated = await tx.material.update({
        where: { id: material.id },
        data: {
          status: "READY",
          storageKey,
          sizeBytes: buffer.byteLength,
          durationSeconds: metadata.durationSeconds ?? null,
          externalRef: syncedBinaryRef,
          metadata: metadata.extractionError
            ? { extractionError: metadata.extractionError }
            : { pageCount: metadata.pageCount, width: metadata.width, height: metadata.height },
          // New bytes just replaced the old ones, so any previously
          // extracted text/pages describe the OLD file — clear them so the
          // extraction below (which skips materials that already have
          // text) actually re-runs on a forced re-import.
          extractedText: null,
          extractedPages: Prisma.DbNull,
        },
      });
      return { committed: true as const, updated };
    });

    if (!txOutcome.committed || !txOutcome.updated) {
      await deleteStorageObjectSafely(newlyWrittenStorageKey, {
        route: "lib/google-import",
        op: "cleanup-aborted-import",
        materialId: material.id,
        userId,
        ownerId: storageOwnerId,
        reason: "transaction-aborted-job-inactive-or-deleted",
      });
      newlyWrittenStorageKey = null;
      return;
    }

    const updated = txOutcome.updated;
    newlyWrittenStorageKey = null;

    if (previousStorageKey && previousStorageKey !== storageKey) {
      await deleteStorageObjectSafely(previousStorageKey, {
        route: "lib/google-import",
        op: "cleanup-superseded-previous-object",
        materialId: material.id,
        userId,
        ownerId: material.ownerId,
        reason: "replaced-after-commit",
      });
    }

    notifyJobStatusChange({
      jobId,
      userId,
      materialId: material.id,
      type: "GOOGLE_SYNC",
      status: "SUCCEEDED",
      progress: 100,
    });

    await bestEffort("activity log", material.id, () => logMaterialAddedIfGroup(updated, userId));
    await queueDocumentExtractionIfNeeded(updated, userId);
  } catch (err) {
    if (newlyWrittenStorageKey) {
      await deleteStorageObjectSafely(newlyWrittenStorageKey, {
        route: "lib/google-import",
        op: "cleanup-failed-import",
        materialId: job?.materialId ?? undefined,
        userId: job?.userId,
        ownerId: stagedStorageOwnerId ?? job?.userId,
        reason: "import-failed-rollback",
      });
    }
    await failJob(jobId, "GOOGLE_SYNC", err, "Google import failed for an unknown reason.");
    if (job?.materialId) await settleMaterialAfterFailedImport(job.materialId);
  }
}

export { ScopeNotFoundError };
