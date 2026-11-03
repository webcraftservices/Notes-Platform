import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const signUpSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(120),
    email: z.string().email("Enter a valid email"),
    password: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/[A-Z]/, "At least one uppercase letter")
      .regex(/[0-9]/, "At least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Validates and sanitizes a callbackUrl to prevent open redirect vulnerabilities
 * while preserving valid internal navigation paths (e.g. /materials/123, /groups/abc).
 */
export function getSafeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return "/";
  // Must start with a single "/", rejecting protocol-relative ("//evil.com") or backslash bypasses
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  // Prevent infinite auth redirect loops
  const pathname = raw.split("?")[0];
  if (pathname === "/sign-in" || pathname === "/sign-up") {
    return "/";
  }
  return raw;
}
