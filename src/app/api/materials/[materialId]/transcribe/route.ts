import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleMaterial, NotAuthorizedError } from "@/lib/access";
import { runTranscriptionJob } from "@/lib/transcription";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

export async function POST(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const material = await getAccessibleMaterial(params.materialId, user.id);
    if (!material) return NOT_FOUND();

    if (material.type !== "AUDIO" && material.type !== "VIDEO") {
      return jsonError("Only audio and video materials can be transcribed.", 400);
    }
    if (material.status !== "READY") {
      return jsonError("This file isn't finished uploading yet.", 409);
    }

    const existingActiveJob = await db.processingJob.findFirst({
      where: { materialId: material.id, type: "TRANSCRIPTION", status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (existingActiveJob) {
      return NextResponse.json({ job: existingActiveJob });
    }

    const job = await db.processingJob.create({
      data: { userId: user.id, materialId: material.id, type: "TRANSCRIPTION", status: "QUEUED" },
    });

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
