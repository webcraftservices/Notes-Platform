"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ShineBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Width of the border in pixels
   * @default 1.5
   */
  borderWidth?: number;
  /**
   * Duration of the animation in seconds
   * @default 10
   */
  duration?: number;
  /**
   * Color of the border, can be a single color or an array of colors
   * @default ["#A07CFE", "#FE8FB5", "#FFBE7B"]
   */
  shineColor?: string | string[];
}

/**
 * Shine Border
 *
 * An animated background border effect component with configurable properties from Magic UI.
 */
export function ShineBorder({
  borderWidth = 1.5,
  duration = 10,
  shineColor = ["#A07CFE", "#FE8FB5", "#FFBE7B"],
  className,
  style,
  children,
  ...props
}: ShineBorderProps) {
  return (
    <div
      style={
        {
          "--border-width": `${borderWidth}px`,
          "--duration": `${duration}s`,
          backgroundImage: `radial-gradient(transparent,transparent, ${
            Array.isArray(shineColor) ? shineColor.join(",") : shineColor
          },transparent,transparent)`,
          backgroundSize: "300% 300%",
          mask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "var(--border-width)",
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        "motion-safe:animate-shine pointer-events-none absolute inset-0 size-full rounded-[inherit] will-change-[background-position]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
