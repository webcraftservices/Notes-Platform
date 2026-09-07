# PROJECT_STATE.md — Current Project State

Last reconciled against the current source tree and validation commands on
**2026-09-06**.

Latest relevant commit at the start of this session:

`f3359ed docs: update current project state`

(on top of `b2e12c8 Add Google Drive integration and material previews`)

This session's changes (document extraction) are uncommitted in the working
tree per standing instructions — Claude does not commit or push. Do not infer
missing functionality from older historical notes in this file.

## Current phase

**Document text extraction and RAG ingestion for PDF, DOCX, and PPTX:
implemented, uncommitted.**

The next planned phase is manual browser verification of end-to-end
extraction on real files, then continued phase progression per the roadmap
below.

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

### Document text extraction and RAG ingestion (PDF/DOCX/PPTX)

Real text extraction, not a stub — no fabricated text is ever produced, and
corrupted/unreadable files surface as a real failed `ProcessingJob`.

- New `DocumentProcessingService` interface implementation:
  `src/lib/services/document-processing-local.ts`, registered through
  `src/lib/services/document-processing.ts` (same interface+registry pattern
  as `speech.ts`/`storage.ts`). No env var or API key — extraction is local
  and free, so there is no `ServiceNotConfiguredError` path for it.
- PDF: `pdfjs-dist@4.8.69` (Mozilla's own PDF.js, Node `legacy` build), used
  directly rather than the unmaintained `pdf-parse` wrapper — `pdf-parse`
  vendors a years-old frozen pdf.js snapshot that, when tested, failed to
  parse even a minimal PDF generated by this project's own `pdf-lib`
  dependency. Pinned to the exact `4.8.69` version (not `^4.8.69`) because
  `pdfjs-dist@4.9.0+` raises the Node engine floor to `>=20`, conflicting
  with this project's stated `>=18.18.0`.
- DOCX: `mammoth@1.12.2` (`extractRawText`). DOCX has no page concept at the
  file-format level, so unlike PDF/PPTX it never returns a `pages` array —
  a real format limitation, not an oversight.
- PPTX: no new dependency — reuses the existing `jszip` dependency to read
  `ppt/slides/slideN.xml` parts directly and regex-extract `<a:t>` DrawingML
  text runs, in numeric slide order. This is a separate, minimal, server-side
  *text* path — it does not touch, replace, or share code with
  `PresentationViewer`/`pptx2html`, which is client-only (assumes a live DOM)
  and remains exactly as it was.
- New job runner `src/lib/document-extraction.ts` (`runDocumentExtractionJob`,
  `queueDocumentExtractionIfNeeded`), mirroring `transcription.ts`'s
  execution model (fire-and-forget, same serverless caveat). Unlike
  transcription, extraction is **automatic**, not manually triggered — it has
  no external cost, so there's no reason to gate it behind a button.
- Pure, DB-free idempotency guard `shouldQueueDocumentExtraction` lives in
  its own module, `src/lib/document-extraction-guard.ts` (imports only a
  Prisma *type*, never the Prisma client), following the same
  pure-function-extraction convention as `invitation-status.ts`'s
  `canManageInvitation`. A Material with non-empty `extractedText` is
  considered already processed and skipped; Google Drive's existing
  force-reimport path already nulls `extractedText` when content changes,
  so "extractedText is null" and "needs (re)extraction" stay in sync without
  a new content-hash column.
- Wired into **both** trigger points:
  - `src/app/api/materials/[materialId]/complete/route.ts` — both the local-
    storage and S3 completion branches (the S3 branch fires the extraction
    job fire-and-forget same as local; unlike the synchronous metadata
    extraction earlier in that route, this never blocks the response, so the
    "avoid downloading the object back down inside the request" tradeoff that
    applies to metadata does not apply here).
  - `src/lib/google-import.ts` — the binary-file download branch (PDF/DOCX/
    PPTX imported from Drive), separate from the existing `GOOGLE_DOC` branch
    which already has its own extraction (Drive's native `text/plain` export)
    and embedding trigger.
- On success with real extracted text: `Material.extractedText` is saved and
  an `EMBEDDING` `ProcessingJob` is queued and fired — **zero changes to
  `ingestion.ts`/`chunking.ts`/`retrieval.ts`** were needed, because
  `runEmbeddingJob` already branches on `material.extractedText` generically
  (not just for `GOOGLE_DOC`), and `chunkText` has no concept of source file
  type. This is the same chunk/embed/index pipeline Google Docs already used
  — not a second RAG system.
- On a document with no extractable text (e.g. a scanned PDF with no text
  layer): the job **succeeds** with `extractedText` left empty and no
  `EMBEDDING` job is queued — this is treated as an honest fact about the
  source file, not a failure.
- On a corrupted/unreadable file: the job **fails** with a real, specific
  error message (`ProcessingJob.error`); `Material.status` is left untouched
  (`READY`) either way, exactly like transcription failure never reverts an
  audio Material out of `READY` — extraction affects AI/RAG indexing, not
  whether the file is viewable/downloadable.

Relevant implementation areas:

- `src/lib/services/document-processing-local.ts`
- `src/lib/services/document-processing.ts`
- `src/lib/document-extraction.ts`
- `src/lib/document-extraction-guard.ts`
- `src/lib/mime.ts` (added `isDocxType`/`isPptxType` helpers)
- `src/app/api/materials/[materialId]/complete/route.ts` (extraction trigger
  added to both storage-backend branches)
- `src/lib/google-import.ts` (extraction trigger added to the binary-file
  branch)
- Tests: `src/lib/services/__tests__/document-processing-local.test.ts` (real
  PDF/DOCX/PPTX fixtures built in-memory with `pdf-lib`/hand-assembled OOXML
  zips — valid extraction, empty-content, corrupted-input, unsupported MIME,
  and a chunking-integration test), `src/lib/__tests__/document-extraction.test.ts`
  (pure idempotency-guard unit tests, no DB).

### AI/RAG state

- Chunking, ingestion orchestration, pgvector retrieval, AI chat, and AI note
  generation scaffolding exist.
- AI and embedding providers remain intentionally provider-free and throw a
  real `ServiceNotConfiguredError` when unconfigured.
- Audio/video transcripts and Google Docs text already flowed through the
  existing chunking/indexing path when a provider is configured.
- PDF, DOCX, and PPTX text extraction is now implemented (see above) and
  flows through that same existing chunking/embedding path — no second RAG
  pipeline was created. An actual embedding provider still needs to be
  configured (`ServiceNotConfiguredError` otherwise) for the resulting
  `EMBEDDING` jobs to succeed; extraction and `Material.extractedText` do not
  depend on that provider being configured.

## Known limitations

- Google Drive browsing is flat rather than folder-navigable.
- Google Docs structure is flattened to `text/plain`.
- There is no continuous/background Google Drive synchronization.
- Google-native Slides are not currently imported; PPTX files are supported.
- PPTX slide order is approximated from the numeric `slideN.xml` filename
  rather than resolved from `ppt/presentation.xml`'s authoritative
  `<p:sldIdLst>` — correct for the vast majority of real-world decks
  (PowerPoint numbers slides sequentially by default), but a deck whose
  slides were reordered without renumbering the underlying XML parts would
  extract text in the wrong order.
- Scanned/image-only PDFs (and PPTX/DOCX with no real text layer) have no OCR
  fallback — extraction honestly returns empty text rather than fabricating
  or attempting OCR; this is documented as a known extraction-service
  limitation, not a bug.
- Audio/video imported from Drive require manual transcription.
- Fire-and-forget processing (including the new DOCUMENT_EXTRACTION job)
  requires a persistent Node process and is not reliable on request-scoped
  serverless runtimes without a queue/worker.
- Production Google API connectivity depends on correctly configured Google
  Cloud OAuth credentials.
- No concrete AI or embedding provider is configured, so `EMBEDDING` jobs
  (including ones queued after successful document extraction) will fail
  with `ServiceNotConfiguredError` until one is.
- AI chat is not streaming.
- There is no realtime collaboration infrastructure; notifications poll.
- Production hardening such as distributed rate limiting, observability, and
  database row-level security remains future work.

## Next planned phase: manual verification, then continued roadmap

Document extraction (previous "next planned phase") is now implemented — see
"Document text extraction and RAG ingestion" above. Recommended next steps:

1. Manual browser verification: upload/import real PDF, DOCX, and PPTX files
   and confirm `Material.extractedText` populates and an `EMBEDDING`
   `ProcessingJob` is created (it will fail with `ServiceNotConfiguredError`
   until a real embedding provider is configured — that failure is expected
   and correct given the current provider-free state, not a regression).
2. Configure a real embedding provider to verify the full extract → chunk →
   embed → retrieve path end to end.
3. Continue phase progression per the original roadmap (Flashcards/Quizzes/
   Study Mode, Subscriptions, further production hardening).

No database/schema change was needed for document extraction —
`Material.extractedText`, `MaterialChunk.pageNumber`, and
`JobType.DOCUMENT_EXTRACTION` all already existed in the schema, unused,
before this session.

## Validation status

The latest completed validation for the document extraction work was run in
Claude's sandbox (not Nishant's Windows machine) on 2026-09-06:

```text
npx vitest run
  PASSED — 29 test files, 268 tests (was 27 files / 250 tests before this
  session; +2 files / +18 tests, all new tests, zero baseline regressions)

npx eslint .
  PASSED — no errors or warnings

npx tsc --noEmit
  75 errors (was 73 before this session)
  +2 errors, both in the two new files that import the Material Prisma
  type (document-extraction.ts, document-extraction-guard.ts) — the exact
  same pre-existing "@prisma/client has no exported member" cascade every
  other file with a Prisma type import already has in this sandbox, because
  `prisma generate` cannot download its engine binary here (network
  restriction specific to this sandbox, not a real error — see below).
  Every other file's error count is unchanged from baseline.

npm run build
  NOT COMPLETED in this sandbox — next/font's Google Fonts fetch
  (fonts.googleapis.com) is blocked by this sandbox's network egress
  allowlist. This failure occurs in src/app/layout.tsx's font loading,
  before webpack compiles any file touched this session, and would occur
  identically on an unmodified checkout of this same commit — it is not
  caused by, or evidence against, the document extraction changes.
```

`npx prisma generate` also cannot complete in this sandbox
(`binaries.prisma.sh` is not reachable), which is why `@prisma/client`'s
generated types are stale/missing and account for the pre-existing 73/75
typecheck errors above. **Re-run `npm run test`, `npm run lint`, `npm run
typecheck`, and `npm run build` in the real development environment
(Nishant's machine, where `prisma generate` and Google Fonts are both
reachable) before treating this as fully validated** — this session's
results should read as "clean except for sandbox-only network
restrictions," not as a substitute for that real-environment run.

The previous session's full validation (before this session's changes),
run after cleaning stale Next.js build artifacts on Nishant's machine, was:

```text
npm.cmd run test    — PASSED, 27 test files, 250 tests
npm.cmd run lint    — PASSED, no errors or warnings
npm.cmd run typecheck — PASSED
npm.cmd run build   — PASSED, 34/34 static pages generated
```

The `/groups` build failure previously observed in an earlier session was a
stale `.next` artifact issue, resolved by removing `.next` and rebuilding;
no source change was needed.

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
- Follow-up document-processing work implemented real PDF/DOCX/PPTX text
  extraction (`pdfjs-dist`, `mammoth`, existing `jszip`), wired it into both
  upload-complete and Google Drive import, and connected it to the existing
  chunk/embed/index pipeline without creating a second RAG system or
  changing AssemblyAI/PPTX-viewer behavior. Uncommitted at end of session.

## Documentation guidance for future agents

- Treat the completed functionality sections above as authoritative.
- Do not re-add the old “PPTX unsupported” behavior.
- Do not remove the Google import retry/polling behavior.
- Do not change AssemblyAI back to a Pro model.
- Do not implement PDF/DOCX/PPTX RAG extraction by bypassing the existing
  ingestion/retrieval architecture — it is now implemented; extend it in
  place rather than replacing it.
- Do not reintroduce `pdf-parse` for PDF extraction — it was tried and
  rejected in this session because its vendored pdf.js snapshot fails to
  parse valid PDFs (see "Document text extraction" above). Use `pdfjs-dist`.
- Do not upgrade `pdfjs-dist` past `4.8.x` without also raising this
  project's stated Node engine floor above `18.18.0` — `4.9.0+` requires
  Node `>=20`.
- Do not make document extraction a manually-triggered action like audio
  transcription — it has no external cost, so it should stay automatic.
- Read `ARCHITECTURE.md` and `CLAUDE.md` before modifying application code.
