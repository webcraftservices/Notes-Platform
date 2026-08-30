import { describe, expect, it } from "vitest";
import { getGroupColor, getGroupInitials, formatRoleLabel } from "@/lib/group-style";
import { SUBJECT_COLOR_KEYS, SUBJECT_COLORS } from "@/lib/subject-style";

describe("getGroupColor", () => {
  it("returns one of the existing SUBJECT_COLORS swatches (no new palette introduced)", () => {
    const swatch = getGroupColor("group_123");
    const validSwatches = SUBJECT_COLOR_KEYS.map((k) => SUBJECT_COLORS[k]);
    expect(validSwatches).toContainEqual(swatch);
  });

  it("is deterministic for the same id", () => {
    expect(getGroupColor("group_abc")).toEqual(getGroupColor("group_abc"));
  });

  it("can produce different colors for different ids", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g"].map((id) => JSON.stringify(getGroupColor(id)))
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("getGroupInitials", () => {
  it("takes the first two letters of a single-word name", () => {
    expect(getGroupInitials("Physics")).toBe("PH");
  });

  it("takes the first letter of the first two words for multi-word names", () => {
    expect(getGroupInitials("Physics Study Group")).toBe("PS");
  });

  it("uppercases the result", () => {
    expect(getGroupInitials("study group")).toBe("SG");
  });

  it("handles extra whitespace", () => {
    expect(getGroupInitials("  Physics   Study  ")).toBe("PS");
  });

  it("falls back to ? for an empty name", () => {
    expect(getGroupInitials("")).toBe("?");
    expect(getGroupInitials("   ")).toBe("?");
  });
});

describe("formatRoleLabel", () => {
  it("title-cases each MemberRole value", () => {
    expect(formatRoleLabel("OWNER")).toBe("Owner");
    expect(formatRoleLabel("ADMIN")).toBe("Admin");
    expect(formatRoleLabel("MEMBER")).toBe("Member");
    expect(formatRoleLabel("VIEWER")).toBe("Viewer");
  });
});
