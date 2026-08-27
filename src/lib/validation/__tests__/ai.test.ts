import { describe, expect, it } from "vitest";
import { aiScopeQuerySchema, sendAIMessageSchema } from "@/lib/validation/ai";

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

  it("accepts multiple scope fields at once (route layer decides precedence)", () => {
    const result = aiScopeQuerySchema.safeParse({
      subjectId: "cksubject000000000000000000",
      topicId: "cktopic0000000000000000000",
    });
    expect(result.success).toBe(true);
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
