import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  handleGoogleDriveWebhook: vi.fn(),
}));
vi.mock("@/lib/google-drive-sync", () => syncMocks);

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { POST } from "../route";

describe("POST /api/integrations/google/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts X-Goog-* headers and returns 200 on valid webhook notification", async () => {
    syncMocks.handleGoogleDriveWebhook.mockResolvedValueOnce({
      ok: true,
      httpStatus: 200,
      status: "processed",
      summary: {
        userId: "user-1",
        changesFetched: 1,
        uniqueFilesChanged: 1,
        materialsUpdated: 1,
        materialsMarkedDeleted: 0,
        materialsSkippedUnchanged: 0,
        notesSynced: 0,
        notesConflicted: 0,
        notesMarkedDeleted: 0,
        pageTokenReset: false,
        newStartPageToken: "102",
      },
    });

    const req = new Request("https://zenote.example.com/api/integrations/google/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "chan-123",
        "x-goog-channel-token": "v1.nonce.sig",
        "x-goog-resource-id": "res-456",
        "x-goog-resource-state": "change",
        "x-goog-message-number": "42",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("processed");
    expect(syncMocks.handleGoogleDriveWebhook).toHaveBeenCalledWith(
      {
        channelId: "chan-123",
        channelToken: "v1.nonce.sig",
        resourceId: "res-456",
        resourceState: "change",
        messageNumber: "42",
        channelExpiration: null,
      },
      { awaitImportJobs: false }
    );
  });

  it("returns 401 when webhook token verification fails", async () => {
    syncMocks.handleGoogleDriveWebhook.mockResolvedValueOnce({
      ok: false,
      httpStatus: 401,
      error: "Invalid webhook channel token.",
    });

    const req = new Request("https://zenote.example.com/api/integrations/google/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "chan-123",
        "x-goog-channel-token": "forged",
        "x-goog-resource-id": "res-456",
        "x-goog-resource-state": "change",
        "x-goog-message-number": "42",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

