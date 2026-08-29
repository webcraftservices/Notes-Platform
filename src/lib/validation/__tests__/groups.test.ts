import { describe, expect, it } from "vitest";
import { createGroupSchema, updateGroupSchema } from "@/lib/validation/groups";

describe("createGroupSchema", () => {
  it("accepts a minimal valid group", () => {
    expect(createGroupSchema.safeParse({ name: "Physics — Semester 3" }).success).toBe(true);
  });

  it("accepts a name with a description", () => {
    expect(
      createGroupSchema.safeParse({ name: "Physics", description: "Shared lecture notes" }).success
    ).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(createGroupSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(createGroupSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("trims whitespace-only names to empty and rejects them", () => {
    expect(createGroupSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name over the length limit", () => {
    expect(createGroupSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
  });

  it("rejects a description over the length limit", () => {
    expect(
      createGroupSchema.safeParse({ name: "Physics", description: "a".repeat(2001) }).success
    ).toBe(false);
  });
});

describe("updateGroupSchema", () => {
  it("allows a partial update with just a name", () => {
    expect(updateGroupSchema.safeParse({ name: "Physics — Semester 4" }).success).toBe(true);
  });

  it("allows clearing description with null", () => {
    expect(updateGroupSchema.safeParse({ description: null }).success).toBe(true);
  });

  it("allows an empty object as a no-op update, matching updateSubjectSchema's convention", () => {
    expect(updateGroupSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an explicitly empty name", () => {
    expect(updateGroupSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
