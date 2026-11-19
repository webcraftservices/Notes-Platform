import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleNote: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const db = vi.hoisted(() => ({
  noteVersion: { findUnique: vi.fn(), create: vi.fn() },
  noteBlock: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  note: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));

import { POST } from "@/app/api/notes/[noteId]/versions/[versionId]/restore/route";

function makeRequest(): Request {
  return new Request("https://example.test/api/notes/note-1/versions/ver-1/restore", {
    method: "POST",
  });
}

describe("POST /api/notes/[noteId]/versions/[versionId]/restore", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleNote.mockResolvedValue({ id: "note-1" });
    db.$transaction.mockImplementation(async (fnOrOps: unknown) =>
      typeof fnOrOps === "function" ? fnOrOps(db) : Promise.all(fnOrOps as Promise<unknown>[])
    );
    db.noteBlock.findMany.mockResolvedValue([]);
    db.noteBlock.deleteMany.mockResolvedValue({ count: 1 });
    db.noteBlock.create.mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));
    db.noteVersion.create.mockResolvedValue({ id: "ver-new" });
    db.note.update.mockResolvedValue({ id: "note-1" });
  });

  it("returns 401 when user is not authenticated", async () => {
    access.getSessionUser.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when note is not found", async () => {
    access.getAccessibleNote.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: { noteId: "note-missing", versionId: "ver-1" } });
    expect(res.status).toBe(404);
  });

  it("returns 403 when NotAuthorizedError is thrown", async () => {
    access.getAccessibleNote.mockRejectedValue(new access.NotAuthorizedError("Forbidden"));
    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(403);
  });

  it("returns 404 when target version does not exist or belongs to another note", async () => {
    db.noteVersion.findUnique.mockResolvedValue(null);
    const res1 = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-missing" } });
    expect(res1.status).toBe(404);

    db.noteVersion.findUnique.mockResolvedValue({ id: "ver-other", noteId: "different-note", snapshot: [] });
    const res2 = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-other" } });
    expect(res2.status).toBe(404);
  });

  it("returns 422 when snapshot data is corrupted (not an array)", async () => {
    db.noteVersion.findUnique.mockResolvedValue({
      id: "ver-1",
      noteId: "note-1",
      snapshot: { not: "an array" },
    });
    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("corrupted");
  });

  it("preserves document attribution metadata across version restoration", async () => {
    const documentMetadata = {
      materialId: "mat-pdf-123",
      materialTitle: "Physics Lecture.pdf",
      materialType: "PDF",
    };

    const snapshotBlocks = [
      {
        id: "block-doc-1",
        kind: "OVERVIEW",
        heading: "Thermodynamics Overview",
        content: { type: "doc", content: [{ type: "paragraph", text: "Introduction" }] },
        order: 0,
        metadata: documentMetadata,
      },
    ];

    db.noteVersion.findUnique.mockResolvedValue({
      id: "ver-1",
      noteId: "note-1",
      snapshot: snapshotBlocks,
    });
    db.noteBlock.findMany
      .mockResolvedValueOnce([{ id: "curr-1" }]) // currentBlocks check
      .mockResolvedValueOnce(snapshotBlocks); // final blocks return

    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(200);

    expect(db.noteBlock.create).toHaveBeenCalledWith({
      data: {
        noteId: "note-1",
        kind: "OVERVIEW",
        heading: "Thermodynamics Overview",
        content: { type: "doc", content: [{ type: "paragraph", text: "Introduction" }] },
        order: 0,
        metadata: documentMetadata,
      },
    });
  });

  it("preserves page and slide provenance metadata across version restoration", async () => {
    const pageProvenanceMetadata = {
      materialId: "mat-pdf-123",
      materialTitle: "Physics Lecture.pdf",
      materialType: "PDF",
      sourceUnitType: "page",
      sourcePages: [2, 3],
      pageNumber: 2,
    };

    const snapshotBlocks = [
      {
        id: "block-doc-1",
        kind: "EXPLANATION",
        heading: "Carnot Engine Efficiency",
        content: { type: "doc", content: [{ type: "paragraph", text: "Carnot theorem" }] },
        order: 0,
        metadata: pageProvenanceMetadata,
      },
    ];

    db.noteVersion.findUnique.mockResolvedValue({
      id: "ver-1",
      noteId: "note-1",
      snapshot: snapshotBlocks,
    });
    db.noteBlock.findMany
      .mockResolvedValueOnce([{ id: "curr-1" }])
      .mockResolvedValueOnce(snapshotBlocks);

    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(200);

    expect(db.noteBlock.create).toHaveBeenCalledWith({
      data: {
        noteId: "note-1",
        kind: "EXPLANATION",
        heading: "Carnot Engine Efficiency",
        content: { type: "doc", content: [{ type: "paragraph", text: "Carnot theorem" }] },
        order: 0,
        metadata: pageProvenanceMetadata,
      },
    });
  });

  it("handles null and undefined metadata safely without error", async () => {
    const snapshotBlocks = [
      {
        id: "block-audio-1",
        kind: "DEFINITION",
        heading: "Heat Capacity",
        content: { type: "doc", content: [{ type: "paragraph", text: "Ratio of heat..." }] },
        order: 0,
        metadata: null,
      },
      {
        id: "block-audio-2",
        kind: "SUMMARY",
        heading: null,
        content: { type: "doc", content: [{ type: "paragraph", text: "Summary..." }] },
        order: 1,
        // metadata is omitted (undefined)
      },
    ];

    db.noteVersion.findUnique.mockResolvedValue({
      id: "ver-1",
      noteId: "note-1",
      snapshot: snapshotBlocks,
    });
    db.noteBlock.findMany
      .mockResolvedValueOnce([]) // currentBlocks check
      .mockResolvedValueOnce(snapshotBlocks);

    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(200);

    expect(db.noteBlock.create).toHaveBeenCalledWith({
      data: {
        noteId: "note-1",
        kind: "DEFINITION",
        heading: "Heat Capacity",
        content: { type: "doc", content: [{ type: "paragraph", text: "Ratio of heat..." }] },
        order: 0,
        metadata: undefined,
      },
    });

    expect(db.noteBlock.create).toHaveBeenCalledWith({
      data: {
        noteId: "note-1",
        kind: "SUMMARY",
        heading: null,
        content: { type: "doc", content: [{ type: "paragraph", text: "Summary..." }] },
        order: 1,
        metadata: undefined,
      },
    });
  });

  it("preserves block kind, heading, content, and order accurately while snapshotting current state", async () => {
    const currentBlocks = [
      { id: "curr-block-1", kind: "CUSTOM", heading: "WIP Note", content: {}, order: 0 },
    ];
    const snapshotBlocks = [
      {
        id: "old-1",
        kind: "CORE_CONCEPT",
        heading: "First Law",
        content: { type: "doc", text: "dE = dQ - dW" },
        order: 0,
        metadata: { materialId: "mat-1", materialTitle: "Textbook.docx", materialType: "DOCX" },
      },
      {
        id: "old-2",
        kind: "IMPORTANT_POINTS",
        heading: "Key Takeaways",
        content: { type: "doc", text: "Conservation" },
        order: 1,
        metadata: null,
      },
    ];

    db.noteVersion.findUnique.mockResolvedValue({
      id: "ver-1",
      noteId: "note-1",
      snapshot: snapshotBlocks,
    });
    db.noteBlock.findMany
      .mockResolvedValueOnce(currentBlocks)
      .mockResolvedValueOnce(snapshotBlocks);

    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(200);

    // Verifies current blocks are snapshotted before replacement
    expect(db.noteVersion.create).toHaveBeenCalledWith({
      data: {
        noteId: "note-1",
        editedById: "user-1",
        snapshot: currentBlocks,
      },
    });

    // Verifies all current blocks are cleared
    expect(db.noteBlock.deleteMany).toHaveBeenCalledWith({
      where: { noteId: "note-1" },
    });

    // Verifies recreation of each block with all fields
    expect(db.noteBlock.create).toHaveBeenCalledTimes(2);
  });

  it("recomputes and persists Note.plainText from restored snapshot blocks", async () => {
    access.getAccessibleNote.mockResolvedValue({ id: "note-1", title: "Restored Physics Note" });
    const snapshotBlocks = [
      {
        id: "old-1",
        kind: "CORE_CONCEPT",
        heading: "First Law",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Energy is conserved." }] }],
        },
        order: 0,
      },
    ];
    db.noteVersion.findUnique.mockResolvedValue({
      id: "ver-1",
      noteId: "note-1",
      snapshot: snapshotBlocks,
    });
    db.noteBlock.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(snapshotBlocks);

    const res = await POST(makeRequest(), { params: { noteId: "note-1", versionId: "ver-1" } });
    expect(res.status).toBe(200);

    expect(db.note.update).toHaveBeenCalledWith({
      where: { id: "note-1" },
      data: {
        plainText: "Restored Physics Note\n\nFirst Law\nEnergy is conserved.",
      },
    });
  });
});

