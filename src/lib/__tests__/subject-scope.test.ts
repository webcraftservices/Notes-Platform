import { describe, expect, it } from "vitest";
import { assertSubjectScopeInvariant, resolveSubjectOwner, SubjectScopeInvariantError } from "@/lib/subject-scope";

describe("assertSubjectScopeInvariant", () => {
  it("accepts workspace only", () => {
    expect(() => assertSubjectScopeInvariant({ workspaceId: "w1", groupId: null })).not.toThrow();
  });

  it("accepts group only", () => {
    expect(() => assertSubjectScopeInvariant({ workspaceId: null, groupId: "g1" })).not.toThrow();
  });

  it("rejects both workspace and group set", () => {
    expect(() => assertSubjectScopeInvariant({ workspaceId: "w1", groupId: "g1" })).toThrow(
      SubjectScopeInvariantError
    );
  });

  it("rejects neither workspace nor group set", () => {
    expect(() => assertSubjectScopeInvariant({ workspaceId: null, groupId: null })).toThrow(
      SubjectScopeInvariantError
    );
  });

  it("rejects neither when fields are simply omitted", () => {
    expect(() => assertSubjectScopeInvariant({})).toThrow(SubjectScopeInvariantError);
  });

  it("treats an empty string id the same as unset, not as a valid id", () => {
    expect(() => assertSubjectScopeInvariant({ workspaceId: "", groupId: "g1" })).not.toThrow();
    expect(() => assertSubjectScopeInvariant({ workspaceId: "", groupId: "" })).toThrow(
      SubjectScopeInvariantError
    );
  });
});

describe("resolveSubjectOwner", () => {
  it("resolves a workspace-owned subject", () => {
    expect(resolveSubjectOwner({ workspaceId: "w1", groupId: null })).toEqual({
      ownerType: "workspace",
      workspaceId: "w1",
      groupId: null,
    });
  });

  it("resolves a group-owned subject", () => {
    expect(resolveSubjectOwner({ workspaceId: null, groupId: "g1" })).toEqual({
      ownerType: "group",
      workspaceId: null,
      groupId: "g1",
    });
  });

  it("throws for a subject with both set", () => {
    expect(() => resolveSubjectOwner({ workspaceId: "w1", groupId: "g1" })).toThrow(
      SubjectScopeInvariantError
    );
  });

  it("throws for a subject with neither set", () => {
    expect(() => resolveSubjectOwner({ workspaceId: null, groupId: null })).toThrow(
      SubjectScopeInvariantError
    );
  });
});
