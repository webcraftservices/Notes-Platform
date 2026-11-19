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
  GoogleInvalidPageTokenError,
  GOOGLE_RECONNECT_REQUIRED,
  GOOGLE_TEMPORARILY_UNAVAILABLE,
} from "./google-errors";

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
  trashed?: boolean;
  version?: string;
  headRevisionId?: string;
}

export interface DriveChange {
  fileId: string;
  removed?: boolean;
  time?: string;
  file?: DriveFile;
}

export interface DriveChangesListResponse {
  changes: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export interface DriveWatchChannelResponse {
  id: string;
  resourceId: string;
  resourceUri?: string;
  expiration?: string;
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
 * Reads a response body with a hard byte ceiling.
 *
 * For bounded transfers (`maxBytes !== undefined`):
 * - Declared Content-Length is checked first (cheap, no bytes read).
 * - A readable stream (`res.body`) is strictly required to enforce chunked byte
 *   counting. If `res.body` is missing, fails safely rather than falling back
 *   to an unbounded full-response allocation via `res.arrayBuffer()`.
 * - Streaming chunks are counted, cancelling the reader immediately if total
 *   accumulated bytes exceed `maxBytes`.
 * - Stream reader cleanup is wrapped in a `try/finally` block to guarantee
 *   explicit reader lock release on success, limit cancellation, or transport failure.
 *
 * For unbounded transfers (`maxBytes === undefined`):
 * - Buffers the entire response body directly via `res.arrayBuffer()`.
 */
async function readBodyWithLimit(res: Response, maxBytes: number | undefined): Promise<Buffer> {
  if (maxBytes === undefined) {
    return Buffer.from(await res.arrayBuffer());
  }

  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (res.body) {
      await res.body.cancel().catch(() => undefined);
    }
    throw new GoogleFileTooLargeError(maxBytes);
  }

  if (!res.body) {
    throw new Error("Response body is unavailable and cannot be safely size-limited.");
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
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
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // In case the stream or reader has already been closed/disposed
    }
  }
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
   * Fetches extended file metadata including `trashed`, `version`, and
   * `headRevisionId` for incremental synchronization and conflict checks.
   */
  async getFileSyncMetadata(input: { accessToken: string; fileId: string }): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: "id,name,mimeType,modifiedTime,trashed,webViewLink,iconLink,size,version,headRevisionId",
    });
    const res = await driveFetch(`files/${encodeURIComponent(input.fileId)}?${params.toString()}`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw driveError(res.status, body);
    }
    return res.json();
  }

  /**
   * Retrieves the initial cursor (`startPageToken`) for the Google Drive Changes API.
   */
  async getStartPageToken(input: { accessToken: string }): Promise<string> {
    const params = new URLSearchParams({ supportsAllDrives: "false" });
    const res = await driveFetch(`changes/startPageToken?${params.toString()}`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw driveError(res.status, body);
    }
    const data = (await res.json()) as { startPageToken?: string };
    if (!data.startPageToken) {
      throw new GoogleApiError("Google Drive startPageToken response was missing startPageToken.", {
        status: 502,
        publicMessage: GOOGLE_TEMPORARILY_UNAVAILABLE,
      });
    }
    return data.startPageToken;
  }

  /**
   * Lists incremental changes since `pageToken`. Throws `GoogleInvalidPageTokenError`
   * if Google reports that the token has expired or is invalid (HTTP 410 or 400 invalid pageToken).
   */
  async listChanges(input: {
    accessToken: string;
    pageToken: string;
    pageSize?: number;
  }): Promise<DriveChangesListResponse> {
    const params = new URLSearchParams({
      pageToken: input.pageToken,
      includeRemoved: "true",
      spaces: "drive",
      pageSize: String(input.pageSize ?? 100),
      fields:
        "changes(fileId,removed,time,file(id,name,mimeType,modifiedTime,trashed,webViewLink,iconLink,size,version,headRevisionId)),nextPageToken,newStartPageToken",
    });
    const res = await driveFetch(`changes?${params.toString()}`, input.accessToken);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 410 || (res.status === 400 && /pageToken|Invalid Value/i.test(body))) {
        throw new GoogleInvalidPageTokenError();
      }
      throw driveError(res.status, body);
    }
    const data = (await res.json()) as DriveChangesListResponse;
    return {
      changes: data.changes ?? [],
      nextPageToken: data.nextPageToken,
      newStartPageToken: data.newStartPageToken,
    };
  }

  /**
   * Registers a Google Drive push notification watch channel (`changes.watch`).
   */
  async watchChanges(input: {
    accessToken: string;
    pageToken: string;
    channelId: string;
    webhookAddress: string;
    channelToken: string;
    expirationMs?: number;
  }): Promise<DriveWatchChannelResponse> {
    const params = new URLSearchParams({ pageToken: input.pageToken });
    const payload: Record<string, string> = {
      id: input.channelId,
      type: "web_hook",
      address: input.webhookAddress,
      token: input.channelToken,
    };
    if (input.expirationMs !== undefined) {
      payload.expiration = String(input.expirationMs);
    }
    const res = await driveFetch(`changes/watch?${params.toString()}`, input.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 410) {
        throw new GoogleInvalidPageTokenError();
      }
      throw driveError(res.status, body);
    }
    return (await res.json()) as DriveWatchChannelResponse;
  }

  /**
   * Stops an active Google Drive push notification watch channel (`channels.stop`).
   * Treats 404 as already stopped so account disconnect remains idempotent.
   */
  async stopWatchChannel(input: {
    accessToken: string;
    channelId: string;
    resourceId: string;
  }): Promise<void> {
    const res = await driveFetch("channels/stop", input.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: input.channelId,
        resourceId: input.resourceId,
      }),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw driveError(res.status, body);
    }
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
  async exportFile(input: {
    accessToken: string;
    fileId: string;
    mimeType: string;
    maxBytes?: number;
  }): Promise<Buffer> {
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
    return readBodyWithLimit(res, input.maxBytes);
  }
}

export function getGoogleDriveService(): GoogleDriveService {
  return new GoogleDriveService();
}
