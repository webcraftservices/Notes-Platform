import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleMaterial, NotAuthorizedError } from "@/lib/access";
import { runNoteGenerationJob } from "@/lib/note-generation";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Mirrors POST /api/materials/[materialId]/transcribe exactly: creates a
 * ProcessingJob and fires the orchestrator without awaiting it, returning
 * 202 immediately — the client polls for job status. See
 * runNoteGenerationJob's doc comment for what it requires (a topic-attached
 * material with a READY transcript) and transcription.ts's doc comment for
 * the shared serverless execution caveat.
 */
export async function POST(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const material = await getAccessibleMaterial(params.materialId, user.id);
    if (!material) return NOT_FOUND();

    if (material.type !== "AUDIO" && material.type !== "VIDEO") {
      return jsonError("AI notes can currently only be generated from audio or video materials.", 400);
    }
    if (!material.topicId) {
      return jsonError("Attach this material to a topic before generating AI notes from it.", 409);
    }

    const transcript = await db.transcript.findUnique({ where: { materialId: material.id } });
    if (!transcript || transcript.status !== "READY") {
      return jsonError("This material doesn't have a ready transcript yet — transcribe it first.", 409);
    }

    const existingActiveJob = await db.processingJob.findFirst({
      where: { materialId: material.id, type: "AI_NOTE_GENERATION", status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (existingActiveJob) {
      return NextResponse.json({ job: existingActiveJob });
    }

    const job = await db.processingJob.create({
      data: { userId: user.id, materialId: material.id, type: "AI_NOTE_GENERATION", status: "QUEUED" },
    });

    void runNoteGenerationJob(job.id);

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
