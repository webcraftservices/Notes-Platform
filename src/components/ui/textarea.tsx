import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-sm border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint",
        "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        "dark:border-line-dark dark:bg-graphite-800 dark:text-white dark:placeholder:text-white/30",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
