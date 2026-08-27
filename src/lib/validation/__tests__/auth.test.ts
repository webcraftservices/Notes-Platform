import { describe, expect, it } from "vitest";
import { signUpSchema, signInSchema } from "@/lib/validation/auth";

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
});
