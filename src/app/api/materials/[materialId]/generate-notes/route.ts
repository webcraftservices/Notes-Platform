import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleMaterial, NotAuthorizedError } from "@/lib/access";
import {
  runNoteGenerationJob,
  MAX_DOCUMENT_NOTE_GEN_CHARS,
  SUPPORTED_NOTE_GEN_TYPES,
} from "@/lib/note-generation";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { createJobIfNoneActive } from "@/lib/processing-jobs";
import { dispatchProcessingJob } from "@/lib/queue/dispatcher";
import { rateLimit } from "@/lib/rate-limit";
import { assertWithinAIQuota, AIQuotaExceededError } from "@/lib/ai-quota";

/** Phase 9.4 — this AI generation route had no throttle; same class/limit as flashcard and quiz generation. */
const NOTE_GENERATION_RATE_LIMIT = { limit: 5, windowSeconds: 60 };

/**
 * Mirrors POST /api/materials/[materialId]/transcribe exactly: creates a
 * ProcessingJob and fires the orchestrator without awaiting it, returning
 * 202 immediately — the client polls for job status. Supports audio/video
 * (requires READY transcript) and documents (PDF, DOCX, PPTX, Google Docs,
 * requiring extracted text).
 */
export async function POST(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinRateLimit } = await rateLimit(`note-generation:${user.id}`, NOTE_GENERATION_RATE_LIMIT);
  if (!withinRateLimit) {
    return jsonError("You're generating notes too quickly. Please wait a moment and try again.", 429, {
      code: "AI_RATE_LIMITED",
    });
  }

  try {
    const material = await getAccessibleMaterial(params.materialId, user.id);
    if (!material) return NOT_FOUND();

    if (!SUPPORTED_NOTE_GEN_TYPES.has(material.type)) {
      return jsonError("AI notes can only be generated from audio, video, PDF, Word documents, PowerPoint presentations, or Google Docs.", 400);
    }
    if (!material.topicId) {
      return jsonError("Attach this material to a topic before generating AI notes from it.", 409);
    }

    if (material.type === "AUDIO" || material.type === "VIDEO") {
      const transcript = await db.transcript.findUnique({ where: { materialId: material.id } });
      if (!transcript || transcript.status !== "READY") {
        return jsonError("This material doesn't have a ready transcript yet — transcribe it first.", 409);
      }
    } else {
      const extractedText = material.extractedText?.trim();
      if (!extractedText || extractedText.length === 0) {
        const activeExtraction = await db.processingJob.findFirst({
          where: {
            materialId: material.id,
            type: material.type === "GOOGLE_DOC" ? "GOOGLE_SYNC" : "DOCUMENT_EXTRACTION",
            status: { in: ["QUEUED", "RUNNING"] },
          },
        });
        if (activeExtraction) {
          return jsonError("Document text extraction is still in progress. Please wait a moment and try again.", 409, {
            code: "DOCUMENT_EXTRACTION_PENDING",
          });
        }
        return jsonError("This document has no extracted text or extraction failed. Please upload a readable document with selectable text.", 409, {
          code: "DOCUMENT_TEXT_EMPTY",
        });
      }

      if (extractedText.length > MAX_DOCUMENT_NOTE_GEN_CHARS) {
        return jsonError(
          `This document is too large for single-pass note generation (${extractedText.length.toLocaleString()} characters; limit is ${MAX_DOCUMENT_NOTE_GEN_CHARS.toLocaleString()}). Please split the document into smaller sections and try again.`,
          413,
          { code: "DOCUMENT_TOO_LARGE" }
        );
      }
    }

    // AI quota enforcement: check before creating job or invoking model
    await assertWithinAIQuota(user.id);

    // Atomic check-and-create (Phase 9.4). Previously two overlapping
    // requests could both pass the "no active job" check and each append a
    // full set of AI blocks to the user's note.
    const { job, created } = await createJobIfNoneActive({
      userId: user.id,
      materialId: material.id,
      type: "AI_NOTE_GENERATION",
      ...(material.groupId ? { verifyActorMembership: true } : {}),
    });
    if (!created || !job) return NextResponse.json({ job });

    void dispatchProcessingJob(job.id, "AI_NOTE_GENERATION", {
      inProcessRunner: runNoteGenerationJob,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof AIQuotaExceededError) {
      return jsonError(
        "You've used all of your AI credits for this billing period. Upgrade your plan or wait for it to reset.",
        429,
        {
          code: "AI_QUOTA_EXCEEDED",
          usage: {
            usedCredits: err.usage.usedCredits,
            limitCredits: err.usage.limitCredits,
            plan: err.usage.plan.label,
          },
        }
      );
    }
    throw err;
  }
}
