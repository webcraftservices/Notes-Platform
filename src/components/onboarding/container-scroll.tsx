"use client";
import React, { useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { cx, useMediaQuery } from "./shared";

// Motion profiles. `end` = how much of the scroll range is used to reach the
// final straight state (mobile arrives sooner).
const PROFILES = {
  mobile: { rotate: 9, scale: 0.95, perspective: 800, headerY: -24, cardY: 28, end: 0.8 },
  tablet: { rotate: 13, scale: 0.94, perspective: 1000, headerY: -48, cardY: 40, end: 0.9 },
  desktop: { rotate: 16, scale: 0.92, perspective: 1200, headerY: -72, cardY: 56, end: 1 },
} as const;

export function ContainerScroll({
  titleComponent,
  children,
  className,
  /** Tailwind aspect classes for the screen. Swap when the real preview lands. */
  aspectClassName = "aspect-[4/5] md:aspect-[16/10]",
}: {
  titleComponent: React.ReactNode;
  /** Usually an <img className="h-full w-full object-cover object-top" />. */
  children: React.ReactNode;
  className?: string;
  aspectClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isTabletUp = useMediaQuery("(min-width: 768px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const p = isDesktop ? PROFILES.desktop : isTabletUp ? PROFILES.tablet : PROFILES.mobile;

  // offset ["start 90%", "center 50%"]: progress is 0 when the section's top edge is
  // 90% of the way down the viewport (just about to enter) and 1 when the section's
  // center reaches the viewport's center. Each profile's `end` is the fraction of that
  // range after which the card is already straight (mobile arrives earliest).
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 90%", "center 50%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.0005 });

  const rotateX = useTransform(progress, [0, p.end], [p.rotate, 0]);
  const scale = useTransform(progress, [0, p.end], [p.scale, 1]);
  const cardY = useTransform(progress, [0, p.end], [p.cardY, 0]);
  const headerY = useTransform(progress, [0, p.end], [0, p.headerY]);

  return (
    <div
      ref={ref}
      className={cx("relative overflow-x-clip px-3 py-16 md:px-8 md:py-28 lg:py-40", className)}
    >
      <div className="mx-auto max-w-6xl" style={{ perspective: p.perspective }}>
        <motion.div
          style={reduceMotion ? undefined : { y: headerY }}
          className="mx-auto max-w-3xl text-center"
        >
          {titleComponent}
        </motion.div>

        <motion.div
          style={reduceMotion ? undefined : { rotateX, scale, y: cardY }}
          className="mx-auto mt-10 w-full max-w-5xl rounded-[20px] border border-white/10 bg-[#17171a] p-1.5 shadow-[0_12px_28px_-12px_rgba(0,0,0,0.45)] will-change-transform md:mt-14 md:rounded-[30px] md:p-3 md:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.45),0_12px_24px_-12px_rgba(0,0,0,0.3)]"
        >
          <div
            className={cx(
              "w-full overflow-hidden rounded-[14px] bg-neutral-200 md:rounded-[20px] dark:bg-neutral-900",
              aspectClassName,
            )}
          >
            {children}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
