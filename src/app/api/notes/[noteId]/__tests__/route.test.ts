import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleNote: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const noteEmbedding = vi.hoisted(() => ({
  syncNoteSearchIndex: vi.fn().mockResolvedValue({ chunkCount: 1, embedded: true }),
  deleteNoteChunks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/search/note-embedding", () => noteEmbedding);

const db = vi.hoisted(() => ({
  noteBlock: { findMany: vi.fn() },
  note: { update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { PATCH, DELETE } from "@/app/api/notes/[noteId]/route";

describe("PATCH & DELETE /api/notes/[noteId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleNote.mockResolvedValue({
      id: "note-1",
      title: "Original Title",
      topicId: "top-1",
    });
    db.noteBlock.findMany.mockResolvedValue([
      {
        heading: "Key Concept",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Body content here." }] }],
        },
        order: 0,
      },
    ]);
    db.note.update.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: "note-1", ...(data as object) })
    );
  });

  it("PATCH recomputes Note.plainText with updated title and syncs NoteChunk embeddings", async () => {
    const req = new Request("https://example.test/api/notes/note-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Note Title" }),
    });

    const res = await PATCH(req, { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);

    const expectedPlainText = "Renamed Note Title\n\nKey Concept\nBody content here.";
    expect(db.note.update).toHaveBeenCalledWith({
      where: { id: "note-1" },
      data: {
        title: "Renamed Note Title",
        plainText: expectedPlainText,
      },
    });
    expect(noteEmbedding.syncNoteSearchIndex).toHaveBeenCalledWith(
      "note-1",
      expectedPlainText,
      { userId: "user-1" }
    );
  });

  it("DELETE soft-deletes the note and immediately purges its NoteChunk embeddings", async () => {
    const req = new Request("https://example.test/api/notes/note-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: { noteId: "note-1" } });
    expect(res.status).toBe(200);

    expect(db.note.update).toHaveBeenCalledWith({
      where: { id: "note-1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(noteEmbedding.deleteNoteChunks).toHaveBeenCalledWith("note-1");
  });
});
