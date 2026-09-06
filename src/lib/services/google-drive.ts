/**
 * Thin, real REST client for the Google Drive v3 API. Not a swappable
 * "provider" behind an interface like StorageService/SpeechService — there's
 * only ever one Google Drive, so there's nothing to abstract over. Kept
 * isolated in its own file/class (spec §11/§25) so Google API calls don't
 * spread into route handlers or React components.
 *
 * Every method takes a caller-supplied access token; refreshing that token
 * is lib/google-connection.ts's job, not this file's.
 */

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

const DRIVE_FIELDS = "files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size),nextPageToken";

async function driveFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
  });
  return res;
}

function driveErrorMessage(status: number, body: string): string {
  if (status === 401) return "Google Drive access has expired or was revoked. Reconnect Google Drive to continue.";
  if (status === 403) return "Google temporarily limited this request. Please try again later.";
  if (status === 404) return "This Google file is no longer accessible.";
  return `Google Drive request failed (${status}): ${body.slice(0, 300)}`;
}

export class GoogleDriveService {
  /**
   * Lists the user's files, optionally filtered by a name search. Flat
   * listing only — folders are excluded from results rather than made
   * navigable, and trashed files are excluded. Folder navigation is a known,
   * documented limitation of this phase (spec §22 marks it "where needed";
   * search covers the common case without the added complexity of a
   * breadcrumb-based folder browser).
   */
  async listFiles(input: {
    accessToken: string;
    query?: string;
    pageToken?: string;
  }): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const clauses = [`mimeType != '${GOOGLE_FOLDER_MIME}'`, "trashed = false"];
    if (input.query && input.query.trim()) {
      const escaped = input.query.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      clauses.push(`name contains '${escaped}'`);
    }
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      fields: DRIVE_FIELDS,
      pageSize: "25",
      orderBy: "modifiedTime desc",
      spaces: "drive",
    });
    if (input.pageToken) params.set("pageToken", input.pageToken);

    const res = await driveFetch(`files?${params.toString()}`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(driveErrorMessage(res.status, body));
    }
    const data = (await res.json()) as DriveListResponse;
    return { files: data.files ?? [], nextPageToken: data.nextPageToken };
  }

  async getFileMetadata(input: { accessToken: string; fileId: string }): Promise<DriveFile> {
    const params = new URLSearchParams({ fields: "id,name,mimeType,modifiedTime,webViewLink,iconLink,size" });
    const res = await driveFetch(`files/${encodeURIComponent(input.fileId)}?${params.toString()}`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(driveErrorMessage(res.status, body));
    }
    return res.json();
  }

  /** Downloads a binary Drive file's raw bytes (not for Google-native files — use exportFile). */
  async downloadFile(input: { accessToken: string; fileId: string }): Promise<Buffer> {
    const res = await driveFetch(`files/${encodeURIComponent(input.fileId)}?alt=media`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(driveErrorMessage(res.status, body));
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /** Exports a Google-native file (Doc, Sheet, Slide, ...) to a requested MIME type. */
  async exportFile(input: { accessToken: string; fileId: string; mimeType: string }): Promise<Buffer> {
    const params = new URLSearchParams({ mimeType: input.mimeType });
    const res = await driveFetch(
      `files/${encodeURIComponent(input.fileId)}/export?${params.toString()}`,
      input.accessToken
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(driveErrorMessage(res.status, body));
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export function getGoogleDriveService(): GoogleDriveService {
  return new GoogleDriveService();
}
