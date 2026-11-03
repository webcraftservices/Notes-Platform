"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { signUpSchema, getSafeCallbackUrl, type SignUpInput } from "@/lib/validation/auth";
import { GoogleButton } from "@/components/auth/google-button";

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get("callbackUrl");
  const safeCallbackUrl = useMemo(() => getSafeCallbackUrl(rawCallbackUrl), [rawCallbackUrl]);

  const signInUrl = useMemo(
    () =>
      safeCallbackUrl !== "/"
        ? `/sign-in?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`
        : "/sign-in",
    [safeCallbackUrl]
  );

  // Eagerly prefetch the sign-in destination to eliminate transition latency
  useEffect(() => {
    router.prefetch(signInUrl);
    router.prefetch("/sign-in");
  }, [router, signInUrl]);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  async function onSubmit(data: SignUpInput) {
    setFormError(null);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
          confirmPassword: data.confirmPassword,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setFormError("Could not create account with these details.");
        } else if (res.status === 429) {
          setFormError("Too many registration attempts. Please try again later.");
        } else if (typeof body?.error === "string") {
          setFormError(body.error);
        } else if (body?.error?.fieldErrors) {
          const firstErr = Object.values(body.error.fieldErrors)[0];
          setFormError(Array.isArray(firstErr) ? (firstErr[0] as string) : "Invalid registration details.");
        } else {
          setFormError("Couldn't create your account. Please try again.");
        }
        return;
      }

      // Automatically sign in the newly registered user
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        // Fallback: If auto sign-in fails, send them to sign-in page
        router.push(
          safeCallbackUrl !== "/"
            ? `/sign-in?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`
            : "/sign-in"
        );
        return;
      }

      // Successful auto sign-in: proceed to callback destination or onboarding
      router.push(safeCallbackUrl !== "/" ? safeCallbackUrl : "/onboarding");
      router.refresh();
    } catch {
      setFormError("An unexpected network error occurred. Please try again.");
    }
  }

  return (
    <div className="w-full">
      {/* Heading & Subtitle: Centered horizontally with balanced typography */}
      <div className="space-y-1 text-center">
        <h1 className="font-display text-[24px] sm:text-[26px] font-medium tracking-tight text-white leading-tight">
          Create your account
        </h1>
        <p className="text-[13px] sm:text-[13.5px] leading-relaxed text-white/60 font-sans">
          Start turning recordings and documents into organized knowledge.
        </p>
      </div>

      {/* Social Registration */}
      <div className="mt-4 sm:mt-5">
        <GoogleButton
          label="Sign up with Google"
          callbackUrl={safeCallbackUrl !== "/" ? safeCallbackUrl : "/onboarding"}
          disabled={isSubmitting}
        />
      </div>

      {/* Understated Divider: Centered with balanced side rules */}
      <div className="my-3.5 sm:my-4 flex items-center gap-3.5 select-none" aria-hidden="true">
        <div className="h-px flex-1 bg-white/[0.08]" />
        <span className="text-[12px] font-normal text-white/40 font-sans">
          or continue with email
        </span>
        <div className="h-px flex-1 bg-white/[0.08]" />
      </div>

      {/* Registration Form Fields: Comfortable mobile sizing (48px) and refined desktop sizing (44px) */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        {/* Name Field */}
        <div>
          <label htmlFor="name" className="block text-[13px] font-medium text-white/75 mb-1 select-none text-left">
            Full name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
            disabled={isSubmitting}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "name-error" : undefined}
            className="h-[48px] sm:h-11 w-full rounded-[8px] border border-white/[0.11] bg-[#121319] px-4 sm:px-3.5 text-[15px] sm:text-[14px] text-white placeholder:text-white/30 transition-colors hover:border-white/[0.18] focus:border-accent/90 focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-[#14151F] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-rose-500/70 focus:aria-invalid:border-rose-500 focus:aria-invalid:ring-rose-500/30"
            {...register("name")}
          />
          {errors.name && (
            <p id="name-error" role="alert" className="mt-1 text-[12px] text-rose-400 flex items-center gap-1.5">
              {errors.name.message}
            </p>
          )}
        </div>

        {/* Email Field */}
        <div>
          <label htmlFor="email" className="block text-[13px] font-medium text-white/75 mb-1 select-none text-left">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="name@university.edu"
            disabled={isSubmitting}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="h-[48px] sm:h-11 w-full rounded-[8px] border border-white/[0.11] bg-[#121319] px-4 sm:px-3.5 text-[15px] sm:text-[14px] text-white placeholder:text-white/30 transition-colors hover:border-white/[0.18] focus:border-accent/90 focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-[#14151F] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-rose-500/70 focus:aria-invalid:border-rose-500 focus:aria-invalid:ring-rose-500/30"
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" role="alert" className="mt-1 text-[12px] text-rose-400 flex items-center gap-1.5">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password Field with Visibility Toggle */}
        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-white/75 mb-1 select-none text-left">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={isSubmitting}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              className="h-[48px] sm:h-11 w-full rounded-[8px] border border-white/[0.11] bg-[#121319] pl-4 pr-12 sm:pl-3.5 sm:pr-11 text-[15px] sm:text-[14px] text-white placeholder:text-white/30 transition-colors hover:border-white/[0.18] focus:border-accent/90 focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-[#14151F] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-rose-500/70 focus:aria-invalid:border-rose-500 focus:aria-invalid:ring-rose-500/30"
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={isSubmitting}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute right-0 top-0 flex h-[48px] w-12 sm:h-11 sm:w-11 items-center justify-center text-white/40 transition-colors hover:text-white/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-r-[8px] disabled:pointer-events-none disabled:opacity-50"
            >
              {showPassword ? (
                <EyeOff className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.password && (
            <p id="password-error" role="alert" className="mt-1 text-[12px] text-rose-400 flex items-center gap-1.5">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Confirm Password Field with Visibility Toggle */}
        <div>
          <label htmlFor="confirmPassword" className="block text-[13px] font-medium text-white/75 mb-1 select-none text-left">
            Confirm password
          </label>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={isSubmitting}
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
              className="h-[48px] sm:h-11 w-full rounded-[8px] border border-white/[0.11] bg-[#121319] pl-4 pr-12 sm:pl-3.5 sm:pr-11 text-[15px] sm:text-[14px] text-white placeholder:text-white/30 transition-colors hover:border-white/[0.18] focus:border-accent/90 focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-[#14151F] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-rose-500/70 focus:aria-invalid:border-rose-500 focus:aria-invalid:ring-rose-500/30"
              {...register("confirmPassword")}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              disabled={isSubmitting}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              aria-pressed={showConfirmPassword}
              className="absolute right-0 top-0 flex h-[48px] w-12 sm:h-11 sm:w-11 items-center justify-center text-white/40 transition-colors hover:text-white/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-r-[8px] disabled:pointer-events-none disabled:opacity-50"
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p id="confirmPassword-error" role="alert" className="mt-1 text-[12px] text-rose-400 flex items-center gap-1.5">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {/* Form Error Alert */}
        {formError && (
          <div
            role="alert"
            className="rounded-[8px] border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-300 leading-snug text-left"
          >
            {formError}
          </div>
        )}

        {/* Primary Submit CTA: Refined warm alabaster surface */}
        <div className="pt-1.5">
          <button
            type="submit"
            disabled={isSubmitting}
            className="group relative h-[48px] sm:h-11 w-full rounded-[8px] bg-gradient-to-b from-[#F7F5EE] via-[#EFEBE0] to-[#E3DDCF] border border-white/60 text-[14px] sm:text-[13.5px] font-semibold text-[#14151C] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_12px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.9)] hover:from-[#FFFFFF] hover:to-[#E8E2D4] hover:shadow-[0_2px_4px_rgba(0,0,0,0.2),0_6px_18px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,1)] active:scale-[0.99] active:from-[#DDD7C9] active:to-[#D5CEC0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E0E13] disabled:opacity-50 disabled:pointer-events-none transition-all duration-150 flex items-center justify-center gap-2 select-none tracking-tight font-sans"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin text-[#14151C]" />}
            <span>{isSubmitting ? "Creating account..." : "Create account"}</span>
          </button>
        </div>
      </form>

      {/* Account Login Navigation with instant prefetch */}
      <p className="mt-3.5 sm:mt-4 text-center text-[13px] text-white/50 font-sans">
        Already have an account?{" "}
        <Link
          href={signInUrl}
          prefetch={true}
          onMouseEnter={() => router.prefetch(signInUrl)}
          onTouchStart={() => router.prefetch(signInUrl)}
          className="font-medium text-white/90 underline underline-offset-4 decoration-white/30 transition-colors hover:text-white hover:decoration-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-xs"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
