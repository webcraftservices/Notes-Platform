import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleNote: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const db = vi.hoisted(() => ({
  noteBlock: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  noteVersion: { findFirst: vi.fn(), create: vi.fn() },
  note: { update: vi.fn() },
  topic: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));

import { PUT } from "@/app/api/notes/[noteId]/blocks/route";

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/api/notes/note-1/blocks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/notes/[noteId]/blocks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleNote.mockResolvedValue({ id: "note-1", topicId: null });
    db.noteBlock.findMany.mockResolvedValue([]);
    db.noteVersion.findFirst.mockResolvedValue(null);
    db.$transaction.mockImplementation(async (fnOrOps: unknown) =>
      typeof fnOrOps === "function" ? fnOrOps(db) : []
    );
  });

  const validBlock = {
    id: "block-1",
    kind: "OVERVIEW",
    heading: "Intro",
    content: { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left" } }] },
    order: 0,
  };

  it("accepts an ordinary save with well-formed Tiptap content", async () => {
    const res = await PUT(makeRequest({ blocks: [validBlock] }), { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalled();
  });

  /**
   * Phase 9.3 — the flagship finding: NoteBlock.content previously accepted
   * arbitrary JSON with no shape restriction, and is rendered through
   * Tiptap (vulnerable to GHSA-cp6q-959q-f8rh below v3.30.4, which we run)
   * for every viewer of the note — including other members of a shared
   * Group. This is a real, evidence-confirmed stored-XSS input, not a
   * speculative one; see lib/validation/safe-json.ts.
   */
  it("rejects a block whose content contains a __proto__ key nested in a node's attrs (the real Tiptap CVE shape), without ever reaching the database", async () => {
    const malicious = {
      ...validBlock,
      content: JSON.parse(
        '{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":{"onerror":"alert(document.cookie)"}}}]}'
      ),
    };

    const res = await PUT(makeRequest({ blocks: [malicious] }), { params: { noteId: "note-1" } });

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(access.getAccessibleNote).not.toHaveBeenCalled();
  });

  it("rejects a block with a 'constructor'/'prototype' key anywhere in its content", async () => {
    const malicious = { ...validBlock, content: { attrs: { constructor: { prototype: { polluted: true } } } } };

    const res = await PUT(makeRequest({ blocks: [malicious] }), { params: { noteId: "note-1" } });

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("preserves existing server-owned provenance metadata during update even if client attempts to alter it", async () => {
    const existingProvenance = {
      materialId: "mat-real-123",
      materialTitle: "Real Lecture.pdf",
      materialType: "PDF",
      sourceUnitType: "page",
      sourcePages: [1, 2],
      pageNumber: 1,
    };

    db.noteBlock.findMany.mockResolvedValue([
      { ...validBlock, id: "block-1", metadata: existingProvenance },
    ]);

    // Client attempts to tamper with materialId and page numbers, while adding a user tag
    const clientPayload = {
      blocks: [
        {
          ...validBlock,
          id: "block-1",
          metadata: {
            materialId: "forged-id-999",
            sourcePages: [999],
            userAnnotation: "my note",
          },
        },
      ],
    };

    const res = await PUT(makeRequest(clientPayload), { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);

    expect(db.noteBlock.update).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({
        metadata: {
          materialId: "mat-real-123", // preserved from DB
          materialTitle: "Real Lecture.pdf", // preserved from DB
          materialType: "PDF", // preserved from DB
          sourceUnitType: "page", // preserved from DB
          sourcePages: [1, 2], // preserved from DB
          pageNumber: 1, // preserved from DB
          userAnnotation: "my note", // allowed custom client field
        },
      }),
    });
  });

  it("preserves existing server-owned provenance metadata when client sends metadata: null or omits metadata", async () => {
    const existingProvenance = {
      materialId: "mat-real-123",
      materialTitle: "Real Lecture.pdf",
      materialType: "PDF",
      sourceUnitType: "page",
      sourcePages: [1, 2],
      pageNumber: 1,
    };

    db.noteBlock.findMany.mockResolvedValue([
      { ...validBlock, id: "block-1", metadata: existingProvenance },
    ]);

    // Client sends metadata: null
    const clientPayload = {
      blocks: [
        {
          ...validBlock,
          id: "block-1",
          metadata: null,
        },
      ],
    };

    const res = await PUT(makeRequest(clientPayload), { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);

    expect(db.noteBlock.update).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({
        metadata: {
          materialId: "mat-real-123",
          materialTitle: "Real Lecture.pdf",
          materialType: "PDF",
          sourceUnitType: "page",
          sourcePages: [1, 2],
          pageNumber: 1,
        },
      }),
    });
  });

  it("strips server-owned provenance keys when client creates brand new blocks to prevent forgery", async () => {
    db.noteBlock.findMany.mockResolvedValue([]); // No existing blocks

    const newBlockWithForgedMeta = {
      ...validBlock,
      id: "brand-new-client-id",
      metadata: {
        materialId: "forged-material-id",
        materialTitle: "Forged Title",
        sourcePages: [1, 2],
        customClientField: "allowed",
      },
    };

    const res = await PUT(makeRequest({ blocks: [newBlockWithForgedMeta] }), { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);

    expect(db.noteBlock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          customClientField: "allowed",
        },
      }),
    });
  });

  it("rejects a block whose metadata contains prototype pollution", async () => {
    const malicious = {
      ...validBlock,
      metadata: { constructor: { prototype: { polluted: true } } },
    };

    const res = await PUT(makeRequest({ blocks: [malicious] }), { params: { noteId: "note-1" } });
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    access.getSessionUser.mockResolvedValue(null);
    const res = await PUT(makeRequest({ blocks: [validBlock] }), { params: { noteId: "note-1" } });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the note isn't accessible to this user", async () => {
    access.getAccessibleNote.mockImplementation(() => {
      throw new access.NotAuthorizedError();
    });
    const res = await PUT(makeRequest({ blocks: [validBlock] }), { params: { noteId: "note-1" } });
    expect(res.status).toBe(403);
  });

  it("updates Note.plainText in db.$transaction alongside block changes", async () => {
    access.getAccessibleNote.mockResolvedValue({ id: "note-1", title: "My Test Note", topicId: null });
    const block = {
      id: "block-1",
      kind: "OVERVIEW",
      heading: "Summary",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Summary text." }] }],
      },
      order: 0,
    };

    const res = await PUT(makeRequest({ blocks: [block] }), { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);

    expect(db.note.update).toHaveBeenCalledWith({
      where: { id: "note-1" },
      data: {
        plainText: "My Test Note\n\nSummary\nSummary text.",
      },
    });
  });
});
