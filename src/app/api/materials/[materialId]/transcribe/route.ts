import { NextResponse } from "next/server";
import { getSessionUser, getAccessibleMaterial, NotAuthorizedError } from "@/lib/access";
import { runTranscriptionJob } from "@/lib/transcription";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { createJobIfNoneActive } from "@/lib/processing-jobs";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Phase 9.4 — every successful call here is a separate, billed
 * speech-to-text run, and (unlike chat/flashcards/quizzes) this route had
 * no per-user throttle at all: a finished transcript could be re-requested
 * without limit. Short-window abuse guard only, same role as the other
 * rateLimit() call sites; generous enough for normal use (transcribe a
 * handful of recordings back to back).
 */
const TRANSCRIBE_RATE_LIMIT = { limit: 10, windowSeconds: 10 * 60 };

export async function POST(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinRateLimit } = await rateLimit(`transcribe:${user.id}`, TRANSCRIBE_RATE_LIMIT);
  if (!withinRateLimit) {
    return jsonError("You're starting transcriptions too quickly. Please wait a few minutes and try again.", 429, {
      code: "TRANSCRIBE_RATE_LIMITED",
    });
  }

  try {
    const material = await getAccessibleMaterial(params.materialId, user.id);
    if (!material) return NOT_FOUND();

    if (material.type !== "AUDIO" && material.type !== "VIDEO") {
      return jsonError("Only audio and video materials can be transcribed.", 400);
    }
    if (material.status !== "READY") {
      return jsonError("This file isn't finished uploading yet.", 409);
    }

    // Atomic check-and-create (Phase 9.4): a double click or a client retry
    // after a network timeout gets back the SAME job instead of starting a
    // second, separately billed transcription. A job stranded by a server
    // restart is reaped here, so it can't block retries forever.
    const { job, created } = await createJobIfNoneActive({
      userId: user.id,
      materialId: material.id,
      type: "TRANSCRIPTION",
    });
    if (!created) return NextResponse.json({ job });

    // Fire-and-forget: the HTTP response returns immediately with the job
    // id, and the client polls GET /api/materials/[id] for status. See
    // runTranscriptionJob's doc comment for the serverless caveat this
    // pattern carries.
    void runTranscriptionJob(job.id);

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
