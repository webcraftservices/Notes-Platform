"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUpSchema, type SignUpInput } from "@/lib/validation/auth";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";

export function SignUpForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  async function onSubmit(data: SignUpInput) {
    setFormError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setFormError(
        typeof body?.error === "string" ? body.error : "Couldn't create your account. Try again."
      );
      return;
    }

    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    if (result?.error) {
      setFormError("Account created — but sign-in failed. Try signing in manually.");
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Create your account</h1>
      <p className="mt-1.5 text-sm text-ink-muted dark:text-white/50">
        Start turning recordings and documents into organized knowledge.
      </p>

      <div className="mt-8">
        <GoogleButton label="Sign up with Google" />
      </div>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-line dark:bg-line-dark" />
        <span className="text-xs text-ink-faint">or</span>
        <div className="h-px flex-1 bg-line dark:bg-line-dark" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" autoComplete="name" {...register("name")} />
          {errors.name && <p className="mt-1.5 text-xs text-signal-danger">{errors.name.message}</p>}
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="mt-1.5 text-xs text-signal-danger">{errors.email.message}</p>}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && (
            <p className="mt-1.5 text-xs text-signal-danger">{errors.password.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
          {errors.confirmPassword && (
            <p className="mt-1.5 text-xs text-signal-danger">{errors.confirmPassword.message}</p>
          )}
        </div>

        {formError && (
          <p role="alert" className="rounded-sm bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
            {formError}
          </p>
        )}

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="mt-8 text-sm text-ink-muted dark:text-white/50">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-ink underline underline-offset-2 dark:text-white">
          Sign in
        </Link>
      </p>
    </div>
  );
}
