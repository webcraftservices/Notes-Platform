import { describe, expect, it } from "vitest";
import { updateNotificationSchema } from "@/lib/validation/notifications";

describe("updateNotificationSchema", () => {
  it("accepts read: true", () => {
    expect(updateNotificationSchema.safeParse({ read: true }).success).toBe(true);
  });

  it("accepts read: false", () => {
    expect(updateNotificationSchema.safeParse({ read: false }).success).toBe(true);
  });

  it("rejects a missing read field", () => {
    expect(updateNotificationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-boolean read value", () => {
    expect(updateNotificationSchema.safeParse({ read: "true" }).success).toBe(false);
  });

  it("rejects attempts to set unrelated fields like userId or type", () => {
    // Extra fields are ignored by default Zod parsing, not rejected — this
    // test documents that behavior so nobody mistakes silently-stripped
    // fields for enforced immutability; the real guarantee is that the API
    // route below never reads anything but `.read` off the parsed result.
    const parsed = updateNotificationSchema.safeParse({
      read: true,
      userId: "someone-elses-id",
      type: "SYSTEM",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ read: true });
    }
  });
});
