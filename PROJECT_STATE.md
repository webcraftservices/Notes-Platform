# PROJECT_STATE.md — Current Project State

Last reconciled against the current source tree and validation commands on
**2026-09-06**.

Latest relevant commit:

`b2e12c8 Add Google Drive integration and material previews`

The repository's current code includes the completed Google Drive/Docs,
video-import reliability, AssemblyAI, and PPTX preview work described below.
Do not infer missing functionality from older historical notes in this file.

## Current phase

**Phase 7 — Google Drive / Google Docs integration: complete.**

The next planned phase is **document text extraction and RAG ingestion** for
PDF, DOCX, and PPTX files. That work has not started.

## Completed functionality

### Core platform (Phases 1–6)

- Next.js App Router application with TypeScript, Prisma/PostgreSQL,
  pgvector, NextAuth, Tailwind, Zod, and Vitest.
- Personal workspace hierarchy: Subject → Chapter → Topic.
- Notes editor with autosave, ordering, versions, and restore.
- Materials upload, link-add, organization, tags, archive, soft-delete, and
  plan/storage limits.
- PDF, image, text, audio, and video previews.
- Audio recording with MediaRecorder, device selection, level meter,
  pause/resume/cancel, and WebM duration metadata repair.
- Groups, membership, invitations, role enforcement, group-scoped Subjects
  and Materials, group AI scope wiring, activity, and notifications.

### Google Drive and Google Docs

The integration is real REST-based Google API integration; there is no mock or
fake success path.

- Separate Google Drive OAuth connection flow from Google sign-in.
- OAuth state is signed and OAuth tokens are encrypted at rest.
- Settings includes Connected Accounts.
- Add Material includes a Google Drive browser.
- Drive files can be browsed and imported.
- Duplicate imports are detected using `Material.externalRef`.
- Modified Drive files can be re-imported.
- Free-plan feature gating is enforced.
- Supported imported file types include PDF, DOCX, PPTX, TXT, images, audio,
  and video.
- Real Drive file bytes are downloaded into application storage.
- Unsupported Google-native file types are rejected honestly.
- Generic unsupported binary files use the existing honest fallback.
- Google-native Slides are not imported; PPTX files are supported.
- Google Docs are imported as `GOOGLE_DOC`.
- Google Docs text is obtained through Drive `text/plain` export and stored in
  `Material.extractedText`.
- Google Docs structure is intentionally flattened to plain text.
- Imported materials retain download and source/re-import behavior.

Relevant implementation areas include:

- `src/lib/services/google-oauth.ts`
- `src/lib/services/google-oauth-state.ts`
- `src/lib/services/google-drive.ts`
- `src/lib/services/google-docs.ts`
- `src/lib/google-connection.ts`
- `src/lib/google-file-classifier.ts`
- `src/lib/google-import.ts`
- `src/app/api/integrations/google/`
- `src/components/integrations/google-drive-browser.tsx`
- `src/components/settings/connected-accounts-panel.tsx`
- `src/components/materials/google-doc-viewer.tsx`
- `src/components/materials/google-source-card.tsx`

### Material schema and processing

- `Material.extractedText String? @db.Text` exists.
- Migration:
  `prisma/migrations/20260905090000_material_extracted_text/`
- The migration was applied and Prisma Client was regenerated.
- Existing material processing, storage, access checks, and download behavior
  remain in use.

### Google import and video reliability

- `google-import.ts` retries appropriate transient Google, network, and
  storage failures with a bounded maximum of three attempts.
- Permanent failures remain `FAILED`; retries do not fabricate success.
- Imported materials use `PROCESSING` while asynchronous work is active.
- `material-preview.tsx` polls while a material is `PROCESSING`.
- The UI shows an explicit processing/importing state and refreshes into the
  real preview after the material reaches `READY`.
- Google Drive audio/video imports preserve the existing transcription and
  storage pipeline.
- Successful imported videos eventually display their stored preview.

The background execution model is still fire-and-forget and therefore
requires a persistent Node process. A real queue/worker is future work for
serverless deployment; this was not replaced by a speculative architecture
change.

### PPTX presentation preview

PPTX files now render inside the application rather than using the old
unsupported-preview message.

- `PresentationViewer` fetches the authenticated stored PPTX through the
  existing material/storage path.
- `pptx2html` renders slides client-side.
- Required renderer globals and runtime dependencies are loaded.
- `patches/pptx2html+0.3.4.patch` fixes the renderer's outdated synchronous
  JSZip image extraction for the installed JSZip API.
- The viewer provides slide rendering, Previous/Next controls, slide count,
  loading state, error state, and download.
- Existing PPTX files remain stored as PPTX and remain downloadable.
- The viewer does not depend on the Google Drive website being open.
- Manual browser verification succeeded for:
  - Environmental Education presentation: 10 slides.
  - Air Act presentation: 16 slides.
  - First-slide rendering, navigation, refresh, and download.

The existing PDF/audio/video/document behavior was preserved. Google-native
Slides remain outside the importer because the current importer does not
export them to PPTX.

### Transcription

The speech abstraction has two real cloud providers:

- AssemblyAI, with polling, transcript retrieval, speaker labels where
  enabled, timestamps, language handling, punctuation/formatting options, and
  error handling.
- OpenAI Whisper, unchanged.

AssemblyAI prerecorded audio/video requests explicitly send:

```ts
speech_models: ["universal-2"]
```

The Pro models were removed intentionally for cost control. Do not switch the
application back to `universal-3-pro` or `universal-3-5-pro`.

### AI/RAG state

- Chunking, ingestion orchestration, pgvector retrieval, AI chat, and AI note
  generation scaffolding exist.
- AI and embedding providers remain intentionally provider-free and throw a
  real `ServiceNotConfiguredError` when unconfigured.
- Audio/video transcripts can flow through the existing chunking/indexing
  path when a provider is configured.
- PDF, DOCX, and PPTX text extraction is not implemented yet, so those files
  are not currently fully available to the RAG pipeline.

## Known limitations

- Google Drive browsing is flat rather than folder-navigable.
- Google Docs structure is flattened to `text/plain`.
- There is no continuous/background Google Drive synchronization.
- Google-native Slides are not currently imported; PPTX files are supported.
- PDF/DOCX/PPTX extraction, chunking, embedding, and indexing are not yet
  fully implemented for RAG.
- Audio/video imported from Drive require manual transcription.
- Fire-and-forget processing requires a persistent Node process and is not
  reliable on request-scoped serverless runtimes without a queue/worker.
- Production Google API connectivity depends on correctly configured Google
  Cloud OAuth credentials.
- No concrete AI or embedding provider is configured.
- AI chat is not streaming.
- There is no realtime collaboration infrastructure; notifications poll.
- Production hardening such as distributed rate limiting, observability, and
  database row-level security remains future work.

## Next planned phase: document extraction and RAG ingestion

Implement real document understanding without creating a second RAG system:

1. Implement PDF text extraction.
2. Implement DOCX text extraction.
3. Implement PPTX text extraction.
4. Store extracted text in `Material.extractedText`.
5. Reuse the existing chunking, embedding, vector, retrieval, and search
   architecture.
6. Make extracted content available to existing AI/RAG features.
7. Support both normal uploads and Google Drive imports.
8. Make processing idempotent and safe to retry.
9. Handle corrupted or empty documents honestly.
10. Preserve existing previews and downloads.
11. Do not break Google Drive, audio/video transcription, or the PPTX viewer.
12. Do not switch AssemblyAI back to a Pro model.

No database/schema change should be assumed until the extraction design
proves one is necessary.

## Validation status

The latest completed validation was run after cleaning stale Next.js build
artifacts:

```text
npm.cmd run test
  PASSED — 27 test files, 250 tests

npm.cmd run lint
  PASSED — no errors or warnings

npm.cmd run typecheck
  PASSED

npm.cmd run build
  PASSED — Next.js production build completed
  34/34 static pages generated
  /groups and /groups/[groupId] generated successfully
```

The `/groups` build failure previously observed was a stale `.next` artifact
issue. Removing only `.next` and rebuilding resolved it; no source change was
needed.

## Historical milestones

- Phases 1–5 established the application architecture, materials pipeline,
  transcription, provider-free AI/RAG scaffolding, and storage abstractions.
- Phase 6 added groups, collaboration, invitations, group-scoped content,
  group AI scope, activity, and notifications.
- Phase 7 added Google Drive/Docs OAuth, browsing, import, encrypted token
  storage, duplicate detection, source/re-import actions, and Google Docs
  text extraction.
- Follow-up reliability work added bounded Google import retries and
  processing-state polling for asynchronous video imports.
- AssemblyAI was explicitly configured for `universal-2`.
- Follow-up preview work added the in-app PPTX viewer and the persisted
  `pptx2html` compatibility patch.

## Documentation guidance for future agents

- Treat the completed functionality sections above as authoritative.
- Do not re-add the old “PPTX unsupported” behavior.
- Do not remove the Google import retry/polling behavior.
- Do not change AssemblyAI back to a Pro model.
- Do not implement PDF/DOCX/PPTX RAG extraction by bypassing the existing
  ingestion/retrieval architecture.
- Read `ARCHITECTURE.md` and `CLAUDE.md` before modifying application code.
