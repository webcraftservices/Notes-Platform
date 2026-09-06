# Google Drive / Docs setup (Phase 7)

## Current state

As of Phase 7, Google Drive and Google Docs import is **fully implemented
and real** — there is no mock/simulated path. Once a Google Cloud OAuth
client is configured (steps below), a user can connect their Google
account, browse their real Drive files, and import a Google Doc or an
ordinary Drive file into the existing Materials system, where it goes
through the same processing/preview/RAG pipeline as an uploaded file.

If the OAuth client isn't configured, every integration route fails with a
real, visible `GoogleNotConfiguredError` ("Google Drive/Docs integration is
not configured...") rather than a fake success — same "never fake a
feature" rule as `docs/ai-setup.md`.

## 1. Google Cloud project setup

1. Create (or reuse) a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable two APIs for that project:
   - **Google Drive API**
   - **Google Docs API** (used only for exporting a Doc's plain text — see
     "Design notes" below for why this app uses Drive's export endpoint
     rather than the Docs v1 structured API)
3. Configure the **OAuth consent screen**:
   - User type: External (or Internal, if using Google Workspace and
     restricting to your organization).
   - Scopes: add `.../auth/drive.readonly`, `.../auth/documents.readonly`,
     `.../auth/userinfo.email`, `openid`.
   - While the app is in "Testing" publishing status, add every Google
     account you'll test with under **Test users** — Google rejects the
     consent flow for any other account until the app is verified/published.
4. Create an **OAuth 2.0 Client ID** (Application type: Web application).
   - **Authorized redirect URI** — must match exactly:
     ```
     {NEXTAUTH_URL}/api/integrations/google/callback
     ```
     e.g. `http://localhost:3000/api/integrations/google/callback` for
     local development.

## 2. Environment variables

```env
GOOGLE_DRIVE_CLIENT_ID="<client id from step 1>"
GOOGLE_DRIVE_CLIENT_SECRET="<client secret from step 1>"
```

Both are optional: if unset, `lib/services/google-oauth.ts` falls back to
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (the same client used for
NextAuth Google sign-in) — most deployments only need one Google Cloud
OAuth client. Use separate `GOOGLE_DRIVE_CLIENT_ID/SECRET` if you want
Drive/Docs access on a different client than sign-in (e.g. so it can be
reviewed/verified independently, or scoped to fewer redirect URIs).

`GOOGLE_TOKEN_ENCRYPTION_KEY` is also optional — if unset, token encryption
(`lib/crypto.ts`) derives its key from `NEXTAUTH_SECRET`, which the app
already requires. Set it explicitly only if you want to rotate the token
encryption key independently of session signing.

## 3. Plan gating

Google Drive import is gated by `plans.ts`'s
`advancedFeatures.googleDriveSync`, which is `false` on the **Free** plan
and `true` on every paid tier — this flag existed in the codebase since
Phase 1/plan scaffolding but was unused until this phase wired it up. A
Free-plan user sees "Google Drive import isn't available on the Free plan"
both when trying to connect and when trying to import, not a broken/blank
screen.

## 4. What "connected" means (and doesn't)

Signing into the app with Google (NextAuth) is a **separate** authorization
from connecting Google Drive. The app never assumes Drive access just
because a user used Google login — see `lib/auth.ts`'s comment and
`lib/google-connection.ts`. A user must explicitly click "Connect Google
Drive" in **Settings → Connected accounts** (or from the "Google Drive" tab
in the Add Material dialog), which requests the `drive.readonly` +
`documents.readonly` scopes specifically.

## 5. How import maps onto Materials

| Drive file | Material behavior |
| --- | --- |
| Native Google Doc (`application/vnd.google-apps.document`) | `MaterialType.GOOGLE_DOC`; content extracted via Drive's `files.export?mimeType=text/plain` into `Material.extractedText`, then chunked/embedded exactly like a transcript (see `lib/ingestion.ts`) |
| PDF, DOCX, PPTX, TXT, images, audio, video (any MIME type in `mime.ts`'s `ACCEPTED_MIME_TYPES`) | Imported as that concrete `MaterialType` — real bytes downloaded and written to the configured `StorageService`, then behaves identically to an uploaded file (preview, metadata extraction, and for audio/video, manual transcription) |
| Google Sheets / Slides / Forms / Drawings, folders, shortcuts | Not imported — a clear "not supported" message, never a fake/empty material |
| Any other binary MIME type | Imported generically as `MaterialType.GOOGLE_DRIVE_FILE` — real bytes stored, download-only preview (`UnsupportedPreview`), same honest fallback DOCX/PPTX already get |

Duplicate imports of the same Drive file into the same destination
(subject/chapter/topic/workspace/group) are detected via
`Material.externalRef`'s `{ provider: "google_drive", fileId }` and reported
back to the client instead of creating a second Material. If the file's
`modifiedTime` has changed since the last import, the client automatically
re-imports (overwriting the existing Material's content in place, keeping
its id/ownership/tags/notes) rather than requiring a second explicit click.

## 6. Known limitations

- **Drive browsing is flat, not folder-navigable.** Folders are excluded
  from listing results; search (`name contains`) is the only way to narrow
  results in this phase. Folder navigation is a real gap, not a fake no-op.
- **Google Docs structure isn't preserved.** Import uses Drive's
  `text/plain` export, not the Docs v1 structured API — headings, lists,
  and tables collapse to plain text. This was a deliberate scope decision
  for Phase 7 (see `lib/services/google-docs.ts`'s comment): parsing the
  structured API would only pay off once something downstream (e.g.
  NoteBlocks) consumes that structure, and Phase 7 only needs to get a
  Google Doc's text into the existing chunk/embed pipeline.
- **No continuous/automatic sync.** Re-import is manual (or automatic only
  at the moment a user clicks Import again and Drive reports a newer
  `modifiedTime`) — there's no polling, webhook, or cron-based background
  sync. Implementing that would need Drive push notifications (webhooks)
  or a scheduled job, neither of which exists in this codebase yet.
- **PDF/DOCX/PPTX text still isn't extracted or indexed**, whether uploaded
  directly or imported from Drive — `DocumentProcessingService` still has
  no concrete implementation (see `docs/ai-setup.md`/`ARCHITECTURE.md`).
  Imported PDFs/DOCX/PPTX are real, stored, previewable files; they just
  aren't yet chunkable for AI chat, exactly like an uploaded PDF today.
- **AUDIO/VIDEO imported from Drive are not auto-transcribed on import** —
  the user triggers transcription manually from the material page, the
  same as any uploaded audio/video file.
- **Real Google API connectivity was not verified in the environment this
  phase was built in** (no outbound network to `accounts.google.com` /
  `googleapis.com`, and no test Google Cloud OAuth client credentials were
  available) — see `PROJECT_STATE.md`'s Phase 7 entry for exactly what was
  and wasn't verified.
