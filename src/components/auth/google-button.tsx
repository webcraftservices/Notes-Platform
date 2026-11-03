"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function GoogleButton({
  label = "Continue with Google",
  callbackUrl = "/",
  disabled = false,
  className,
}: {
  label?: string;
  callbackUrl?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignIn() {
    if (isLoading || disabled) return;
    setIsLoading(true);
    try {
      await signIn("google", { callbackUrl });
    } catch {
      setIsLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignIn}
      disabled={disabled || isLoading}
      className={cn(
        "h-[48px] sm:h-11 w-full rounded-[8px] border border-white/[0.11] bg-[#121319] px-4 text-[14px] sm:text-[13.5px] font-medium text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-all duration-150 flex items-center justify-center gap-2.5 select-none font-sans",
        "hover:bg-[#171822] hover:text-white hover:border-white/[0.18]",
        "active:scale-[0.99] active:bg-[#1B1C28]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C6CF0]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E0E13]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        className
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-white/70" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
