import { Suspense } from "react";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to Zenote to access your notes, lecture recordings, and organized knowledge.",
  alternates: {
    canonical: "/sign-in",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-[420px] w-full" aria-hidden="true" />}>
      <SignInForm />
    </Suspense>
  );
}
