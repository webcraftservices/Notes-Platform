"use client";

import React, { forwardRef, useRef } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { AnimatedBeam } from "@/registry/magicui/animated-beam";

const Circle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode; title?: string }
>(({ className, children, title }, ref) => {
  return (
    <div
      ref={ref}
      title={title}
      className={cn(
        "z-10 flex size-12 items-center justify-center rounded-full border-2 bg-white p-3 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)]",
        className,
      )}
    >
      {children}
    </div>
  );
});

Circle.displayName = "Circle";

export function ConnectedSourcesSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const div1Ref = useRef<HTMLDivElement>(null); // Google Drive
  const div2Ref = useRef<HTMLDivElement>(null); // Word Document
  const div3Ref = useRef<HTMLDivElement>(null); // Audio / Lecture Recording
  const div4Ref = useRef<HTMLDivElement>(null); // Zenote Central Hub
  const div5Ref = useRef<HTMLDivElement>(null); // Google Docs
  const div6Ref = useRef<HTMLDivElement>(null); // PowerPoint / Slides
  const div7Ref = useRef<HTMLDivElement>(null); // PDF Document

  return (
    <section
      id="connected-sources"
      aria-labelledby="connected-sources-heading"
      className="relative w-full py-16 sm:py-20 md:py-24 lg:py-28 px-4 sm:px-8 md:px-12 overflow-hidden"
    >
      <div className="mx-auto max-w-7xl flex flex-col items-center">
        {/* Section Heading & Copy */}
        <div className="flex flex-col text-center items-center max-w-2xl mb-8 sm:mb-12">
          {/* Eyebrow: Maname, uppercase, amber accent */}
          <p className="font-maname text-[12px] sm:text-[13px] font-medium tracking-[0.2em] uppercase text-amber-400/90 mb-3 sm:mb-3.5">
            CONNECTED SOURCES
          </p>

          {/* Main Heading: Noto Serif Variable, editorial serif contrast */}
          <h2
            id="connected-sources-heading"
            className="font-noto text-[30px] sm:text-[38px] md:text-[42px] lg:text-[45px] font-[650] leading-[1.16] tracking-[0.01em] text-white text-balance max-w-[340px] sm:max-w-md lg:max-w-xl mb-4 sm:mb-4.5"
          >
            ALL YOUR SOURCES. ONE WORKSPACE.
          </h2>

          {/* Supporting Description: Maname */}
          <p className="font-maname text-[15px] sm:text-[16px] md:text-[16.5px] font-normal leading-[1.68] text-neutral-400 text-pretty max-w-[360px] sm:max-w-lg">
            Bring your files and knowledge together in Zenote, with your
            resources organized in one place instead of scattered across
            different apps.
          </p>
        </div>

        {/* Central Hub & Connected Sources Illustration: Original Component Structure & Animation */}
        <div
          className="relative flex h-[300px] w-full items-center justify-center overflow-hidden p-4 sm:p-10"
          ref={containerRef}
        >
          <div className="flex size-full max-h-[200px] max-w-lg flex-col items-stretch justify-between gap-10">
            {/* Row 1: Top Left (Google Drive) & Top Right (Google Docs) */}
            <div className="flex flex-row items-center justify-between">
              <Circle ref={div1Ref} title="Google Drive">
                <Icons.googleDrive />
              </Circle>
              <Circle ref={div5Ref} title="Google Docs">
                <Icons.googleDocs />
              </Circle>
            </div>

            {/* Row 2: Middle Left (Word), Center (Zenote), Middle Right (PowerPoint) */}
            <div className="flex flex-row items-center justify-between">
              <Circle ref={div2Ref} title="Word Document">
                <Icons.word />
              </Circle>
              <Circle
                ref={div4Ref}
                title="Zenote"
                className="size-16 bg-[#0E0E10] border-neutral-700/80 p-2.5 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)]"
              >
                <Image
                  src="/zenote-logo-transparent.png"
                  alt="Zenote"
                  width={64}
                  height={64}
                  priority
                  className="h-full w-full object-contain select-none pointer-events-none"
                />
              </Circle>
              <Circle ref={div6Ref} title="PowerPoint Presentation">
                <Icons.powerPoint />
              </Circle>
            </div>

            {/* Row 3: Bottom Left (Audio Recording) & Bottom Right (PDF) */}
            <div className="flex flex-row items-center justify-between">
              <Circle ref={div3Ref} title="Audio & Lecture Recordings">
                <Icons.audio />
              </Circle>
              <Circle ref={div7Ref} title="PDF Document">
                <Icons.pdf />
              </Circle>
            </div>
          </div>

          {/* Original Animated Beams */}
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={div1Ref}
            toRef={div4Ref}
            curvature={-75}
            endYOffset={-10}
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={div2Ref}
            toRef={div4Ref}
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={div3Ref}
            toRef={div4Ref}
            curvature={75}
            endYOffset={10}
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={div5Ref}
            toRef={div4Ref}
            curvature={-75}
            endYOffset={-10}
            reverse
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={div6Ref}
            toRef={div4Ref}
            reverse
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={div7Ref}
            toRef={div4Ref}
            curvature={75}
            endYOffset={10}
            reverse
          />
        </div>
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

  word: () => (
    <svg
      viewBox="0 0 96 96"
      className="size-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="24" y="16" width="56" height="64" rx="8" fill="#103F91" />
      <path
        d="M48 34h20v4H48zm0 10h20v4H48zm0 10h14v4H48z"
        fill="#4B82DD"
        opacity="0.8"
      />
      <rect x="16" y="24" width="46" height="48" rx="8" fill="#185ABD" />
      <path
        d="M25 38h5.2l3.4 13 3.6-13h4.2l3.6 13 3.4-13H49l-5.6 20h-4.8l-3.6-12.5L31.4 58h-4.8L21 38h4z"
        fill="#ffffff"
      />
    </svg>
  ),

  powerPoint: () => (
    <svg
      viewBox="0 0 96 96"
      className="size-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="24" y="16" width="56" height="64" rx="8" fill="#C43E1C" />
      <rect x="46" y="32" width="22" height="12" rx="3" fill="#FF8A65" opacity="0.9" />
      <rect x="46" y="50" width="22" height="12" rx="3" fill="#FF8A65" opacity="0.9" />
      <rect x="16" y="24" width="46" height="48" rx="8" fill="#D24726" />
      <path
        d="M34 38h9a7 7 0 0 1 0 14h-4v8h-5V38zm5 9h4a2 2 0 1 0 0-4h-4v4z"
        fill="#ffffff"
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
