import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/email";

describe("normalizeEmail", () => {
  it("lowercases the email", () => {
    expect(normalizeEmail("Test@Example.com")).toBe("test@example.com");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeEmail("  test@example.com  ")).toBe("test@example.com");
  });

  it("trims and lowercases together", () => {
    expect(normalizeEmail("  Test@Example.COM ")).toBe("test@example.com");
  });

  it("is a no-op for already-normalized input", () => {
    expect(normalizeEmail("test@example.com")).toBe("test@example.com");
  });

  it("treats case-differing emails as equal once normalized", () => {
    expect(normalizeEmail("Nishant@Gmail.com")).toBe(normalizeEmail("nishant@gmail.com"));
  });

  it("does not alter the local part's internal characters", () => {
    expect(normalizeEmail("First.Last+tag@Example.com")).toBe("first.last+tag@example.com");
  });
});
