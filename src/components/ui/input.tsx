import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-sm border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint",
        "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        "dark:border-line-dark dark:bg-graphite-800 dark:text-white dark:placeholder:text-white/30",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn("mb-1.5 block text-[13px] font-medium text-ink-muted dark:text-white/60", className)}
    {...props}
  />
);
