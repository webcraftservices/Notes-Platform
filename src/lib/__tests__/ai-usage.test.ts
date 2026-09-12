import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  usageRecord: { createMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import { recordAIUsage } from "@/lib/ai-usage";

describe("recordAIUsage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("records an AI_REQUEST row plus one row per real token count reported by the provider", async () => {
    db.usageRecord.createMany.mockResolvedValue({ count: 3 });

    await recordAIUsage({
      userId: "user-1",
      workspaceId: "workspace-1",
      category: "chat",
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      tokensInput: 42,
      tokensOutput: 13,
    });

    expect(db.usageRecord.createMany).toHaveBeenCalledTimes(1);
    const { data } = db.usageRecord.createMany.mock.calls[0]![0];
    expect(data).toHaveLength(3);

    const request = data.find((r: { kind: string }) => r.kind === "AI_REQUEST");
    const input = data.find((r: { kind: string }) => r.kind === "AI_TOKENS_INPUT");
    const output = data.find((r: { kind: string }) => r.kind === "AI_TOKENS_OUTPUT");

    expect(request).toMatchObject({ userId: "user-1", quantity: 1 });
    expect(input).toMatchObject({ userId: "user-1", quantity: 42 });
    expect(output).toMatchObject({ userId: "user-1", quantity: 13 });

    for (const row of data) {
      expect(row.metadata).toMatchObject({
        category: "chat",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        workspaceId: "workspace-1",
      });
    }
  });

  it("records the embedding category and provider/model distinctly from chat", async () => {
    db.usageRecord.createMany.mockResolvedValue({ count: 2 });

    await recordAIUsage({
      userId: "user-1",
      category: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      tokensInput: 12,
    });

    const { data } = db.usageRecord.createMany.mock.calls[0]![0];
    expect(data).toHaveLength(2); // AI_REQUEST + AI_TOKENS_INPUT, no AI_TOKENS_OUTPUT for embeddings
    for (const row of data) {
      expect(row.metadata).toMatchObject({ category: "embedding", provider: "openai", model: "text-embedding-3-small" });
    }
  });

  it("writes no token rows at all when the provider reported no usable token counts, rather than fabricating zeros", async () => {
    db.usageRecord.createMany.mockResolvedValue({ count: 1 });

    await recordAIUsage({
      userId: "user-1",
      category: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      tokensInput: null,
    });

    const { data } = db.usageRecord.createMany.mock.calls[0]![0];
    expect(data).toHaveLength(1);
    expect(data[0].kind).toBe("AI_REQUEST");
  });

  it("always attributes usage to the authenticated user id passed in, never a shared/group id", async () => {
    db.usageRecord.createMany.mockResolvedValue({ count: 1 });

    await recordAIUsage({
      userId: "user-42",
      groupId: "group-1",
      category: "chat",
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
    });

    const { data } = db.usageRecord.createMany.mock.calls[0]![0];
    for (const row of data) {
      expect(row.userId).toBe("user-42");
      expect(row.metadata.groupId).toBe("group-1");
    }
  });

  it("does not throw when the usage-record write fails, and logs the failure instead", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.usageRecord.createMany.mockRejectedValue(new Error("connection lost"));

    await expect(
      recordAIUsage({ userId: "user-1", category: "chat", provider: "gemini", model: "gemini-2.5-flash-lite" })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
