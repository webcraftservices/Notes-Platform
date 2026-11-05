import { describe, expect, it } from "vitest";
import { signUpSchema, signInSchema, getSafeCallbackUrl } from "@/lib/validation/auth";

describe("signInSchema", () => {
  it("accepts a valid email/password pair", () => {
    const result = signInSchema.safeParse({ email: "a@b.com", password: "password1" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = signInSchema.safeParse({ email: "not-an-email", password: "password1" });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short password", () => {
    const result = signInSchema.safeParse({ email: "a@b.com", password: "short" });
    expect(result.success).toBe(false);
  });

  it("normalizes email by trimming surrounding whitespace and lowercasing", () => {
    const result = signInSchema.safeParse({ email: "  User@Example.COM  ", password: "password1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });
});

describe("signUpSchema", () => {
  const base = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "Password1",
    confirmPassword: "Password1",
  };

  it("accepts a fully valid signup", () => {
    expect(signUpSchema.safeParse(base).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = signUpSchema.safeParse({ ...base, confirmPassword: "Different1" });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no uppercase letter", () => {
    const result = signUpSchema.safeParse({
      ...base,
      password: "password1",
      confirmPassword: "password1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no digit", () => {
    const result = signUpSchema.safeParse({
      ...base,
      password: "Passwordonly",
      confirmPassword: "Passwordonly",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = signUpSchema.safeParse({ ...base, name: "  " });
    expect(result.success).toBe(false);
  });

  it("normalizes email by trimming surrounding whitespace and lowercasing", () => {
    const result = signUpSchema.safeParse({ ...base, email: "  User@Example.COM  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("normalizes email with uppercase letters and preserves valid fields", () => {
    const result = signUpSchema.safeParse({ ...base, email: "NEW.STUDENT@DOMAIN.EDU" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("new.student@domain.edu");
    }
  });
});

describe("getSafeCallbackUrl", () => {
  it("preserves valid internal paths with or without query params", () => {
    expect(getSafeCallbackUrl("/materials/123")).toBe("/materials/123");
    expect(getSafeCallbackUrl("/subjects?view=grid")).toBe("/subjects?view=grid");
    expect(getSafeCallbackUrl("/groups/engineering/notes/456")).toBe("/groups/engineering/notes/456");
  });

  it("defaults null, undefined, or empty string to root", () => {
    expect(getSafeCallbackUrl(null)).toBe("/");
    expect(getSafeCallbackUrl(undefined)).toBe("/");
    expect(getSafeCallbackUrl("")).toBe("/");
  });

  it("rejects absolute external URLs to prevent open redirect vulnerabilities", () => {
    expect(getSafeCallbackUrl("https://attacker.com")).toBe("/");
    expect(getSafeCallbackUrl("http://attacker.com/steal")).toBe("/");
    expect(getSafeCallbackUrl("javascript:alert(1)")).toBe("/");
  });

  it("rejects protocol-relative and backslash bypass attempts", () => {
    expect(getSafeCallbackUrl("//evil.com")).toBe("/");
    expect(getSafeCallbackUrl("/\\evil.com")).toBe("/");
  });

  it("prevents self-referential redirect loops to auth pages", () => {
    expect(getSafeCallbackUrl("/sign-in")).toBe("/");
    expect(getSafeCallbackUrl("/sign-in?callbackUrl=/home")).toBe("/");
    expect(getSafeCallbackUrl("/sign-up")).toBe("/");
  });
});
