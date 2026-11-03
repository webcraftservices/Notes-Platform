"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import LinesGradientShader from "./zenote-shader-background";
import { ZenoteLogoRevealOverlay } from "./zenote-logo-reveal";

// Module-level flag tracking whether the user has performed client-side navigation
// within this browser tab runtime. Survives Next.js client-side route changes,
// but re-initializes to false upon a fresh document load or hard refresh (Ctrl+Shift+R).
let isClientSideNav = false;

function checkShouldPlayReveal(): boolean {
  if (typeof window === "undefined") {
    // SSR default: render reveal overlay
    return true;
  }

  // 1. Reduced motion: skip immediately
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }

  // 2. Query param forced replay (?replay=1 or ?reveal=1)
  try {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("replay") === "1" || searchParams.get("reveal") === "1") {
      return true;
    }
  } catch {
    // Ignore URL parse error
  }

  // 3. Check session storage for prior completion in this tab/session
  let hasSeenReveal = false;
  let playedOrigin: string | null = null;
  try {
    hasSeenReveal = sessionStorage.getItem("zenote_welcome_reveal_shown") === "true";
    playedOrigin = sessionStorage.getItem("zenote_reveal_origin");
  } catch {
    // Fallback if sessionStorage is inaccessible
    return !isClientSideNav;
  }

  // First visit in fresh session: reveal plays
  if (!hasSeenReveal) {
    return true;
  }

  // 4. Check browser PerformanceNavigationTiming for full document loads
  try {
    const navEntries = window.performance?.getEntriesByType?.("navigation");
    const nav = navEntries && navEntries[0] ? (navEntries[0] as PerformanceNavigationTiming) : null;

    // History traversal (Back/Forward document navigation)
    if (nav?.type === "back_forward") {
      return false;
    }

    // Genuine document reload / hard refresh (Ctrl+Shift+R or F5)
    if (nav?.type === "reload") {
      const currentOrigin = String(window.performance?.timeOrigin || "");

      // Verify that the reload was specifically requested for /welcome
      let isWelcomeReload = true;
      if (nav.name) {
        try {
          const navUrl = new URL(nav.name, window.location.origin);
          isWelcomeReload = navUrl.pathname === "/welcome";
        } catch {
          isWelcomeReload = true;
        }
      }

      // If it is an unplayed reload of /welcome, allow replay
      if (isWelcomeReload && (!playedOrigin || playedOrigin !== currentOrigin)) {
        return true;
      }

      // If it was a reload of /welcome that has already played in this tab lifecycle, do NOT replay on back
      return false;
    }
  } catch {
    // Fallback safely
  }

  // 5. If already seen in this session and not an unplayed reload of /welcome, do NOT replay
  return false;
}

export default function ZenoteWelcomeContent() {
  const router = useRouter();
  const [isExiting, setIsExiting] = useState(false);
  const [revealPhase, setRevealPhase] = useState<"active" | "fading" | "ended">(() => {
    // During client-side navigation (e.g. Back from /welcome/intro), isClientSideNav is true.
    // There is no SSR or hydration pass, so we can initialize directly to "ended" without flicker.
    // On full document load / hydration, isClientSideNav is false, so initialize to "active" to match SSR.
    if (isClientSideNav && !checkShouldPlayReveal()) {
      return "ended";
    }
    return "active";
  });

  useEffect(() => {
    // On full document loads where reveal should not play (e.g. back_forward document navigation or reduced motion),
    // synchronize revealPhase to "ended" immediately after hydration
    if (!checkShouldPlayReveal()) {
      setRevealPhase("ended");
    }

    isClientSideNav = true;

    // Ensure state resets gracefully if returned via browser back/forward cache (bfcache)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsExiting(false);
        setRevealPhase("ended");
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  // Defer route prefetching until after reveal playback completes to protect opening animation performance
  useEffect(() => {
    if (revealPhase !== "active") {
      router.prefetch("/welcome/intro");
    }
  }, [revealPhase, router]);

  const handleAnimationComplete = useCallback(() => {
    try {
      sessionStorage.setItem("zenote_welcome_reveal_shown", "true");
      if (typeof window !== "undefined" && window.performance?.timeOrigin) {
        sessionStorage.setItem("zenote_reveal_origin", String(window.performance.timeOrigin));
      }
    } catch {
      // Ignore storage errors
    }

    setRevealPhase("ended");
  }, []);

  const handleGetStarted = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Preserve standard browser behavior for new tabs, modifier keys, or context menus
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return;
    }

    e.preventDefault();

    try {
      sessionStorage.setItem("zenote_welcome_reveal_shown", "true");
      if (typeof window !== "undefined" && window.performance?.timeOrigin) {
        sessionStorage.setItem("zenote_reveal_origin", String(window.performance.timeOrigin));
      }
    } catch {
      // Ignore storage errors
    }

    // Respect reduced-motion preference immediately
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push("/welcome/intro");
      return;
    }

    if (isExiting) return;

    setIsExiting(true);
    // Graceful 240ms exit fade before router push
    window.setTimeout(() => {
      router.push("/welcome/intro");
    }, 240);
  };

  const isContentVisible = revealPhase !== "active";

  return (
    <main className="relative min-h-screen overflow-hidden bg-graphite-950 flex flex-col justify-center items-center font-sans text-paper">
      {/* Background Shader Layer (paused during reveal playback to eliminate GPU competition) */}
      <LinesGradientShader
        className="z-0"
        background="#101116"
        paused={revealPhase !== "ended"}
      />

      {/* Subtle overlay to ensure text contrast against active shader */}
      <div className="absolute inset-0 bg-graphite-950/20 z-[1] pointer-events-none" />

      {/* One-time Opening Logo Reveal Layer (plays once at beginning, unmounts on completion) */}
      {revealPhase !== "ended" && (
        <ZenoteLogoRevealOverlay onFinish={handleAnimationComplete} />
      )}

      {/* Foreground UI Layer */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[100dvh] w-full px-6 py-12">
        {/* Central Content Block with coordinated entrance and exit transitions */}
        <div
          className={`flex flex-col items-center text-center w-full max-w-2xl mx-auto transition-all duration-500 ease-out ${
            isExiting
              ? "opacity-0 -translate-y-2 pointer-events-none"
              : revealPhase === "active"
                ? "opacity-0 pointer-events-none"
                : "opacity-100 translate-y-0 pointer-events-auto"
          }`}
        >
          {/* Logo Section - Dimension-locked to prevent layout shift; rendered directly in SSR */}
          <div
            className={`flex justify-center items-center mb-12 sm:mb-16 w-[135px] sm:w-[170px] h-[135px] sm:h-[170px] ${
              isContentVisible ? "welcome-animate-logo" : "opacity-0"
            }`}
          >
            <Image
              src="/zenote-logo-transparent.png"
              alt="Zenote"
              width={170}
              height={170}
              priority
              className="w-[135px] sm:w-[170px] h-auto object-contain select-none"
            />
          </div>

          {/* Typography Section */}
          <div className="flex flex-col items-center space-y-5 sm:space-y-6 mb-12 sm:mb-16">
            <h1
              className={`text-4xl sm:text-5xl lg:text-6xl font-display font-medium tracking-tight text-white leading-[1.15] sm:leading-[1.1] max-w-lg drop-shadow-sm ${
                isContentVisible ? "welcome-animate-headline" : "opacity-0"
              }`}
            >
              Your knowledge,<br />in one place.
            </h1>
            <p
              className={`text-[17px] sm:text-xl text-paper/70 font-sans tracking-wide max-w-[280px] sm:max-w-md ${
                isContentVisible ? "welcome-animate-text" : "opacity-0"
              }`}
            >
              One calm place for everything<br className="sm:hidden" /> you learn.
            </p>
          </div>

          {/* CTA Button */}
          <div
            className={`w-full flex justify-center ${
              isContentVisible ? "welcome-animate-button" : "opacity-0"
            }`}
          >
            <Link
              href="/welcome/intro"
              onClick={handleGetStarted}
              aria-disabled={isExiting}
              className={`group relative inline-flex items-center justify-center gap-2 w-[190px] sm:w-[210px] h-[52px] sm:h-[56px] rounded-full overflow-hidden transition-all duration-500 ease-out active:scale-[0.98] hover:shadow-[0_4px_32px_rgba(0,0,0,0.4)] bg-graphite-900/60 backdrop-blur-md border border-white/[0.08] ${
                isExiting ? "pointer-events-none cursor-default" : ""
              }`}
            >
              {/* Subtle hover overlay */}
              <div className="absolute inset-0 bg-white/0 transition-colors duration-300 group-hover:bg-white/[0.03]" />

              <span className="relative z-10 text-[15px] sm:text-base text-paper font-medium tracking-wide">
                Get started
              </span>
              <ArrowRight className="relative z-10 w-4 h-4 text-paper/80 group-hover:translate-x-1 group-hover:text-paper transition-transform duration-300" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
