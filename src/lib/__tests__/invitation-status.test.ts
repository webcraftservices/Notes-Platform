import { describe, expect, it } from "vitest";
import { canManageInvitation } from "@/lib/invitation-status";

describe("canManageInvitation", () => {
  it("allows management (cancel/resend) while PENDING", () => {
    expect(canManageInvitation("PENDING")).toBe(true);
  });

  it("disallows management once ACCEPTED", () => {
    expect(canManageInvitation("ACCEPTED")).toBe(false);
  });

  it("disallows management once DECLINED", () => {
    expect(canManageInvitation("DECLINED")).toBe(false);
  });

  it("disallows management once EXPIRED", () => {
    expect(canManageInvitation("EXPIRED")).toBe(false);
  });

  it("disallows management once already CANCELLED", () => {
    expect(canManageInvitation("CANCELLED")).toBe(false);
  });
});
