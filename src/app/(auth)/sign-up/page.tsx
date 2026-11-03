import { Suspense } from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Create your Zenote account to record lectures, organize materials, and build your knowledge workspace.",
  alternates: {
    canonical: "/sign-up",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="min-h-[460px] w-full" aria-hidden="true" />}>
      <SignUpForm />
    </Suspense>
  );
}
