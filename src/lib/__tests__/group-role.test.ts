import { describe, expect, it } from "vitest";
import { roleMeetsMinimum } from "@/lib/group-role";

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
