import { describe, expect, it } from "vitest";
import { signUpSchema, getSafeCallbackUrl } from "@/lib/validation/auth";

describe("signUpSchema validation rules", () => {
  const validPayload = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "Password123",
    confirmPassword: "Password123",
  };

  it("passes with a complete and valid payload", () => {
    const result = signUpSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("fails if full name is empty or only whitespace", () => {
    const result = signUpSchema.safeParse({ ...validPayload, name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name).toBeDefined();
    }
  });

  it("fails if email is malformed", () => {
    const result = signUpSchema.safeParse({ ...validPayload, email: "invalid-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email).toBeDefined();
    }
  });

  it("fails if password is shorter than 8 characters", () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      password: "Pass1",
      confirmPassword: "Pass1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password).toContain("At least 8 characters");
    }
  });

  it("fails if password lacks an uppercase letter", () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      password: "password123",
      confirmPassword: "password123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password).toContain("At least one uppercase letter");
    }
  });

  it("fails if password lacks a number", () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      password: "PasswordOnly",
      confirmPassword: "PasswordOnly",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password).toContain("At least one number");
    }
  });

  it("fails if confirmPassword does not match password", () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      confirmPassword: "DifferentPassword123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.confirmPassword).toContain("Passwords don't match");
    }
  });
});

describe("Sign Up Navigation & callbackUrl safety", () => {
  it("preserves safe callback destinations", () => {
    expect(getSafeCallbackUrl("/materials/lecture-4")).toBe("/materials/lecture-4");
    expect(getSafeCallbackUrl("/onboarding")).toBe("/onboarding");
  });

  it("sanitizes unsafe external or protocol-relative callback destinations", () => {
    expect(getSafeCallbackUrl("https://malicious.com")).toBe("/");
    expect(getSafeCallbackUrl("//malicious.com")).toBe("/");
    expect(getSafeCallbackUrl("/\\malicious.com")).toBe("/");
  });
});
