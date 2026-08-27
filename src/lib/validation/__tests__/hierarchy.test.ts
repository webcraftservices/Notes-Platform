import { describe, expect, it } from "vitest";
import {
  createSubjectSchema,
  updateSubjectSchema,
  createChapterSchema,
  updateChapterSchema,
  createTopicSchema,
} from "@/lib/validation/hierarchy";

describe("createSubjectSchema", () => {
  it("accepts a minimal valid subject", () => {
    expect(createSubjectSchema.safeParse({ name: "Physics" }).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createSubjectSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a name over the length limit", () => {
    expect(createSubjectSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
  });

  it("trims whitespace-only names to empty and rejects them", () => {
    expect(createSubjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("updateSubjectSchema", () => {
  it("allows a partial update with just archived", () => {
    expect(updateSubjectSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it("allows clearing description with null", () => {
    expect(updateSubjectSchema.safeParse({ description: null }).success).toBe(true);
  });

  it("rejects an empty object being treated as a name reset", () => {
    // Empty updates are technically valid (a no-op PATCH); this just checks
    // that an explicitly empty name string is still rejected if provided.
    expect(updateSubjectSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("createChapterSchema", () => {
  it("accepts a minimal valid chapter", () => {
    expect(createChapterSchema.safeParse({ name: "Thermodynamics" }).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(createChapterSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateChapterSchema", () => {
  it("accepts a valid status transition", () => {
    expect(updateChapterSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true);
  });

  it("rejects an invalid status value", () => {
    expect(updateChapterSchema.safeParse({ status: "DONE" }).success).toBe(false);
  });

  it("rejects a negative order", () => {
    expect(updateChapterSchema.safeParse({ order: -1 }).success).toBe(false);
  });
});

describe("createTopicSchema", () => {
  it("accepts a minimal valid topic", () => {
    expect(createTopicSchema.safeParse({ name: "Zeroth Law" }).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(createTopicSchema.safeParse({}).success).toBe(false);
  });
});
