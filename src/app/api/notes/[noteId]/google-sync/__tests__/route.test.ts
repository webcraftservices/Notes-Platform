import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/access", () => accessMocks);

const noteSyncMocks = vi.hoisted(() => ({
  getNoteGoogleSyncState: vi.fn(),
  exportOrSyncNoteWithGoogleDocs: vi.fn(),
  NoteNotFoundOrForbiddenError: class NoteNotFoundOrForbiddenError extends Error {
    readonly status: number;
    constructor(message: string, status: number = 404) {
      super(message);
      this.name = "NoteNotFoundOrForbiddenError";
      this.status = status;
    }
  },
}));
vi.mock("@/lib/google-note-sync", () => noteSyncMocks);

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { GET, POST } from "../route";

describe("/api/notes/[noteId]/google-sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessMocks.getSessionUser.mockResolvedValue({ id: "user-1" });
  });

  it("GET returns 401 when unauthenticated and 200 with sync state when authorized", async () => {
    accessMocks.getSessionUser.mockResolvedValueOnce(null);
    const unauth = await GET(new Request("http://localhost/api/notes/n1/google-sync"), {
      params: { noteId: "n1" },
    });
    expect(unauth.status).toBe(401);

    noteSyncMocks.getNoteGoogleSyncState.mockResolvedValueOnce({
      linked: true,
      canWrite: true,
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-1",
        syncStatus: "SYNCED",
      },
      hasUnsyncedLocalChanges: false,
    });

    const okRes = await GET(new Request("http://localhost/api/notes/n1/google-sync"), {
      params: { noteId: "n1" },
    });
    expect(okRes.status).toBe(200);
    const data = await okRes.json();
    expect(data.linked).toBe(true);
  });

  it("POST returns 200 on export/sync and 409 when a conflict is detected", async () => {
    noteSyncMocks.exportOrSyncNoteWithGoogleDocs.mockResolvedValueOnce({
      status: "exported",
      noteId: "n1",
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-1",
        syncStatus: "SYNCED",
      },
    });

    const res = await POST(
      new Request("http://localhost/api/notes/n1/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "auto" }),
      }),
      { params: { noteId: "n1" } }
    );
    expect(res.status).toBe(200);

    noteSyncMocks.exportOrSyncNoteWithGoogleDocs.mockResolvedValueOnce({
      status: "conflict",
      noteId: "n1",
      externalRef: {
        provider: "google_docs",
        documentId: "gdoc-1",
        syncStatus: "CONFLICT",
      },
    });

    const conflictRes = await POST(
      new Request("http://localhost/api/notes/n1/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "auto" }),
      }),
      { params: { noteId: "n1" } }
    );
    expect(conflictRes.status).toBe(409);
  });
});

