import { handleProcessingJobsStream } from "@/app/api/processing-jobs/stream/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { jobId: string } }
): Promise<Response> {
  return handleProcessingJobsStream(req, params.jobId);
}

