"use client";
import React, { useId, useRef } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { cx, useMediaQuery, ZENOTE_ACCENT } from "./shared";

const STOPS: Array<[number, string]> = [
  [0, ZENOTE_ACCENT.violet],
  [0.35, ZENOTE_ACCENT.magenta],
  [0.65, ZENOTE_ACCENT.pink],
  [0.85, ZENOTE_ACCENT.orange],
  [1, ZENOTE_ACCENT.gold],
];

/**
 * Tracing Beam — positioned near the RIGHT viewport edge.
 *
 * The beam is a thin vertical SVG line that progressively draws as the user
 * scrolls through the content. It sits flush against the right boundary of
 * the viewport, acting as a subtle visual thread guiding the reader down
 * the Zenote story — not as a conventional left-gutter timeline.
 *
 * Height is pure CSS (SVG stretched with preserveAspectRatio="none"), so
 * there is no measuring, no ResizeObserver, and nothing to go stale.
 */
export function TracingBeam({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const gradientId = `zenote-beam-${useId().replace(/:/g, "")}`;

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 60%", "end 60%"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.0005,
  });

  const PATH = "M10 0V100";
  const stroke = `url(#${gradientId})`;

  return (
    <div
      ref={ref}
      className={cx("relative mx-auto w-full max-w-4xl px-[6vw] md:px-8", className)}
    >
      {/* Beam positioned near right viewport edge */}
      <svg
        aria-hidden="true"
        viewBox="0 0 20 100"
        preserveAspectRatio="none"
        className="absolute inset-y-0 right-3 h-full w-4 md:right-4 lg:right-0"
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2="100"
          >
            {STOPS.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>

        {/* Static track */}
        <path
          d={PATH}
          fill="none"
          stroke="#9091A0"
          strokeOpacity="0.12"
          strokeWidth="1"
        />

        {reduceMotion ? (
          <path
            d={PATH}
            fill="none"
            stroke={stroke}
            strokeWidth="1.25"
            strokeOpacity="0.55"
          />
        ) : (
          <>
            {/* Soft halo */}
            <motion.path
              d={PATH}
              fill="none"
              stroke={stroke}
              strokeWidth="4"
              strokeOpacity="0.08"
              style={{ pathLength: progress }}
            />
            {/* Core line */}
            <motion.path
              d={PATH}
              fill="none"
              stroke={stroke}
              strokeWidth="1.25"
              style={{ pathLength: progress }}
            />
          </>
        )}
      </svg>

      {/* Content — no large left padding, beam is on the right edge */}
      <div className="pr-8 md:pr-12">{children}</div>
    </div>
  );
}

import { LucideIcon } from "lucide-react";

/** Editorial story marker. Lights up as the beam reaches it. */
export function TracingBeamStep({
  index,
  title,
  description,
  tone = ZENOTE_ACCENT.pink,
  icon: Icon,
  className,
  isFirst = false,
}: {
  index: string;
  title: string;
  description: string;
  tone?: string;
  icon?: LucideIcon;
  className?: string;
  isFirst?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 70%", "start 40%"],
  });

  return (
    <div
      ref={ref}
      className={cx(
        "relative",
        isFirst ? "pt-2 md:pt-4 pb-12 md:pb-20" : "py-12 md:py-20",
        className,
      )}
    >
      {/* Beam node — positioned on the right side, aligned with the beam */}
      <span
        aria-hidden="true"
        className={cx(
          "absolute -right-8 flex h-5 w-5 items-center justify-center md:-right-12",
          isFirst ? "top-6 md:top-8" : "top-16 md:top-24"
        )}
      >
        <span className="relative h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700">
          <motion.span
            style={{
              background: tone,
              opacity: reduceMotion ? 1 : scrollYProgress,
            }}
            className="absolute inset-0 rounded-full"
          />
        </span>
      </span>

      <motion.div
        initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: isFirst ? "0px" : "-10%" }}
        transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1.0] }}
        className="relative p-6 md:p-10 rounded-2xl bg-[#141416] border border-white/[0.04] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      >
        <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/[0.02] pointer-events-none" />
        
        {/* Subtle left gradient accent using the 'tone' color */}
        <div 
          className="absolute top-0 bottom-0 left-0 w-[2px] rounded-l-2xl opacity-60"
          style={{ background: `linear-gradient(180deg, transparent, ${tone}, transparent)` }}
        />

        <div className="flex items-center gap-4 mb-6">
          <div 
            className="flex items-center justify-center w-10 h-10 rounded-full bg-[#1A1A1D] border border-white/5 shadow-inner"
            style={{ color: tone }}
          >
            {Icon ? <Icon size={18} strokeWidth={2.5} /> : null}
          </div>
          <div className="text-xs font-bold tracking-[0.2em] uppercase" style={{ color: tone }}>
            {index}
          </div>
        </div>

        <h3 className="text-2xl font-medium tracking-tight text-neutral-50 sm:text-3xl md:text-4xl">
          {title}
        </h3>
        <p className="mt-4 text-base leading-relaxed text-neutral-400 md:text-lg">
          {description}
        </p>
      </motion.div>
    </div>
  );
}
