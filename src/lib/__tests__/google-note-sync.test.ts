import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteBlockKind } from "@prisma/client";

vi.mock("@prisma/client", () => ({
  Prisma: {
    DbNull: Symbol("DbNull"),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (rows: unknown[]) => ({ rows }),
  },
}));

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(1),
  note: { findUnique: vi.fn(), update: vi.fn() },
  noteBlock: { deleteMany: vi.fn(), createMany: vi.fn() },
  noteVersion: { create: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  note: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const notesAccess = vi.hoisted(() => ({
  getAccessibleNote: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => notesAccess);

const searchIndexMocks = vi.hoisted(() => ({
  syncNoteSearchIndex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/search/note-embedding", () => searchIndexMocks);

const connectionMocks = vi.hoisted(() => ({
  getValidGoogleAccessToken: vi.fn().mockResolvedValue("ya29.valid-token"),
}));
vi.mock("@/lib/google-connection", () => connectionMocks);

const importMocks = vi.hoisted(() => ({
  assertGoogleDriveSyncAllowed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/google-import", () => importMocks);

const driveMocks = vi.hoisted(() => ({
  getFileSyncMetadata: vi.fn(),
}));
vi.mock("@/lib/services/google-drive", () => ({
  getGoogleDriveService: () => driveMocks,
}));

const docsServiceMocks = vi.hoisted(() => ({
  createGoogleDocument: vi.fn(),
  getGoogleDocument: vi.fn(),
  batchUpdateGoogleDocument: vi.fn(),
}));
vi.mock("@/lib/services/google-docs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/google-docs")>();
  return {
    ...actual,
    createGoogleDocument: docsServiceMocks.createGoogleDocument,
    getGoogleDocument: docsServiceMocks.getGoogleDocument,
    batchUpdateGoogleDocument: docsServiceMocks.batchUpdateGoogleDocument,
  };
});

import {
  exportOrSyncNoteWithGoogleDocs,
  NoteNotFoundOrForbiddenError,
} from "../google-note-sync";
import {
  computeLocalNoteSyncHash,
  type GoogleDocDocument,
} from "../services/google-docs";
import {
  GoogleApiError,
  GoogleRevisionConflictError,
  GOOGLE_TEMPORARILY_UNAVAILABLE,
} from "../services/google-errors";

function makeTiptapParagraph(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function makeGoogleDoc(
  documentId: string,
  title: string,
  sectionHeading: string,
  bodyLine: string,
  revisionId = "rev-1"
): GoogleDocDocument {
  return {
    documentId,
    title,
    revisionId,
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: title.length + 2,
          paragraph: {
            paragraphStyle: { namedStyleType: "HEADING_1" },
            elements: [{ textRun: { content: `${title}\n` } }],
          },
        },
        {
          startIndex: title.length + 2,
          endIndex: title.length + sectionHeading.length + 3,
          paragraph: {
            paragraphStyle: { namedStyleType: "HEADING_2" },
            elements: [{ textRun: { content: `${sectionHeading}\n` } }],
          },
        },
        {
          startIndex: title.length + sectionHeading.length + 3,
          endIndex: title.length + sectionHeading.length + bodyLine.length + 4,
          paragraph: {
            paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
            elements: [{ textRun: { content: `${bodyLine}\n` } }],
          },
        },
      ],
    },
  };
}

describe("Bidirectional Google Docs Export & Synchronization (Task 14-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    notesAccess.getAccessibleNote.mockResolvedValue({ canWrite: true });
    connectionMocks.getValidGoogleAccessToken.mockResolvedValue("ya29.valid-token");
    importMocks.assertGoogleDriveSyncAllowed.mockResolvedValue(undefined);
  });

  it("exports an unlinked Zenote Note to Google Docs and persists externalRef metadata", async () => {
    const blocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Initial note overview"),
        order: 0,
      },
    ];
    db.note.findUnique.mockResolvedValueOnce({
      id: "note-1",
      title: "Thermodynamics Notes",
      deletedAt: null,
      externalRef: null,
      blocks,
    });
    tx.note.findUnique.mockResolvedValueOnce({ id: "note-1", externalRef: null });

    docsServiceMocks.createGoogleDocument.mockResolvedValueOnce({
      documentId: "gdoc-100",
      title: "Thermodynamics Notes",
      revisionId: "rev-initial",
      body: { content: [{ startIndex: 1, endIndex: 2 }] },
    });
    docsServiceMocks.batchUpdateGoogleDocument.mockResolvedValueOnce({
      documentId: "gdoc-100",
    });
    docsServiceMocks.getGoogleDocument.mockResolvedValueOnce(
      makeGoogleDoc(
        "gdoc-100",
        "Thermodynamics Notes",
        "Overview",
        "Initial note overview",
        "rev-after-write"
      )
    );
    driveMocks.getFileSyncMetadata.mockResolvedValueOnce({
      id: "gdoc-100",
      name: "Thermodynamics Notes",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-12T12:00:00.000Z",
      webViewLink: "https://docs.google.com/document/d/gdoc-100/edit",
    });

    const res = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");

    expect(res.status).toBe("exported");
    expect(res.externalRef).toMatchObject({
      provider: "google_docs",
      documentId: "gdoc-100",
      webViewLink: "https://docs.google.com/document/d/gdoc-100/edit",
      revisionId: "rev-after-write",
      syncStatus: "SYNCED",
      conflict: null,
    });
    expect(docsServiceMocks.createGoogleDocument).toHaveBeenCalledWith({
      accessToken: "ya29.valid-token",
      title: "Thermodynamics Notes",
    });
    expect(docsServiceMocks.batchUpdateGoogleDocument).toHaveBeenCalledTimes(1);
    expect(tx.note.update).toHaveBeenCalledTimes(1);
  });

  it("suppresses echo loops when neither local nor remote canonical content has changed since the last sync", async () => {
    const blocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Synced content"),
        order: 0,
      },
    ];
    const syncedHash = computeLocalNoteSyncHash("My Note", blocks);

    db.note.findUnique.mockResolvedValueOnce({
      id: "note-1",
      title: "My Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-100",
        webViewLink: "https://docs.google.com/document/d/gdoc-100/edit",
        revisionId: "rev-1",
        modifiedTime: "2026-11-12T12:00:00.000Z",
        lastSyncedLocalHash: syncedHash,
        lastSyncedRemoteHash: syncedHash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks,
    });

    docsServiceMocks.getGoogleDocument.mockResolvedValueOnce(
      makeGoogleDoc("gdoc-100", "My Note", "Overview", "Synced content", "rev-2")
    );
    driveMocks.getFileSyncMetadata.mockResolvedValueOnce({
      id: "gdoc-100",
      name: "My Note",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-12T12:00:05.000Z",
    });

    const res = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");

    expect(res.status).toBe("unchanged");
    expect(res.echoSuppressed).toBe(true);
    expect(docsServiceMocks.batchUpdateGoogleDocument).not.toHaveBeenCalled();
    expect(tx.noteBlock.deleteMany).not.toHaveBeenCalled();
  });

  it("pushes subsequent local Zenote edits to the linked Google Doc when remote is unchanged", async () => {
    const originalBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Original text"),
        order: 0,
      },
    ];
    const originalHash = computeLocalNoteSyncHash("My Note", originalBlocks);

    const updatedLocalBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Edited locally in Zenote"),
        order: 0,
      },
    ];

    db.note.findUnique.mockResolvedValueOnce({
      id: "note-1",
      title: "My Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-100",
        webViewLink: "https://docs.google.com/document/d/gdoc-100/edit",
        revisionId: "rev-1",
        modifiedTime: "2026-11-12T12:00:00.000Z",
        lastSyncedLocalHash: originalHash,
        lastSyncedRemoteHash: originalHash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks: updatedLocalBlocks,
    });

    // Remote still has original text
    docsServiceMocks.getGoogleDocument
      .mockResolvedValueOnce(
        makeGoogleDoc("gdoc-100", "My Note", "Overview", "Original text", "rev-1")
      )
      .mockResolvedValueOnce(
        makeGoogleDoc("gdoc-100", "My Note", "Overview", "Edited locally in Zenote", "rev-2")
      );
    driveMocks.getFileSyncMetadata.mockResolvedValue({
      id: "gdoc-100",
      name: "My Note",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-12T12:10:00.000Z",
    });
    docsServiceMocks.batchUpdateGoogleDocument.mockResolvedValueOnce({
      documentId: "gdoc-100",
    });

    const res = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");

    expect(res.status).toBe("pushed");
    expect(docsServiceMocks.batchUpdateGoogleDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "gdoc-100",
        requiredRevisionId: "rev-1",
      })
    );
    expect(res.externalRef.syncStatus).toBe("SYNCED");
  });

  it("pulls remote Google Doc edits into Zenote NoteBlocks, snapshots NoteVersion, and triggers Phase 12 syncNoteSearchIndex", async () => {
    const originalBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Original text"),
        order: 0,
      },
    ];
    const originalHash = computeLocalNoteSyncHash("My Note", originalBlocks);

    db.note.findUnique.mockResolvedValueOnce({
      id: "note-1",
      title: "My Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-100",
        webViewLink: "https://docs.google.com/document/d/gdoc-100/edit",
        revisionId: "rev-1",
        modifiedTime: "2026-11-12T12:00:00.000Z",
        lastSyncedLocalHash: originalHash,
        lastSyncedRemoteHash: originalHash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks: originalBlocks,
    });

    // Remote doc has new edits while local is still at originalHash
    docsServiceMocks.getGoogleDocument.mockResolvedValueOnce(
      makeGoogleDoc(
        "gdoc-100",
        "My Note",
        "Overview",
        "Edited remotely in Google Docs",
        "rev-remote-3"
      )
    );
    driveMocks.getFileSyncMetadata.mockResolvedValueOnce({
      id: "gdoc-100",
      name: "My Note",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-12T12:20:00.000Z",
    });

    const res = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");

    expect(res.status).toBe("pulled");
    expect(tx.noteVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.noteBlock.deleteMany).toHaveBeenCalledWith({ where: { noteId: "note-1" } });
    expect(tx.noteBlock.createMany).toHaveBeenCalledTimes(1);
    expect(searchIndexMocks.syncNoteSearchIndex).toHaveBeenCalledWith(
      "note-1",
      expect.any(String),
      { userId: "user-1" }
    );
  });

  it("detects conflicts when both local Zenote Note and remote Google Doc changed since the last sync, and resolves via keep_local or accept_remote", async () => {
    const baseBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Base text"),
        order: 0,
      },
    ];
    const baseHash = computeLocalNoteSyncHash("My Note", baseBlocks);

    const localEditedBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Local divergent edit"),
        order: 0,
      },
    ];

    const noteRow = {
      id: "note-1",
      title: "My Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-100",
        webViewLink: "https://docs.google.com/document/d/gdoc-100/edit",
        revisionId: "rev-1",
        modifiedTime: "2026-11-12T12:00:00.000Z",
        lastSyncedLocalHash: baseHash,
        lastSyncedRemoteHash: baseHash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks: localEditedBlocks,
    };

    db.note.findUnique.mockResolvedValue(noteRow);
    docsServiceMocks.getGoogleDocument.mockResolvedValue(
      makeGoogleDoc("gdoc-100", "My Note", "Overview", "Remote divergent edit", "rev-remote-9")
    );
    driveMocks.getFileSyncMetadata.mockResolvedValue({
      id: "gdoc-100",
      name: "My Note",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-12T12:30:00.000Z",
    });

    // 1. Auto sync detects conflict without overwriting either side
    const conflictRes = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");
    expect(conflictRes.status).toBe("conflict");
    expect(conflictRes.externalRef.syncStatus).toBe("CONFLICT");
    expect(conflictRes.externalRef.conflict).not.toBeNull();
    expect(docsServiceMocks.batchUpdateGoogleDocument).not.toHaveBeenCalled();
    expect(tx.noteBlock.deleteMany).not.toHaveBeenCalled();

    // 2. Explicit resolution: keep_local pushes local version to Google Docs
    docsServiceMocks.batchUpdateGoogleDocument.mockResolvedValueOnce({ documentId: "gdoc-100" });
    const keepLocalRes = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1", {
      forceResolution: "keep_local",
    });
    expect(keepLocalRes.status).toBe("pushed");
    expect(keepLocalRes.externalRef.syncStatus).toBe("SYNCED");
    expect(keepLocalRes.externalRef.conflict).toBeNull();

    // 3. Explicit resolution: accept_remote pulls remote version into Zenote NoteBlocks
    const acceptRemoteRes = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1", {
      forceResolution: "accept_remote",
    });
    expect(acceptRemoteRes.status).toBe("pulled");
    expect(acceptRemoteRes.externalRef.syncStatus).toBe("SYNCED");
  });

  it("handles writeControl revision conflicts, transient 503 retries, 404 deleted remote docs, and cross-user authorization", async () => {
    // 1. Cross-user / forbidden access rejected before any Google API calls
    notesAccess.getAccessibleNote.mockResolvedValueOnce({ canWrite: false });
    await expect(exportOrSyncNoteWithGoogleDocs("note-1", "viewer-user")).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<NoteNotFoundOrForbiddenError>);
    expect(docsServiceMocks.getGoogleDocument).not.toHaveBeenCalled();

    // 2. Remote 404 marks REMOTE_DELETED without deleting local note
    const blocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Text"),
        order: 0,
      },
    ];
    const hash = computeLocalNoteSyncHash("My Note", blocks);
    db.note.findUnique.mockResolvedValue({
      id: "note-1",
      title: "My Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-deleted",
        webViewLink: null,
        revisionId: "rev-1",
        modifiedTime: null,
        lastSyncedLocalHash: hash,
        lastSyncedRemoteHash: hash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks,
    });

    docsServiceMocks.getGoogleDocument.mockRejectedValueOnce(
      new GoogleApiError("Not found", { status: 404, publicMessage: "Not found" })
    );
    const deletedRes = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");
    expect(deletedRes.status).toBe("remote_deleted");
    expect(deletedRes.externalRef.syncStatus).toBe("REMOTE_DELETED");

    // 3. Transient 503 retry followed by writeControl GoogleRevisionConflictError
    const editedBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Local change"),
        order: 0,
      },
    ];
    db.note.findUnique.mockResolvedValue({
      id: "note-1",
      title: "My Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-100",
        webViewLink: null,
        revisionId: "rev-1",
        modifiedTime: null,
        lastSyncedLocalHash: hash,
        lastSyncedRemoteHash: hash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks: editedBlocks,
    });

    docsServiceMocks.getGoogleDocument
      .mockRejectedValueOnce(
        new GoogleApiError("503 transient", {
          status: 503,
          publicMessage: GOOGLE_TEMPORARILY_UNAVAILABLE,
        })
      )
      .mockResolvedValueOnce(makeGoogleDoc("gdoc-100", "My Note", "Overview", "Text", "rev-1"));
    driveMocks.getFileSyncMetadata.mockResolvedValueOnce(null);
    docsServiceMocks.batchUpdateGoogleDocument.mockRejectedValueOnce(
      new GoogleRevisionConflictError()
    );

    const revConflict = await exportOrSyncNoteWithGoogleDocs("note-1", "user-1");
    expect(revConflict.status).toBe("conflict");
    expect(revConflict.externalRef.syncStatus).toBe("CONFLICT");
  });

  it("prevents two simultaneous initial export requests from creating duplicate Google Docs for the same note", async () => {
    const blocks = [
      {
        id: "b-sim",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Simultaneous export body"),
        order: 0,
      },
    ];

    let persistedExternalRef: unknown = null;
    db.note.findUnique.mockImplementation(async () => ({
      id: "note-simultaneous",
      title: "Simultaneous Note",
      deletedAt: null,
      externalRef: persistedExternalRef,
      blocks,
    }));
    db.note.update.mockImplementation(async ({ data }: { data: { externalRef?: unknown } }) => {
      if (data.externalRef !== undefined) {
        persistedExternalRef = data.externalRef;
      }
      return { id: "note-simultaneous", externalRef: persistedExternalRef };
    });
    tx.note.findUnique.mockImplementation(async () => ({
      id: "note-simultaneous",
      externalRef: persistedExternalRef,
    }));
    tx.note.update.mockImplementation(async ({ data }: { data: { externalRef?: unknown } }) => {
      if (data.externalRef !== undefined) {
        persistedExternalRef = data.externalRef;
      }
      return { id: "note-simultaneous", externalRef: persistedExternalRef };
    });

    docsServiceMocks.createGoogleDocument.mockResolvedValue({
      documentId: "gdoc-single-only",
      title: "Simultaneous Note",
      revisionId: "rev-1",
      body: { content: [{ startIndex: 1, endIndex: 2 }] },
    });
    docsServiceMocks.batchUpdateGoogleDocument.mockResolvedValue({
      documentId: "gdoc-single-only",
    });
    docsServiceMocks.getGoogleDocument.mockResolvedValue(
      makeGoogleDoc(
        "gdoc-single-only",
        "Simultaneous Note",
        "Overview",
        "Simultaneous export body",
        "rev-2"
      )
    );
    driveMocks.getFileSyncMetadata.mockResolvedValue({
      id: "gdoc-single-only",
      name: "Simultaneous Note",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-13T10:00:00.000Z",
      webViewLink: "https://docs.google.com/document/d/gdoc-single-only/edit",
    });

    const [resA, resB] = await Promise.all([
      exportOrSyncNoteWithGoogleDocs("note-simultaneous", "user-1"),
      exportOrSyncNoteWithGoogleDocs("note-simultaneous", "user-1"),
    ]);

    // Exactly ONE Google Doc is created; the second serialized call sees the synced state
    expect(docsServiceMocks.createGoogleDocument).toHaveBeenCalledTimes(1);
    expect(resA.status).toBe("exported");
    expect(resB.status).toBe("unchanged");
    expect(resA.externalRef.documentId).toBe("gdoc-single-only");
    expect(resB.externalRef.documentId).toBe("gdoc-single-only");
  });

  it("recovers safely without creating a duplicate Google Doc when Google document creation succeeds but the local database transaction fails", async () => {
    const blocks = [
      {
        id: "b-rec",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Recovery test content"),
        order: 0,
      },
    ];

    let persistedExternalRef: unknown = null;
    db.note.findUnique.mockImplementation(async () => ({
      id: "note-db-fail-recovery",
      title: "DB Failure Recovery Note",
      deletedAt: null,
      externalRef: persistedExternalRef,
      blocks,
    }));
    // Simulate final transaction failing on the first attempt after Google Doc creation
    db.$transaction.mockRejectedValueOnce(new Error("DB connection lost during final commit"));

    docsServiceMocks.createGoogleDocument.mockResolvedValue({
      documentId: "gdoc-recovered-1",
      title: "DB Failure Recovery Note",
      revisionId: "rev-init",
      body: { content: [{ startIndex: 1, endIndex: 2 }] },
    });
    docsServiceMocks.batchUpdateGoogleDocument.mockResolvedValue({
      documentId: "gdoc-recovered-1",
    });
    docsServiceMocks.getGoogleDocument.mockResolvedValue(
      makeGoogleDoc(
        "gdoc-recovered-1",
        "DB Failure Recovery Note",
        "Overview",
        "Recovery test content",
        "rev-after"
      )
    );
    driveMocks.getFileSyncMetadata.mockResolvedValue({
      id: "gdoc-recovered-1",
      name: "DB Failure Recovery Note",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-13T11:00:00.000Z",
      webViewLink: "https://docs.google.com/document/d/gdoc-recovered-1/edit",
    });

    // Attempt 1 fails when committing to PostgreSQL after Google Doc creation
    await expect(
      exportOrSyncNoteWithGoogleDocs("note-db-fail-recovery", "user-1")
    ).rejects.toThrow("DB connection lost during final commit");
    expect(docsServiceMocks.createGoogleDocument).toHaveBeenCalledTimes(1);

    // Attempt 2 after DB recovers: reuses "gdoc-recovered-1" without calling createGoogleDocument again
    tx.note.findUnique.mockResolvedValueOnce({
      id: "note-db-fail-recovery",
      externalRef: null,
    });
    tx.note.update.mockImplementationOnce(async ({ data }: { data: { externalRef?: unknown } }) => {
      persistedExternalRef = data.externalRef;
      return { id: "note-db-fail-recovery", externalRef: persistedExternalRef };
    });

    const retryRes = await exportOrSyncNoteWithGoogleDocs("note-db-fail-recovery", "user-1");
    expect(retryRes.status).toBe("exported");
    expect(retryRes.externalRef.documentId).toBe("gdoc-recovered-1");
    expect(docsServiceMocks.createGoogleDocument).toHaveBeenCalledTimes(1);
  });

  it("detects concurrent local edits made while remote Google Doc fetch is in flight and transitions to CONFLICT instead of overwriting newer local blocks", async () => {
    const initialBlocks = [
      {
        id: "b-race",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Initial synced text"),
        order: 0,
      },
    ];
    const initialHash = computeLocalNoteSyncHash("Race Note", initialBlocks);

    const newerLocalBlocks = [
      {
        id: "b-race",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Newer local edit saved during remote fetch"),
        order: 0,
      },
    ];

    // Outside lock before remote fetch: sees initialBlocks
    db.note.findUnique.mockResolvedValueOnce({
      id: "note-race",
      title: "Race Note",
      deletedAt: null,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-race",
        webViewLink: null,
        revisionId: "rev-1",
        modifiedTime: null,
        lastSyncedLocalHash: initialHash,
        lastSyncedRemoteHash: initialHash,
        lastSyncedAt: "2026-11-13T10:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks: initialBlocks,
    });

    // Remote doc also changed
    docsServiceMocks.getGoogleDocument.mockResolvedValueOnce(
      makeGoogleDoc("gdoc-race", "Race Note", "Overview", "Remote edit", "rev-2")
    );
    driveMocks.getFileSyncMetadata.mockResolvedValueOnce(null);

    // Inside advisory-locked transaction: local note has been edited to newerLocalBlocks
    tx.note.findUnique.mockResolvedValueOnce({
      id: "note-race",
      title: "Race Note",
      deletedAt: null,
      blocks: newerLocalBlocks,
    });

    const res = await exportOrSyncNoteWithGoogleDocs("note-race", "user-1");

    expect(res.status).toBe("conflict");
    expect(res.externalRef.syncStatus).toBe("CONFLICT");
    expect(tx.noteBlock.deleteMany).not.toHaveBeenCalled();
  });

  it("enforces Group FOR SHARE -> GroupMember FOR SHARE -> advisory lock on group note pulls and aborts cleanly with 403 if membership was revoked", async () => {
    const originalBlocks = [
      {
        id: "b1",
        kind: "OVERVIEW" as NoteBlockKind,
        heading: "Overview",
        content: makeTiptapParagraph("Original group text"),
        order: 0,
      },
    ];
    const originalHash = computeLocalNoteSyncHash("Group Note", originalBlocks);
    const groupNoteRow = {
      id: "note-grp-1",
      title: "Group Note",
      deletedAt: null,
      topic: {
        deletedAt: null,
        chapter: {
          deletedAt: null,
          subject: { deletedAt: null, groupId: "grp-1" },
        },
      },
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-grp-1",
        webViewLink: "https://docs.google.com/document/d/gdoc-grp-1/edit",
        revisionId: "rev-1",
        modifiedTime: "2026-11-12T12:00:00.000Z",
        lastSyncedLocalHash: originalHash,
        lastSyncedRemoteHash: originalHash,
        lastSyncedAt: "2026-11-12T12:00:00.000Z",
        syncStatus: "SYNCED",
        lastSyncError: null,
        conflict: null,
      },
      blocks: originalBlocks,
    };

    const lockSeq: string[] = [];
    const txWithQueryRaw = tx as typeof tx & { $queryRaw?: ReturnType<typeof vi.fn> };
    txWithQueryRaw.$queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        lockSeq.push("group_member_for_share");
        return [{ id: "gm-1" }];
      }
      lockSeq.push("group_for_share");
      return [{ id: "grp-1", deletedAt: null }];
    });
    tx.$executeRaw.mockImplementation(async (_strings: TemplateStringsArray, key: string) => {
      lockSeq.push(`advisory:${key}`);
      return 1;
    });

    try {
      db.note.findUnique.mockResolvedValueOnce(groupNoteRow);
      tx.note.findUnique.mockResolvedValueOnce({ ...groupNoteRow, blocks: originalBlocks });
      docsServiceMocks.getGoogleDocument.mockResolvedValueOnce(
        makeGoogleDoc("gdoc-grp-1", "Group Note", "Overview", "Remote group update", "rev-2")
      );
      driveMocks.getFileSyncMetadata.mockResolvedValueOnce(null);

      const okRes = await exportOrSyncNoteWithGoogleDocs("note-grp-1", "user-1");
      expect(okRes.status).toBe("pulled");
      expect(lockSeq).toEqual([
        "group_for_share",
        "group_member_for_share",
        "advisory:google-note-sync:note-grp-1",
      ]);

      // Now revoke membership concurrently before the pull transaction commits
      lockSeq.length = 0;
      tx.noteBlock.deleteMany.mockClear();
      db.note.findUnique.mockResolvedValueOnce(groupNoteRow);
      docsServiceMocks.getGoogleDocument.mockResolvedValueOnce(
        makeGoogleDoc("gdoc-grp-1", "Group Note", "Overview", "Remote group update 2", "rev-3")
      );
      driveMocks.getFileSyncMetadata.mockResolvedValueOnce(null);
      txWithQueryRaw.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes('FROM "GroupMember"')) {
          lockSeq.push("group_member_for_share");
          return [];
        }
        lockSeq.push("group_for_share");
        return [{ id: "grp-1", deletedAt: null }];
      });

      await expect(
        exportOrSyncNoteWithGoogleDocs("note-grp-1", "user-1")
      ).rejects.toMatchObject({ status: 403 });
      expect(lockSeq).toEqual(["group_for_share", "group_member_for_share"]);
      expect(tx.noteBlock.deleteMany).not.toHaveBeenCalled();
    } finally {
      delete txWithQueryRaw.$queryRaw;
    }
  });
});

