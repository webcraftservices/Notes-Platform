# Google Drive, Docs & Slides Integration (Phase 7 + Phase 14)

## Current state

As of Phase 14, Google Drive, Google Docs, and Google Slides integration supports:

1. **Connected Account OAuth & Encrypted Token Storage:** Dedicated OAuth 2.0 connection (`provider = GOOGLE_DRIVE`) independent of NextAuth sign-in, with AES-256-GCM encryption at rest (`src/lib/crypto.ts`) and per-user concurrent token refresh coalescing (`src/lib/google-connection.ts`).
2. **Incremental Google Drive Synchronization & Push Webhooks (`14-01`):**
   - Push notification webhook receiver at `POST /api/integrations/google/webhook` (`src/app/api/integrations/google/webhook/route.ts`) with constant-time HMAC-SHA256 verification of `X-Goog-Channel-Token` against `ConnectedAccount.watchTokenHash` and monotonic `X-Goog-Message-Number` deduplication.
   - Incremental change tracking via Google Drive Changes API (`changes.getStartPageToken`, `changes.list`, `changes.watch`, `channels.stop` in `src/lib/services/google-drive.ts` and `src/lib/google-drive-sync.ts`).
   - Automatic watch-channel renewal (`ensureDriveWatchChannel`, `renewExpiringWatchChannels`) and expired `pageToken` (`HTTP 410 Gone`) recovery via targeted metadata checks on tracked materials and notes (never performing full-Drive scans).
   - Manual/on-demand incremental sync trigger at `POST /api/integrations/google/sync`.
3. **Native Google Slides v1 REST API Parser (`14-02`):**
   - Direct extraction via `GET https://slides.googleapis.com/v1/presentations/{presentationId}` (`src/lib/services/google-slides.ts`) without converting or downloading as `.pptx`.
   - Preserves 1-based slide numbering, slide titles/subtitles, body text runs, TSV table structures, nested `elementGroup` hierarchies (up to 20 levels), and speaker notes (`notesPage.notesProperties.speakerNotesObjectId` + `BODY` placeholder fallback).
   - Populates `Material.extractedText` and 1-based `Material.extractedPages` (`[{ pageNumber, text, slideText, speakerNotes }]`) for seamless compatibility with Phase 11 grounded AI note generation (`formatDelimitedSourceText(..., "slide")`), Phase 12 hybrid search (`chunkPagedText` -> `MaterialChunk.pageNumber`), and slide-by-slide preview (`GoogleDocViewer`).
4. **Bidirectional Google Docs Export & Synchronization (`14-03`):**
   - Exports Zenote `Note`s (Title + ordered `NoteBlock`s) to Google Docs via the Google Docs v1 REST API (`documents.create`, `documents.batchUpdate`, `documents.get` in `src/lib/services/google-docs.ts` and `src/lib/google-note-sync.ts`).
   - Tracks `Note.externalRef` (`documentId`, `webViewLink`, `revisionId`, `modifiedTime`, `lastSyncedLocalHash`, `lastSyncedRemoteHash`, `syncStatus`, `conflict`).
   - Supports pushing local Zenote note edits to Google Docs (`writeControl.requiredRevisionId` guarded) and pulling remote Google Doc edits back into Zenote `NoteBlock`s (automatically snapshotting prior state into `NoteVersion` and re-indexing via Phase 12 `syncNoteSearchIndex`).
   - Prevents infinite webhook/sync echo loops via canonical SHA-256 content hashes and detects concurrent local + remote edits as explicit `CONFLICT` states (`keep_local` vs `accept_remote`).

## 1. Google Cloud project setup

1. Create (or reuse) a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable three APIs for that project:
   - **Google Drive API**
   - **Google Docs API**
   - **Google Slides API**
3. Configure the **OAuth consent screen**:
   - Scopes required (`GOOGLE_DRIVE_SCOPES` in `src/lib/services/google-oauth.ts`):
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/documents.readonly`
     - `https://www.googleapis.com/auth/documents`
     - `https://www.googleapis.com/auth/presentations.readonly`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `openid`
4. Create an **OAuth 2.0 Client ID** (Application type: Web application).
   - **Authorized redirect URI**:
     ```
     {NEXTAUTH_URL}/api/integrations/google/callback
     ```

## 2. Environment variables

```env
GOOGLE_DRIVE_CLIENT_ID="<client id>"
GOOGLE_DRIVE_CLIENT_SECRET="<client secret>"
GOOGLE_TOKEN_ENCRYPTION_KEY="<optional 32-byte secret; falls back to NEXTAUTH_SECRET derivation>"
GOOGLE_DRIVE_WEBHOOK_URL="https://<your-public-domain>/api/integrations/google/webhook"
GOOGLE_WEBHOOK_SECRET="<optional HMAC secret for X-Goog-Channel-Token hashing>"
```

- If `GOOGLE_DRIVE_WEBHOOK_URL` (or `NEXTAUTH_URL`) uses `http://localhost` during local development without an HTTPS tunnel, `ensureDriveWatchChannel` still initializes and persists `changesPageToken` so incremental Changes API synchronization (`POST /api/integrations/google/sync`) works identically, while skipping `changes.watch` registration (which Google Drive restricts to public `https://` endpoints).

## 3. How Drive files map onto Materials

| Drive file | Material behavior |
| --- | --- |
| Native Google Doc (`application/vnd.google-apps.document`) | `MaterialType.GOOGLE_DOC`; extracted via Drive `files.export?mimeType=text/plain` into `Material.extractedText` and indexed via `queueEmbeddingJob`. |
| Native Google Slides (`application/vnd.google-apps.presentation`) | `MaterialType.PPTX` with `externalRef.nativeKind = "google_slides"`; extracted directly via Google Slides v1 REST API (`presentations.get`) into `Material.extractedText` and 1-based `Material.extractedPages` (including speaker notes), then indexed via `queueEmbeddingJob`. |
| PDF, DOCX, PPTX, TXT, images, audio, video (`ACCEPTED_MIME_TYPES`) | Imported as that concrete `MaterialType`, stored via `StorageService`, and extracted/indexed through the Phase 11 & Phase 12 pipelines. |
| Google Sheets / Forms / Drawings, folders, shortcuts | Rejected with an explicit user-facing unsupported reason. |
| Any other binary MIME type | Imported as `MaterialType.GOOGLE_DRIVE_FILE` (stored bytes, download preview). |

## 4. Known limitations & operational boundaries

- **Drive browsing is flat, not folder-navigable.** Folders are excluded from listing results; search (`name contains`) narrows results.
- **Google Docs Material import vs. Note bidirectional sync:** Importing a Google Doc as a read-only `Material` uses plain-text export (`LIM-03`), whereas exporting/syncing a Zenote `Note` (`Task 14-03`) uses the structured Google Docs v1 API (`HEADING_1` title, `HEADING_2` block headings, `HEADING_3` subheadings, bullet/ordered lists, and paragraphs).
- **External Google API & Webhook Delivery Boundary (`LIM-17`):** Google Drive `changes.watch` push notifications require a publicly reachable `https://` endpoint and configured Google Cloud OAuth credentials. In local/CI environments without live Google Cloud OAuth credentials or public HTTPS ingress, webhook delivery, Changes API sync, native Slides v1 parsing, and bidirectional Docs v1 sync are verified via hermetic unit and route/service integration tests.
