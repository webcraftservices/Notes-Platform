import { describe, expect, it } from "vitest";
import {
  createGroupSchema,
  updateGroupSchema,
  updateMemberRoleSchema,
  createInvitationSchema,
} from "@/lib/validation/groups";

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

describe("updateMemberRoleSchema", () => {
  it("accepts ADMIN, MEMBER, and VIEWER", () => {
    expect(updateMemberRoleSchema.safeParse({ role: "ADMIN" }).success).toBe(true);
    expect(updateMemberRoleSchema.safeParse({ role: "MEMBER" }).success).toBe(true);
    expect(updateMemberRoleSchema.safeParse({ role: "VIEWER" }).success).toBe(true);
  });

  it("rejects OWNER — no one may be assigned OWNER through this endpoint", () => {
    expect(updateMemberRoleSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(updateMemberRoleSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unrecognized role string", () => {
    expect(updateMemberRoleSchema.safeParse({ role: "SUPERADMIN" }).success).toBe(false);
  });
});

describe("createInvitationSchema", () => {
  it("accepts a valid email and non-owner role", () => {
    const result = createInvitationSchema.safeParse({ email: "friend@example.com", role: "MEMBER" });
    expect(result.success).toBe(true);
  });

  it("normalizes the email to lowercase and trimmed", () => {
    const result = createInvitationSchema.safeParse({ email: "  Friend@Example.COM  ", role: "MEMBER" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("friend@example.com");
    }
  });

  it("rejects an invalid email format", () => {
    expect(createInvitationSchema.safeParse({ email: "not-an-email", role: "MEMBER" }).success).toBe(
      false
    );
  });

  it("rejects a missing email", () => {
    expect(createInvitationSchema.safeParse({ role: "MEMBER" }).success).toBe(false);
  });

  it("rejects OWNER as an invitation role", () => {
    expect(
      createInvitationSchema.safeParse({ email: "friend@example.com", role: "OWNER" }).success
    ).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(createInvitationSchema.safeParse({ email: "friend@example.com" }).success).toBe(false);
  });

  it("accepts ADMIN and VIEWER as invitation roles", () => {
    expect(
      createInvitationSchema.safeParse({ email: "friend@example.com", role: "ADMIN" }).success
    ).toBe(true);
    expect(
      createInvitationSchema.safeParse({ email: "friend@example.com", role: "VIEWER" }).success
    ).toBe(true);
  });
});
