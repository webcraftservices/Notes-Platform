import { nanoid } from "nanoid";
import type { MaterialType } from "@prisma/client";
import { db } from "@/lib/db";
import { getPrimaryWorkspace } from "@/lib/access";
import { resolveMaterialScope, ScopeNotFoundError, type MaterialScope } from "@/lib/materials-scope";
import { guessExtension } from "@/lib/mime";
import { classifyGoogleFile } from "@/lib/google-file-classifier";
import { getGoogleDriveService } from "@/lib/services/google-drive";
import { extractGoogleDocText } from "@/lib/services/google-docs";
import { getValidGoogleAccessToken } from "@/lib/google-connection";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { extractMetadata } from "@/lib/metadata-extraction";
import { getStorageUsage } from "@/lib/storage-usage";
import { getPlanLimits } from "@/lib/plans";
import { runEmbeddingJob } from "@/lib/ingestion";
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
async function findExistingImport(input: {
  ownerId: string;
  scope: MaterialScope;
  fileId: string;
}) {
  return db.material.findFirst({
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

  const existing = await findExistingImport({ ownerId: userId, scope, fileId: input.fileId });

  if (existing && !input.force) {
    const previousModifiedTime = (existing.externalRef as Record<string, unknown> | null)?.modifiedTime as
      | string
      | undefined;
    const changed = !!input.modifiedTime && previousModifiedTime !== input.modifiedTime;
    return { material: existing, duplicate: true, changed };
  }

  let material;
  if (existing && input.force) {
    material = await db.material.update({
      where: { id: existing.id },
      data: {
        title: input.name,
        type: materialType,
        mimeType: input.mimeType,
        externalRef,
        status: "PROCESSING",
        extractedText: null,
        storageKey: existing.storageKey, // overwritten in place by the job below
      },
    });
  } else {
    const materialId = nanoid(21);
    material = await db.material.create({
      data: {
        id: materialId,
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

  const job = await db.processingJob.create({
    data: { userId, materialId: material.id, type: "GOOGLE_SYNC", status: "QUEUED" },
  });
  void runGoogleImportJob(job.id);

  return { material, duplicate: false, changed: false };
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

function isRetryableGoogleImportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /Google (?:Drive request|access token refresh) failed \((?:429|5\d\d)\)/i.test(message) ||
    /(?:fetch failed|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN)/i.test(message)
  );
}

async function withGoogleImportRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= GOOGLE_IMPORT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt === GOOGLE_IMPORT_MAX_ATTEMPTS || !isRetryableGoogleImportError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error("Google import retry limit was reached.");
}

/**
 * Runs a single GOOGLE_SYNC job end to end, same execution model (and same
 * serverless caveat) as runTranscriptionJob/runEmbeddingJob: RUNNING →
 * fetch a valid access token → extract or download the real content → READY
 * (+ kick off embedding for text content), or FAILED with a real error
 * message. Never fabricates a successful import.
 */
export async function runGoogleImportJob(jobId: string): Promise<void> {
  const job = await db.processingJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "GOOGLE_SYNC" || !job.materialId) return;

  await db.processingJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });

  try {
    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material) throw new Error("Material could not be found.");
    const ref = material.externalRef as { fileId?: string } | null;
    if (!ref?.fileId) throw new Error("This material has no associated Google file.");
    const fileId = ref.fileId;

    const accessToken = await withGoogleImportRetry(() => getValidGoogleAccessToken(job.userId));

    if (material.type === "GOOGLE_DOC") {
      const text = await extractGoogleDocText({ accessToken, documentId: ref.fileId });
      const updated = await db.material.update({
        where: { id: material.id },
        data: { status: "READY", extractedText: text, sizeBytes: Buffer.byteLength(text, "utf8") },
      });
      await db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
      await logMaterialAddedIfGroup(updated, job.userId);

      // Real, chunkable text is now available — index it right away, same
      // pattern as runTranscriptionJob triggering runEmbeddingJob.
      const embeddingJob = await db.processingJob.create({
        data: { userId: job.userId, materialId: material.id, type: "EMBEDDING", status: "QUEUED" },
      });
      void runEmbeddingJob(embeddingJob.id);
      return;
    }

    // Concrete binary type (or the generic GOOGLE_DRIVE_FILE fallback):
    // download real bytes and store them exactly like an uploaded file.
    const drive = getGoogleDriveService();
    const buffer = await withGoogleImportRetry(() => drive.downloadFile({ accessToken, fileId }));

    const subscription = await db.subscription.findUnique({ where: { userId: job.userId } });
    const plan = getPlanLimits(subscription?.plan ?? "FREE");
    if (buffer.byteLength > plan.maxFileSizeBytes) {
      throw new Error(
        `This file is ${Math.round(buffer.byteLength / (1024 * 1024))}MB, which exceeds your plan's ` +
          `${Math.round(plan.maxFileSizeBytes / (1024 * 1024))}MB per-file limit.`
      );
    }
    const { remainingBytes } = await getStorageUsage(job.userId);
    if (buffer.byteLength > remainingBytes) {
      throw new Error("This would exceed your plan's storage limit.");
    }

    const storageKey = `materials/${job.userId}/${material.id}.${guessExtension(material.mimeType ?? "")}`;
    await withGoogleImportRetry(() =>
      writeImportedBytes(storageKey, buffer, material.mimeType ?? "application/octet-stream")
    );

    const metadata: { durationSeconds?: number; pageCount?: number; width?: number; height?: number; extractionError?: string } =
      await extractMetadata(material.type, buffer).catch(() => ({ extractionError: "unknown" }));

    const updated = await db.material.update({
      where: { id: material.id },
      data: {
        status: "READY",
        storageKey,
        sizeBytes: buffer.byteLength,
        durationSeconds: metadata.durationSeconds ?? null,
        metadata: metadata.extractionError
          ? { extractionError: metadata.extractionError }
          : { pageCount: metadata.pageCount, width: metadata.width, height: metadata.height },
      },
    });
    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
    });
    await logMaterialAddedIfGroup(updated, job.userId);
    // Same automatic-extraction trigger as a normal upload's complete
    // route — no-ops for material types this pipeline doesn't handle
    // (GOOGLE_DRIVE_FILE, AUDIO, VIDEO, IMAGE, TEXT).
    void queueDocumentExtractionIfNeeded(updated, job.userId);

    // AUDIO/VIDEO imported from Drive are just as transcribable as an
    // upload — the user triggers that manually from the material page
    // (same as any other audio/video Material), matching spec §15's
    // "existing functionality... where those features already support the
    // material type" rather than auto-transcribing on import.
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google import failed for an unknown reason.";
    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
    await db.material.updateMany({ where: { id: job.materialId }, data: { status: "FAILED" } }).catch(() => {});
  }
}

export { ScopeNotFoundError };
