import { describe, expect, it } from "vitest";
import { roleMeetsMinimum, canChangeMemberRole, canRemoveMember } from "@/lib/group-role";

describe("roleMeetsMinimum", () => {
  it("OWNER meets every minimum, including OWNER itself", () => {
    expect(roleMeetsMinimum("OWNER", "OWNER")).toBe(true);
    expect(roleMeetsMinimum("OWNER", "ADMIN")).toBe(true);
    expect(roleMeetsMinimum("OWNER", "MEMBER")).toBe(true);
    expect(roleMeetsMinimum("OWNER", "VIEWER")).toBe(true);
  });

  it("ADMIN meets ADMIN/MEMBER/VIEWER but not OWNER", () => {
    expect(roleMeetsMinimum("ADMIN", "ADMIN")).toBe(true);
    expect(roleMeetsMinimum("ADMIN", "MEMBER")).toBe(true);
    expect(roleMeetsMinimum("ADMIN", "VIEWER")).toBe(true);
    expect(roleMeetsMinimum("ADMIN", "OWNER")).toBe(false);
  });

  it("MEMBER meets MEMBER/VIEWER but not ADMIN or OWNER", () => {
    expect(roleMeetsMinimum("MEMBER", "MEMBER")).toBe(true);
    expect(roleMeetsMinimum("MEMBER", "VIEWER")).toBe(true);
    expect(roleMeetsMinimum("MEMBER", "ADMIN")).toBe(false);
    expect(roleMeetsMinimum("MEMBER", "OWNER")).toBe(false);
  });

  it("VIEWER only meets VIEWER", () => {
    expect(roleMeetsMinimum("VIEWER", "VIEWER")).toBe(true);
    expect(roleMeetsMinimum("VIEWER", "MEMBER")).toBe(false);
    expect(roleMeetsMinimum("VIEWER", "ADMIN")).toBe(false);
    expect(roleMeetsMinimum("VIEWER", "OWNER")).toBe(false);
  });
});

describe("canChangeMemberRole", () => {
  it("OWNER can change MEMBER to ADMIN, VIEWER, or MEMBER", () => {
    expect(canChangeMemberRole("OWNER", "MEMBER", "ADMIN")).toBe(true);
    expect(canChangeMemberRole("OWNER", "MEMBER", "VIEWER")).toBe(true);
    expect(canChangeMemberRole("OWNER", "VIEWER", "MEMBER")).toBe(true);
  });

  it("ADMIN can change MEMBER/VIEWER roles", () => {
    expect(canChangeMemberRole("ADMIN", "MEMBER", "ADMIN")).toBe(true);
    expect(canChangeMemberRole("ADMIN", "VIEWER", "MEMBER")).toBe(true);
  });

  it("ADMIN can change another ADMIN's role (no established restriction against it)", () => {
    expect(canChangeMemberRole("ADMIN", "ADMIN", "MEMBER")).toBe(true);
  });

  it("MEMBER cannot change any role", () => {
    expect(canChangeMemberRole("MEMBER", "VIEWER", "MEMBER")).toBe(false);
    expect(canChangeMemberRole("MEMBER", "MEMBER", "VIEWER")).toBe(false);
  });

  it("VIEWER cannot change any role", () => {
    expect(canChangeMemberRole("VIEWER", "MEMBER", "VIEWER")).toBe(false);
  });

  it("OWNER can never be the target of a role change, even by OWNER", () => {
    expect(canChangeMemberRole("OWNER", "OWNER", "ADMIN")).toBe(false);
    expect(canChangeMemberRole("ADMIN", "OWNER", "MEMBER")).toBe(false);
  });

  it("no one can assign OWNER via role change, including OWNER itself", () => {
    expect(canChangeMemberRole("OWNER", "ADMIN", "OWNER")).toBe(false);
    expect(canChangeMemberRole("OWNER", "MEMBER", "OWNER")).toBe(false);
    expect(canChangeMemberRole("ADMIN", "MEMBER", "OWNER")).toBe(false);
  });

  it("a no-op reassignment to the same role is still permitted for an eligible actor", () => {
    expect(canChangeMemberRole("ADMIN", "MEMBER", "MEMBER")).toBe(true);
  });
});

describe("canRemoveMember", () => {
  it("OWNER can remove ADMIN, MEMBER, or VIEWER", () => {
    expect(canRemoveMember("OWNER", "ADMIN", false)).toBe(true);
    expect(canRemoveMember("OWNER", "MEMBER", false)).toBe(true);
    expect(canRemoveMember("OWNER", "VIEWER", false)).toBe(true);
  });

  it("ADMIN can remove MEMBER, VIEWER, or another ADMIN", () => {
    expect(canRemoveMember("ADMIN", "MEMBER", false)).toBe(true);
    expect(canRemoveMember("ADMIN", "VIEWER", false)).toBe(true);
    expect(canRemoveMember("ADMIN", "ADMIN", false)).toBe(true);
  });

  it("MEMBER cannot remove another member", () => {
    expect(canRemoveMember("MEMBER", "VIEWER", false)).toBe(false);
    expect(canRemoveMember("MEMBER", "MEMBER", false)).toBe(false);
  });

  it("VIEWER cannot remove another member", () => {
    expect(canRemoveMember("VIEWER", "MEMBER", false)).toBe(false);
  });

  it("OWNER can never be removed by anyone, including another OWNER-ranked actor", () => {
    expect(canRemoveMember("OWNER", "OWNER", false)).toBe(false);
    expect(canRemoveMember("ADMIN", "OWNER", false)).toBe(false);
  });

  it("ADMIN, MEMBER, and VIEWER can leave (remove themselves)", () => {
    expect(canRemoveMember("ADMIN", "ADMIN", true)).toBe(true);
    expect(canRemoveMember("MEMBER", "MEMBER", true)).toBe(true);
    expect(canRemoveMember("VIEWER", "VIEWER", true)).toBe(true);
  });

  it("OWNER cannot leave", () => {
    expect(canRemoveMember("OWNER", "OWNER", true)).toBe(false);
  });
});
