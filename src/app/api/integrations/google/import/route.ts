import { NextResponse } from "next/server";
import { getSessionUser, NotAuthorizedError } from "@/lib/access";
import { importGoogleFileSchema } from "@/lib/validation/google";
import { GoogleNotConnectedError } from "@/lib/google-connection";
import {
  importGoogleFile,
  GoogleFileUnsupportedError,
  GoogleDriveNotEnabledError,
  ScopeNotFoundError,
} from "@/lib/google-import";
import { rateLimit } from "@/lib/rate-limit";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, zodError, jsonError } from "@/lib/api-response";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success } = await rateLimit(`google-import:${user.id}`, { limit: 30, windowSeconds: 60 * 10 });
  if (!success) return jsonError("Too many imports at once. Try again in a few minutes.", 429);

  const body = await req.json().catch(() => null);
  const parsed = importGoogleFileSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const result = await importGoogleFile(user.id, parsed.data);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (err) {
    if (err instanceof ScopeNotFoundError) return NOT_FOUND();
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof GoogleFileUnsupportedError) return jsonError(err.message, 415);
    if (err instanceof GoogleDriveNotEnabledError) return jsonError(err.message, 403);
    if (err instanceof GoogleNotConnectedError) return jsonError(err.message, 409);
    const message = err instanceof Error ? err.message : "Import failed for an unknown reason.";
    return jsonError(message, 502);
  }
}
