import { nanoid } from "nanoid";
import { Prisma, type Material, type MaterialType, type ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { getPrimaryWorkspace } from "@/lib/access";
import { resolveMaterialScope, ScopeNotFoundError, type MaterialScope } from "@/lib/materials-scope";
import { guessExtension } from "@/lib/mime";
import { classifyGoogleFile } from "@/lib/google-file-classifier";
import { getGoogleDriveService } from "@/lib/services/google-drive";
import { extractGoogleDocText } from "@/lib/services/google-docs";
import { getGoogleConnectionStatus, getValidGoogleAccessToken, GoogleNotConnectedError } from "@/lib/google-connection";
import { isRetryableGoogleError } from "@/lib/services/google-errors";
import { claimJob, createJobIfNoneActiveWithin, failJob } from "@/lib/processing-jobs";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { extractMetadata } from "@/lib/metadata-extraction";
import { getStorageUsage } from "@/lib/storage-usage";
import { getPlanLimits } from "@/lib/plans";
import { queueEmbeddingJob } from "@/lib/ingestion";
import { queueDocumentExtractionIfNeeded } from "@/lib/document-extraction";
import { ActivityAction, createActivityLog } from "@/lib/activity";

export class GoogleFileUnsupportedError extends Error {}
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
  const plan = getPlanLimits(subscription?.plan ?? "FREE");
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

  const materialType: MaterialType = classification.kind === "google_doc" ? "GOOGLE_DOC" : classification.materialType;

  const externalRef = {
    provider: "google_drive" as const,
    fileId: input.fileId,
    webViewLink: input.webViewLink ?? null,
    modifiedTime: input.modifiedTime ?? null,
    mimeType: input.mimeType,
  };

  // Phase 9.4: the lookup, the create/update and the job creation are one
  // transaction serialized per (user, Drive file). Previously this was
  // findFirst → create → job create as independent statements, so a
  // double-click on "Import" (or a client retry after a timeout) could
  // create two Materials for the same Drive file, each with its own
  // import job — and nothing in the schema prevents that.
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google-import:${userId}:${input.fileId}`}, 0))`;

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
  if (!outcome.created) {
    return { material: outcome.material, duplicate: true, changed: false };
  }

  void runGoogleImportJob(outcome.job.id);

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
      select: { extractedText: true, storageKey: true },
    });
    if (!current) return;
    const hadPriorContent = current.extractedText !== null || current.storageKey !== null;
    await db.material.updateMany({
      where: { id: materialId, status: "PROCESSING" },
      data: { status: hadPriorContent ? "READY" : "FAILED" },
    });
  } catch (err) {
    console.error("[google-import] could not settle material status after a failed import", {
      materialId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

  try {
    job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== "GOOGLE_SYNC" || !job.materialId) return;
    if (!(await claimJob(jobId))) return;

    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material) throw new Error("Material could not be found.");
    const ref = material.externalRef as { fileId?: string } | null;
    if (!ref?.fileId) throw new Error("This material has no associated Google file.");
    const fileId = ref.fileId;
    const userId = job.userId;

    const accessToken = await withGoogleImportRetry(() => getValidGoogleAccessToken(userId));

    if (material.type === "GOOGLE_DOC") {
      const text = await withGoogleImportRetry(() => extractGoogleDocText({ accessToken, documentId: fileId }));
      // Material content and job completion commit together.
      const [updated] = await db.$transaction([
        db.material.update({
          where: { id: material.id },
          data: { status: "READY", extractedText: text, sizeBytes: Buffer.byteLength(text, "utf8") },
        }),
        db.processingJob.update({
          where: { id: jobId },
          data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
        }),
      ]);

      await bestEffort("activity log", material.id, () => logMaterialAddedIfGroup(updated, userId));
      // Real, chunkable text is now available — index it right away, same
      // pattern as runTranscriptionJob triggering runEmbeddingJob.
      await queueEmbeddingJob(userId, material.id);
      return;
    }

    // Concrete binary type (or the generic GOOGLE_DRIVE_FILE fallback):
    // download real bytes and store them exactly like an uploaded file.
    const subscription = await db.subscription.findUnique({ where: { userId } });
    const plan = getPlanLimits(subscription?.plan ?? "FREE");

    // The plan's per-file limit is passed down so an oversized Drive file
    // is refused from its declared size / first excess bytes, never fully
    // buffered first.
    const drive = getGoogleDriveService();
    const buffer = await withGoogleImportRetry(() =>
      drive.downloadFile({ accessToken, fileId, maxBytes: plan.maxFileSizeBytes })
    );

    // A re-import replaces this material's existing bytes, so what it
    // already occupies is available to it (otherwise refreshing a large
    // file near the storage limit could never succeed).
    const { remainingBytes } = await getStorageUsage(userId);
    if (buffer.byteLength > remainingBytes + (material.sizeBytes ?? 0)) {
      throw new Error("This would exceed your plan's storage limit.");
    }

    const storageKey = `materials/${userId}/${material.id}.${guessExtension(material.mimeType ?? "")}`;
    await withGoogleImportRetry(() =>
      writeImportedBytes(storageKey, buffer, material.mimeType ?? "application/octet-stream")
    );

    const metadata: { durationSeconds?: number; pageCount?: number; width?: number; height?: number; extractionError?: string } =
      await extractMetadata(material.type, buffer).catch(() => ({ extractionError: "unknown" }));

    const [updated] = await db.$transaction([
      db.material.update({
        where: { id: material.id },
        data: {
          status: "READY",
          storageKey,
          sizeBytes: buffer.byteLength,
          durationSeconds: metadata.durationSeconds ?? null,
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
      }),
      db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      }),
    ]);

    await bestEffort("activity log", material.id, () => logMaterialAddedIfGroup(updated, userId));
    // Same automatic-extraction trigger as a normal upload's complete
    // route — no-ops for material types this pipeline doesn't handle
    // (GOOGLE_DRIVE_FILE, AUDIO, VIDEO, IMAGE, TEXT). Never throws.
    await queueDocumentExtractionIfNeeded(updated, userId);

    // AUDIO/VIDEO imported from Drive are just as transcribable as an
    // upload — the user triggers that manually from the material page
    // (same as any other audio/video Material), matching spec §15's
    // "existing functionality... where those features already support the
    // material type" rather than auto-transcribing on import.
  } catch (err) {
    await failJob(jobId, "GOOGLE_SYNC", err, "Google import failed for an unknown reason.");
    if (job?.materialId) await settleMaterialAfterFailedImport(job.materialId);
  }
}

export { ScopeNotFoundError };
