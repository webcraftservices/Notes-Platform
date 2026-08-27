import { NextResponse } from "next/server";
import { getSessionUser, getAccessibleProcessingJob, NotAuthorizedError } from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Generic job-status polling endpoint (spec §49). Transcription polls
 * GET /api/materials/[materialId] instead (it needs the material's
 * transcript alongside the job in one response) — this route exists for
 * jobs like AI_NOTE_GENERATION whose result lives somewhere other than
 * the material itself (a Topic's Note), so there's no single natural
 * parent resource to attach status to.
 */
export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const job = await getAccessibleProcessingJob(params.jobId, user.id);
    if (!job) return NOT_FOUND();
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
