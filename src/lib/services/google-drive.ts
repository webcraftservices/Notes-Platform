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

import { fetchWithTimeout } from "@/lib/fetch-timeout";
import {
  GoogleApiError,
  GoogleFileTooLargeError,
  GOOGLE_RECONNECT_REQUIRED,
  GOOGLE_TEMPORARILY_UNAVAILABLE,
} from "./google-errors";

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

/** Interactive calls (listing, metadata) — a user is waiting on the response. */
const DRIVE_API_TIMEOUT_MS = 20_000;
/** Whole-file transfers run inside a background job, so they get a much longer budget. */
const DRIVE_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000;

async function driveFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
  timeoutMs: number = DRIVE_API_TIMEOUT_MS
): Promise<Response> {
  return fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/${path}`,
    { ...init, headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` } },
    { timeoutMs, label: "Google Drive request" }
  );
}

function driveError(status: number, body: string): GoogleApiError {
  if (status === 401) {
    return new GoogleApiError(GOOGLE_RECONNECT_REQUIRED, { status, publicMessage: GOOGLE_RECONNECT_REQUIRED });
  }
  if (status === 403) {
    const message = "Google temporarily limited this request. Please try again later.";
    return new GoogleApiError(message, { status, publicMessage: message });
  }
  if (status === 404) {
    const message = "This Google file is no longer accessible.";
    return new GoogleApiError(message, { status, publicMessage: message });
  }
  return new GoogleApiError(`Google Drive request failed (${status}): ${body.slice(0, 300)}`, {
    status,
    publicMessage: GOOGLE_TEMPORARILY_UNAVAILABLE,
  });
}

/**
 * Reads a response body with a hard byte ceiling. The import job used to
 * `arrayBuffer()` whatever Drive sent and only compare its size to the
 * plan limit afterwards, so a multi-gigabyte Drive file was fully
 * buffered in server memory before being rejected. Declared
 * Content-Length is checked first (cheap, no bytes read); the streaming
 * count backstops a missing or dishonest header.
 */
async function readBodyWithLimit(res: Response, maxBytes: number | undefined): Promise<Buffer> {
  if (maxBytes === undefined || !res.body) {
    return Buffer.from(await res.arrayBuffer());
  }

  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body.cancel().catch(() => undefined);
    throw new GoogleFileTooLargeError(maxBytes);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GoogleFileTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
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
      throw driveError(res.status, body);
    }
    const data = (await res.json()) as DriveListResponse;
    return { files: data.files ?? [], nextPageToken: data.nextPageToken };
  }

  async getFileMetadata(input: { accessToken: string; fileId: string }): Promise<DriveFile> {
    const params = new URLSearchParams({ fields: "id,name,mimeType,modifiedTime,webViewLink,iconLink,size" });
    const res = await driveFetch(`files/${encodeURIComponent(input.fileId)}?${params.toString()}`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw driveError(res.status, body);
    }
    return res.json();
  }

  /**
   * Downloads a binary Drive file's raw bytes (not for Google-native files
   * — use exportFile). `maxBytes`, when given, aborts the transfer as soon
   * as the file is known to exceed it (GoogleFileTooLargeError).
   */
  async downloadFile(input: { accessToken: string; fileId: string; maxBytes?: number }): Promise<Buffer> {
    const res = await driveFetch(
      `files/${encodeURIComponent(input.fileId)}?alt=media`,
      input.accessToken,
      undefined,
      DRIVE_TRANSFER_TIMEOUT_MS
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw driveError(res.status, body);
    }
    return readBodyWithLimit(res, input.maxBytes);
  }

  /** Exports a Google-native file (Doc, Sheet, Slide, ...) to a requested MIME type. */
  async exportFile(input: { accessToken: string; fileId: string; mimeType: string }): Promise<Buffer> {
    const params = new URLSearchParams({ mimeType: input.mimeType });
    const res = await driveFetch(
      `files/${encodeURIComponent(input.fileId)}/export?${params.toString()}`,
      input.accessToken,
      undefined,
      DRIVE_TRANSFER_TIMEOUT_MS
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw driveError(res.status, body);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export function getGoogleDriveService(): GoogleDriveService {
  return new GoogleDriveService();
}
