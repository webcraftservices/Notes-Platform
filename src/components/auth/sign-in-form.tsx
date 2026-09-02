"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { signInSchema, type SignInInput } from "@/lib/validation/auth";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";
import Link from "next/link";

export function SignInForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  async function onSubmit(data: SignInInput) {
    setFormError(null);
    const result = await signIn("credentials", {
      ...data,
      redirect: false,
    });

    if (result?.error) {
      setFormError("That email and password combination didn't work.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Welcome back</h1>
      <p className="mt-1.5 text-sm text-ink-muted dark:text-white/50">
        Sign in to get back to your notes.
      </p>

      <div className="mt-8">
        <GoogleButton />
      </div>

      {/*
        Divider markup was already structurally correct — a standard
        flex-row-with-gap layout, not a broken absolute-positioned
        line-through-text pattern — so the two 1px lines can never
        literally render on top of "or" from a layout-structure
        standpoint. The reported "lines covering the text" almost
        certainly comes from the label having no opaque background: at
        `text-xs` size with `text-ink-faint`, the ~12px flex gap alone
        left too little visual breathing room between the line ends and
        the letters, especially at narrower viewports. Fixed by giving
        the label an explicit background matching the actual page
        background (globals.css: `body { @apply bg-paper ...
        dark:bg-graphite-950 }`) plus its own horizontal padding, so the
        label always paints a clean opaque break in the line regardless
        of viewport width or flex-gap rounding — the standard,
        bulletproof version of this pattern, not a z-index/color hack.
      */}
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-line dark:bg-line-dark" />
        <span className="shrink-0 bg-paper px-2 text-xs text-ink-faint dark:bg-graphite-950">
          or
        </span>
        <div className="h-px flex-1 bg-line dark:bg-line-dark" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="mt-1.5 text-xs text-signal-danger">{errors.email.message}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="mb-1.5 text-xs text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
          {errors.password && (
            <p className="mt-1.5 text-xs text-signal-danger">{errors.password.message}</p>
          )}
        </div>

        {formError && (
          <p role="alert" className="rounded-sm bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
            {formError}
          </p>
        )}

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-8 text-sm text-ink-muted dark:text-white/50">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-medium text-ink underline underline-offset-2 dark:text-white">
          Create one
        </Link>
      </p>
    </div>
  );
}
