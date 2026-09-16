import { describe, expect, it } from "vitest";
import { aiConversationScopeSchema, aiScopeQuerySchema, sendAIMessageSchema } from "@/lib/validation/ai";

describe("aiScopeQuerySchema", () => {
  it("accepts an empty object (workspace-level scope)", () => {
    expect(aiScopeQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a valid topicId", () => {
    const result = aiScopeQuerySchema.safeParse({ topicId: "cktopic0000000000000000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-cuid id", () => {
    expect(aiScopeQuerySchema.safeParse({ topicId: "not-a-cuid" }).success).toBe(false);
  });

  it("rejects a non-cuid subjectId (Phase 5 Task 5: Subject-scoped AI chat)", () => {
    expect(aiScopeQuerySchema.safeParse({ subjectId: "not-a-cuid" }).success).toBe(false);
  });

  it("rejects a non-cuid chapterId (Phase 5 Task 5: Chapter-scoped AI chat)", () => {
    expect(aiScopeQuerySchema.safeParse({ chapterId: "not-a-cuid" }).success).toBe(false);
  });

  it("accepts a valid subjectId", () => {
    expect(aiScopeQuerySchema.safeParse({ subjectId: "cksubject000000000000000000" }).success).toBe(true);
  });

  it("accepts a valid chapterId", () => {
    expect(aiScopeQuerySchema.safeParse({ chapterId: "ckchapter000000000000000000" }).success).toBe(true);
  });

  it("accepts multiple scope fields at once (route layer decides precedence)", () => {
    const result = aiScopeQuerySchema.safeParse({
      subjectId: "cksubject000000000000000000",
      topicId: "cktopic0000000000000000000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid groupId (Phase 6.5 bare group scope)", () => {
    const result = aiScopeQuerySchema.safeParse({ groupId: "ckgroup00000000000000000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-cuid groupId", () => {
    expect(aiScopeQuerySchema.safeParse({ groupId: "not-a-cuid" }).success).toBe(false);
  });

  it("accepts groupId alongside a narrower field (route layer decides precedence)", () => {
    const result = aiScopeQuerySchema.safeParse({
      groupId: "ckgroup00000000000000000000",
      topicId: "cktopic0000000000000000000",
    });
    expect(result.success).toBe(true);
  });
});

/**
 * Phase 8.4 — this is the real Zod schema, not a mock, so these tests
 * directly prove the validation rules the audit found were entirely
 * absent (no `kind` support existed on this route at all before this
 * phase).
 */
describe("aiConversationScopeSchema", () => {
  it("defaults kind to CHAT when omitted, for backward compatibility with every pre-8.4 caller", () => {
    const result = aiConversationScopeSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("CHAT");
  });

  it("accepts an explicit CHAT alongside no topicId (workspace-level chat)", () => {
    expect(aiConversationScopeSchema.safeParse({ kind: "CHAT" }).success).toBe(true);
  });

  it("accepts TUTOR with a valid topicId", () => {
    const result = aiConversationScopeSchema.safeParse({ kind: "TUTOR", topicId: "cktopic0000000000000000000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("TUTOR");
      expect(result.data.topicId).toBe("cktopic0000000000000000000");
    }
  });

  it("rejects TUTOR without a topicId — Tutor cannot be created detached from a Topic", () => {
    const result = aiConversationScopeSchema.safeParse({ kind: "TUTOR" });
    expect(result.success).toBe(false);
  });

  it("rejects TUTOR with only a chapterId/subjectId/groupId and no topicId", () => {
    expect(aiConversationScopeSchema.safeParse({ kind: "TUTOR", chapterId: "ckchapter000000000000000000" }).success).toBe(
      false
    );
    expect(aiConversationScopeSchema.safeParse({ kind: "TUTOR", subjectId: "cksubject000000000000000000" }).success).toBe(
      false
    );
    expect(aiConversationScopeSchema.safeParse({ kind: "TUTOR", groupId: "ckgroup00000000000000000000" }).success).toBe(
      false
    );
  });

  it("rejects an unrecognized kind value", () => {
    expect(aiConversationScopeSchema.safeParse({ kind: "ADMIN" }).success).toBe(false);
  });

  it("still validates every underlying scope field's cuid shape", () => {
    expect(
      aiConversationScopeSchema.safeParse({ kind: "TUTOR", topicId: "not-a-cuid" }).success
    ).toBe(false);
  });
});

describe("sendAIMessageSchema", () => {
  it("accepts a normal message", () => {
    expect(sendAIMessageSchema.safeParse({ content: "What is the zeroth law?" }).success).toBe(true);
  });

  it("trims whitespace-only content and rejects it as empty", () => {
    expect(sendAIMessageSchema.safeParse({ content: "   " }).success).toBe(false);
  });

  it("rejects a missing content field", () => {
    expect(sendAIMessageSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a message over 4000 characters", () => {
    expect(sendAIMessageSchema.safeParse({ content: "a".repeat(4001) }).success).toBe(false);
  });

  it("accepts a message right at the 4000 character limit", () => {
    expect(sendAIMessageSchema.safeParse({ content: "a".repeat(4000) }).success).toBe(true);
  });
});
