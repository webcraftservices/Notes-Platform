"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "motion/react";

export interface BorderBeamProps {
  /**
   * The size of the border beam in pixels.
   * @default 200
   */
  size?: number;
  /**
   * The duration of the animation in seconds.
   * @default 15
   */
  duration?: number;
  /**
   * The border width of the beam in pixels.
   * @default 1.5
   */
  borderWidth?: number;
  /**
   * The anchor percentage for the motion path offset anchor.
   * @default 90
   */
  anchor?: number;
  /**
   * Starting color for default gradient when className gradients are not provided.
   */
  colorFrom?: string;
  /**
   * Ending color for default gradient when className gradients are not provided.
   */
  colorTo?: string;
  /**
   * Delay before the animation begins in seconds (can be negative for phase offset).
   * @default 0
   */
  delay?: number;
  /**
   * Whether to reverse the animation direction.
   * @default false
   */
  reverse?: boolean;
  /**
   * Initial offset percentage along the path (0 to 100).
   * @default 0
   */
  initialOffset?: number;
  /**
   * Additional CSS classes for custom gradient colors and styling.
   */
  className?: string;
  /**
   * Inline style overrides.
   */
  style?: React.CSSProperties;
}

/**
 * BorderBeam
 *
 * An animated visual effect that creates a glowing beam of light tracing along
 * the border of a rounded container. Uses GPU-accelerated CSS keyframe animation
 * for continuous, smooth, stutter-free movement.
 */
export const BorderBeam = React.memo(function BorderBeam({
  className,
  size = 200,
  duration = 15,
  borderWidth = 1.5,
  anchor = 90,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  delay = 0,
  reverse = false,
  initialOffset = 0,
  style,
}: BorderBeamProps) {
  const shouldReduceMotion = useReducedMotion();

  // If user prefers reduced motion, disable the beam animation to respect accessibility
  if (shouldReduceMotion) {
    return null;
  }

  const hasCustomGradient = className?.includes("from-") || className?.includes("via-") || className?.includes("to-");

  // Modestly scale animation duration from 6s to 8s (speed factor 8/6 = 4/3) for a calmer, premium pace.
  // Preserves exact relative phase relationship (e.g. delay 3s scales to 4s, which is 50% of 8s).
  const SPEED_FACTOR = 8 / 6;
  const effectiveDuration = duration * SPEED_FACTOR;
  const effectiveDelay = delay * SPEED_FACTOR;

  // Negative animation delay starts the animation immediately with the specified phase offset
  // (e.g. -4s starts halfway through an 8s animation, preventing any initial freeze or pause)
  const animDelay = effectiveDelay ? `-${effectiveDelay}s` : "0s";

  return (
    <div
      style={
        {
          padding: `${borderWidth}px`,
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
          ...style,
        } as React.CSSProperties
      }
      className="pointer-events-none absolute inset-0 rounded-[inherit] select-none overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={cn(
          "absolute aspect-square bg-gradient-to-l pointer-events-none will-change-[transform,offset-distance]",
          hasCustomGradient
            ? ""
            : "from-transparent via-[var(--color-from)] to-[var(--color-to)]",
          className
        )}
        style={
          {
            width: `${size}px`,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            offsetAnchor: `${anchor}% 50%`,
            animation: `border-beam ${effectiveDuration}s linear infinite`,
            animationDelay: animDelay,
            animationDirection: reverse ? "reverse" : "normal",
            "--color-from": colorFrom,
            "--color-to": colorTo,
          } as React.CSSProperties
        }
      />
    </div>
  );
});

BorderBeam.displayName = "BorderBeam";

export default BorderBeam;
