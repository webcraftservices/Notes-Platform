"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { cx, useMediaQuery, ZENOTE_ACCENT } from "./shared";
import { type LucideIcon } from "lucide-react";

/**
 * Zenote brand multicolour beam stops:
 * Violet -> Magenta -> Pink -> Orange -> Gold.
 * Restored from the original brand identity.
 */
const STOPS: Array<{ offset: string; color: string; opacity?: number }> = [
  { offset: "0%", color: ZENOTE_ACCENT.violet, opacity: 0.1 },
  { offset: "5%", color: ZENOTE_ACCENT.violet, opacity: 1 },
  { offset: "28%", color: ZENOTE_ACCENT.magenta, opacity: 1 },
  { offset: "52%", color: ZENOTE_ACCENT.pink, opacity: 1 },
  { offset: "76%", color: ZENOTE_ACCENT.orange, opacity: 1 },
  { offset: "95%", color: ZENOTE_ACCENT.gold, opacity: 1 },
  { offset: "100%", color: ZENOTE_ACCENT.gold, opacity: 0.8 },
];

/**
 * TracingBeam — positioned along the RIGHT side of the workflow story.
 *
 * Technical Architecture:
 * - Stable, fixed-length stationary SVG track.
 * - Direct, 1:1 scroll-linked progression via `pathLength: scrollYProgress` without
 *   artificial spring damping or delay, eliminating lag in both forward and reverse scrolling.
 * - Polished endpoint terminal marker at (30, effectiveHeight) seamlessly revealed as
 *   the beam reaches the section boundary.
 * - `vectorEffect="non-scaling-stroke"` ensures the stroke width is strictly 1.25px across all screens.
 * - Thin, clean stroke with the authentic Zenote violet -> magenta -> pink -> orange -> gold gradient.
 * - Dedicated right-side rail column co-axial with step indicator nodes.
 */
export function TracingBeam({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const gradientId = `zenote-beam-${useId().replace(/:/g, "")}`;
  const [svgHeight, setSvgHeight] = useState(0);

  // Dynamic measuring via ResizeObserver to guarantee 1:1 pixel coordinate tracking
  useEffect(() => {
    const updateHeight = () => {
      if (contentRef.current) {
        setSvgHeight(contentRef.current.offsetHeight);
      }
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    if (contentRef.current) {
      ro.observe(contentRef.current);
    }
    window.addEventListener("resize", updateHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  // Track scroll through the section with natural 1:1 progression.
  // Direct scroll tracking eliminates spring lag and trailing delay.
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 55%", "end 82%"],
  });

  // Reveal the endpoint terminal marker cleanly as the beam finishes its outward bend
  const endpointOpacity = useTransform(scrollYProgress, [0.88, 0.95], [0, 1]);
  const endpointScale = useTransform(scrollYProgress, [0.88, 0.95], [0.4, 1]);

  const effectiveHeight = svgHeight || 1800;

  // Characteristic Aceternity endpoint geometry adapted for Zenote's right-side rail:
  // Runs vertically at x=16 through the step nodes, then near the bottom of Step 04
  // introduces one short, clean bend curving OUTWARD to the right (dx=+14, from x=16 to x=30)
  // away from the content cards, terminating cleanly at the right boundary of the rail (x=30)
  // and bottom boundary (effectiveHeight).
  const bendOffset = 48;
  const bendStartY = Math.max(0, effectiveHeight - bendOffset);
  const pathD = `M 16 0 V ${bendStartY} C 16 ${bendStartY + 10}, 30 ${bendStartY + 14}, 30 ${bendStartY + 24} V ${effectiveHeight}`;

  return (
    <div
      ref={containerRef}
      className={cx(
        "relative w-full max-w-[780px] sm:max-w-[820px] md:max-w-[860px] mx-auto px-2.5 xs:px-3 sm:px-6 md:px-7",
        className
      )}
    >
      <div
        ref={contentRef}
        className="relative w-full flex flex-col gap-7 sm:gap-11 md:gap-13"
      >
        {/*
          RIGHT-SIDE CONTINUOUS SVG BEAM RAIL:
          Anchored at right-0, width 32px (w-8).
          The vertical path is centered at x=16 through all step nodes,
          with a clean outward bend near the bottom meeting the section boundary.
        */}
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 right-0 w-8 pointer-events-none flex justify-center z-0 overflow-visible"
        >
          <svg
            viewBox={`0 0 32 ${effectiveHeight}`}
            width="32"
            height={effectiveHeight}
            className="w-full h-full block overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id={gradientId}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2="0"
                y2={effectiveHeight}
              >
                {STOPS.map((stop, i) => (
                  <stop
                    key={i}
                    offset={stop.offset}
                    stopColor={stop.color}
                    stopOpacity={stop.opacity ?? 1}
                  />
                ))}
              </linearGradient>
            </defs>

            {/* Stationary subtle background track */}
            <path
              d={pathD}
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.12"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Drawn beam line with direct 1:1 scroll progression */}
            {reduceMotion ? (
              <>
                <path
                  d={pathD}
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth="1.25"
                  strokeOpacity="0.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx="30"
                  cy={effectiveHeight}
                  r="2.25"
                  fill={ZENOTE_ACCENT.gold}
                />
              </>
            ) : (
              <>
                <motion.path
                  d={pathD}
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ pathLength: scrollYProgress }}
                />
                {/* Subtle, polished endpoint terminal cap matching the gold gradient finish */}
                <motion.circle
                  cx="30"
                  cy={effectiveHeight}
                  r="2.25"
                  fill={ZENOTE_ACCENT.gold}
                  style={{
                    opacity: endpointOpacity,
                    scale: endpointScale,
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                />
              </>
            )}
          </svg>
        </div>

        {/* Workflow steps */}
        {children}
      </div>
    </div>
  );
}

export interface TracingBeamStepProps {
  index: string;
  tag: string;
  title?: string;
  line?: string;
  description: string;
  tone?: string;
  icon?: LucideIcon;
  illustration?: React.ReactNode;
  anchor?: React.ReactNode;
  features?: string[];
  isFirst?: boolean;
  isLast?: boolean;
  totalSteps?: string;
  className?: string;
}

/**
 * Editorial workflow step card with distinct right-side co-axial node indicator.
 */
export function TracingBeamStep({
  index,
  tag,
  title,
  line,
  description,
  tone = ZENOTE_ACCENT.violet,
  icon: Icon,
  illustration,
  anchor,
  className,
}: TracingBeamStepProps) {
  const stepRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: stepRef,
    offset: ["start 65%", "start 25%"],
  });

  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const check = (latest: number) => {
      const active = latest > 0.05;
      setIsActive((prev) => (prev !== active ? active : prev));
    };
    check(scrollYProgress.get());
    return scrollYProgress.on("change", check);
  }, [scrollYProgress]);

  // Support both `line` or `title` as the headline
  const headline = line || title;

  return (
    <div
      ref={stepRef}
      className={cx(
        "relative w-full group flex items-start gap-2 sm:gap-4 md:gap-6",
        className
      )}
    >
      {/*
        Art-Directed Feature Storytelling Card:
        Clean, near-black surface with fine subtle border, surface contrast, and bespoke illustration.
      */}
      <div className="flex-1 min-w-0 relative p-3.5 sm:p-7 md:p-8 rounded-xl sm:rounded-2xl bg-[#121316] border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.36)] transition-all duration-300 hover:border-white/[0.13] overflow-hidden">
        {/* Subtle top hairline highlight */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none"
        />

        {/* Card Header: Step Tag and Lucide Icon */}
        <div className="flex items-center justify-between gap-2.5 mb-2 sm:mb-3">
          <div className="flex items-center gap-2">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: tone }}
              aria-hidden="true"
            />
            <span className="font-maname text-[10.5px] sm:text-[12px] font-semibold tracking-[0.2em] uppercase text-neutral-400">
              {tag}
            </span>
          </div>

          {Icon ? (
            <div
              className="flex items-center justify-center size-7 sm:size-9 rounded-lg bg-white/[0.03] border border-white/[0.06] text-neutral-400 group-hover:text-white transition-colors"
              aria-hidden="true"
            >
              <Icon className="size-3.5 sm:size-4" strokeWidth={1.75} />
            </div>
          ) : null}
        </div>

        {/* Step Proposition Headline */}
        {headline ? (
          <h3 className="font-noto text-[18px] sm:text-[23px] md:text-[25px] font-[650] leading-[1.24] tracking-[0.01em] text-white mb-1.5 sm:mb-2.5">
            {headline}
          </h3>
        ) : null}

        {/* Descriptive copy */}
        <p className="font-maname text-[12.5px] sm:text-[14.5px] font-normal leading-[1.65] sm:leading-[1.7] text-neutral-400 max-w-xl mb-3.5 sm:mb-5">
          {description}
        </p>

        {/* Feature Illustration */}
        {illustration || anchor ? (
          <div className="pt-0.5 sm:pt-1">
            {illustration || anchor}
          </div>
        ) : null}
      </div>

      {/*
        RIGHT-SIDE STEP NODE INDICATOR:
        Shares the exact horizontal coordinate column (right-0, width 32px / w-8).
        pt-[18px] sm:pt-[30px] md:pt-[34px] aligns the node vertically with the card header / tag row.
        Centered at x = 16px, EXACTLY coaxial with the SVG path M 16.
        The opaque #0E0E10 background ensures the line meets the outside top edge of the node
        cleanly and emerges from the outside bottom edge, never running awkwardly through its interior.
      */}
      <div
        aria-hidden="true"
        className="w-8 shrink-0 flex justify-center pt-[18px] sm:pt-[30px] md:pt-[34px] z-10 pointer-events-none select-none"
      >
        <div
          className={cx(
            "relative size-4 sm:size-[18px] rounded-full bg-[#0E0E10] border-[1.5px] transition-all duration-300 flex items-center justify-center",
            isActive ? "shadow-sm" : "border-neutral-700/80"
          )}
          style={{
            borderColor: isActive ? tone : undefined,
            boxShadow: isActive ? `0 0 8px ${tone}35` : undefined,
          }}
        >
          {/* Legible center dot */}
          <div
            className={cx(
              "size-1.5 sm:size-2 rounded-full transition-all duration-300",
              isActive ? "scale-100" : "scale-90 bg-neutral-600"
            )}
            style={isActive ? { backgroundColor: tone } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
