import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { listGoogleFilesQuerySchema } from "@/lib/validation/google";
import { getValidGoogleAccessToken, GoogleNotConnectedError } from "@/lib/google-connection";
import { getGoogleDriveService } from "@/lib/services/google-drive";
import { classifyGoogleFile } from "@/lib/google-file-classifier";
import { assertGoogleDriveSyncAllowed, GoogleDriveNotEnabledError } from "@/lib/google-import";
import { getMaterialLabel } from "@/lib/material-style";
import { rateLimit } from "@/lib/rate-limit";
import { UNAUTHORIZED, zodError, jsonError } from "@/lib/api-response";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success } = await rateLimit(`google-files:${user.id}`, { limit: 60, windowSeconds: 60 });
  if (!success) return jsonError("Too many requests. Slow down and try again.", 429);

  const url = new URL(req.url);
  const parsed = listGoogleFilesQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    pageToken: url.searchParams.get("pageToken") ?? undefined,
  });
  if (!parsed.success) return zodError(parsed.error);

  try {
    await assertGoogleDriveSyncAllowed(user.id);
    const accessToken = await getValidGoogleAccessToken(user.id);
    const drive = getGoogleDriveService();
    const { files, nextPageToken } = await drive.listFiles({
      accessToken,
      query: parsed.data.q,
      pageToken: parsed.data.pageToken,
    });

    const results = files.map((file) => {
      const classification = classifyGoogleFile(file.mimeType);
      return {
        ...file,
        supported: classification.kind !== "unsupported",
        unsupportedReason: classification.kind === "unsupported" ? classification.reason : undefined,
        materialTypeLabel:
          classification.kind === "concrete"
            ? getMaterialLabel(classification.materialType)
            : classification.kind === "google_doc"
              ? "Google Doc"
              : undefined,
      };
    });

    return NextResponse.json({ files: results, nextPageToken });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return jsonError(err.message, 409);
    if (err instanceof GoogleDriveNotEnabledError) return jsonError(err.message, 403);
    const message = err instanceof Error ? err.message : "Unable to load Google Drive.";
    return jsonError(message, 502);
  }
}
