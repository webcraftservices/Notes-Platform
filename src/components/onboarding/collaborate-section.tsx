"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { OrbitingCircles } from "@/registry/magicui/orbiting-circles";

const EASE = [0.25, 0.1, 0.25, 1.0] as const;

export function CollaborateSection() {
  const shouldReduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const getTransition = (delay: number) => {
    if (shouldReduceMotion) {
      return { duration: 0 };
    }
    return {
      duration: 0.55,
      delay,
      ease: EASE,
    };
  };

  return (
    <section
      id="collaborate"
      aria-labelledby="collaborate-heading"
      className="relative w-full py-16 sm:py-20 md:py-24 lg:py-28 px-4 sm:px-8 md:px-12 overflow-hidden"
    >
      <div className="mx-auto max-w-7xl flex flex-col items-center">
        {/* Section Heading & Copy */}
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={getTransition(0)}
          className="flex flex-col text-center items-center max-w-2xl mb-8 sm:mb-12"
        >
          {/* Eyebrow */}
          <p className="font-maname text-[12px] sm:text-[13px] font-medium tracking-[0.2em] uppercase text-amber-400/90 mb-3 sm:mb-3.5">
            COLLABORATE WITH YOUR GROUP
          </p>

          {/* Main Heading */}
          <h2
            id="collaborate-heading"
            className="font-noto text-[30px] sm:text-[38px] md:text-[42px] lg:text-[45px] font-[650] leading-[1.16] tracking-[0.01em] text-white text-balance max-w-[340px] sm:max-w-md lg:max-w-xl mb-4 sm:mb-4.5"
          >
            Knowledge grows when shared.
          </h2>

          {/* Supporting Description */}
          <p className="font-maname text-[15px] sm:text-[16px] md:text-[16.5px] font-normal leading-[1.68] text-neutral-400 text-pretty max-w-[360px] sm:max-w-lg">
            Bring your group together around shared materials, ideas, and learning.
          </p>
        </motion.div>

        {/* Orbiting Circles Animation Arena */}
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, scale: shouldReduceMotion ? 1 : 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={getTransition(0.1)}
          className="relative flex h-[460px] sm:h-[520px] md:h-[550px] w-full max-w-2xl flex-col items-center justify-center overflow-hidden"
        >
          {/* Stationary Center: Real Zenote Logo (Clean presentation without glow/halo) */}
          <div
            title="Zenote"
            className="z-10 flex size-[62px] sm:size-[72px] items-center justify-center rounded-full bg-[#121316] border border-white/10 p-3 sm:p-3.5 shadow-md shadow-black/60 ring-1 ring-white/5"
          >
            <Image
              src="/zenote-logo-transparent.png"
              alt="Zenote"
              width={72}
              height={72}
              priority
              className="h-full w-full object-contain select-none pointer-events-none"
            />
          </div>

          {/* Outer Orbit: 5 Premium 3D-Style User Avatars (Enlarged ~10-15%) */}
          <OrbitingCircles
            iconSize={isMobile ? 38 : 44}
            radius={isMobile ? 145 : 180}
          >
            <div
              title="Group member"
              className="relative size-full overflow-hidden rounded-full border-[1.5px] border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/40 bg-neutral-900"
            >
              <Image
                src="/avatars/avatar-1.jpg"
                alt="Group member"
                width={88}
                height={88}
                priority
                unoptimized
                className="size-full object-cover scale-110 select-none pointer-events-none"
              />
            </div>
            <div
              title="Group member"
              className="relative size-full overflow-hidden rounded-full border-[1.5px] border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/40 bg-neutral-900"
            >
              <Image
                src="/avatars/avatar-2.jpg"
                alt="Group member"
                width={88}
                height={88}
                priority
                unoptimized
                className="size-full object-cover scale-110 select-none pointer-events-none"
              />
            </div>
            <div
              title="Group member"
              className="relative size-full overflow-hidden rounded-full border-[1.5px] border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/40 bg-neutral-900"
            >
              <Image
                src="/avatars/avatar-3.jpg"
                alt="Group member"
                width={88}
                height={88}
                priority
                unoptimized
                className="size-full object-cover scale-110 select-none pointer-events-none"
              />
            </div>
            <div
              title="Group member"
              className="relative size-full overflow-hidden rounded-full border-[1.5px] border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/40 bg-neutral-900"
            >
              <Image
                src="/avatars/avatar-4.jpg"
                alt="Group member"
                width={88}
                height={88}
                priority
                unoptimized
                className="size-full object-cover scale-110 select-none pointer-events-none"
              />
            </div>
            <div
              title="Group member"
              className="relative size-full overflow-hidden rounded-full border-[1.5px] border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/40 bg-neutral-900"
            >
              <Image
                src="/avatars/avatar-5.jpg"
                alt="Group member"
                width={88}
                height={88}
                priority
                unoptimized
                className="size-full object-cover scale-110 select-none pointer-events-none"
              />
            </div>
          </OrbitingCircles>

          {/* Inner Orbit: 4 Zenote Source & Material Icons (Enlarged ~10-15%) */}
          <OrbitingCircles
            iconSize={isMobile ? 29 : 34}
            radius={isMobile ? 85 : 115}
            reverse
            speed={2}
          >
            <div
              title="Google Drive"
              className="flex size-full items-center justify-center rounded-full bg-white p-1 sm:p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.35)] border border-neutral-200/50"
            >
              <Icons.googleDrive />
            </div>
            <div
              title="PDF Document"
              className="flex size-full items-center justify-center rounded-full bg-white p-1 sm:p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.35)] border border-neutral-200/50"
            >
              <Icons.pdf />
            </div>
            <div
              title="Audio & Lecture Recordings"
              className="flex size-full items-center justify-center rounded-full bg-white p-1 sm:p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.35)] border border-neutral-200/50"
            >
              <Icons.audio />
            </div>
            <div
              title="Google Docs"
              className="flex size-full items-center justify-center rounded-full bg-white p-1 sm:p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.35)] border border-neutral-200/50"
            >
              <Icons.googleDocs />
            </div>
          </OrbitingCircles>
        </motion.div>
      </div>
    </section>
  );
}

const Icons = {
  googleDrive: () => (
    <svg
      viewBox="0 0 87.3 78"
      className="size-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  ),

  googleDocs: () => (
    <svg
      viewBox="0 0 47 65"
      className="size-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M29.375,0 L4.40625,0 C1.9828125,0 0,1.99431818 0,4.43181818 L0,60.5681818 C0,63.0056818 1.9828125,65 4.40625,65 L42.59375,65 C45.0171875,65 47,63.0056818 47,60.5681818 L47,17.7272727 L29.375,0 Z"
        fill="#4285F4"
      />
      <polygon
        fill="#1A73E8"
        points="29.375 0 47 17.7272727 29.375 17.7272727"
      />
      <path
        d="M11.75,32.5 L35.25,32.5 L35.25,35.4545455 L11.75,35.4545455 Z M11.75,41.3636364 L35.25,41.3636364 L35.25,38.4090909 L11.75,38.4090909 Z M11.75,47.2727273 L35.25,47.2727273 L35.25,44.3181818 L11.75,44.3181818 Z M11.75,53.1818182 L27.375,53.1818182 L27.375,50.2272727 L11.75,50.2272727 Z"
        fill="#FFFFFF"
      />
    </svg>
  ),

  pdf: () => (
    <svg
      viewBox="0 0 96 96"
      className="size-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="18" y="14" width="60" height="68" rx="8" fill="#E5252A" />
      <path d="M56 14l22 22H56V14z" fill="#B31B1F" />
      <path
        d="M30 46h8a5 5 0 0 1 0 10h-4v8h-4V46zm4 6h4a1.5 1.5 0 0 0 0-3h-4v3zm13-6h7a7 7 0 0 1 0 18h-7V46zm4 14h3a3 3 0 0 0 0-10h-3v10zm12-14h10v4h-6v3h5v4h-5v7h-4V46z"
        fill="#ffffff"
      />
    </svg>
  ),

  audio: () => (
    <svg
      viewBox="0 0 96 96"
      className="size-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="16" y="16" width="64" height="64" rx="16" fill="#7C6CF0" />
      <rect x="28" y="40" width="5" height="16" rx="2.5" fill="#ffffff" />
      <rect x="37" y="32" width="5" height="32" rx="2.5" fill="#ffffff" />
      <rect x="46" y="24" width="5" height="48" rx="2.5" fill="#ffffff" />
      <rect x="55" y="32" width="5" height="32" rx="2.5" fill="#ffffff" />
      <rect x="64" y="40" width="5" height="16" rx="2.5" fill="#ffffff" />
    </svg>
  ),
};

export default CollaborateSection;
