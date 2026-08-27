import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-sm font-medium transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          variant === "primary" &&
            "bg-ink text-paper hover:bg-ink/90 dark:bg-white dark:text-graphite-950 dark:hover:bg-white/90",
          variant === "secondary" &&
            "border border-line bg-paper-raised text-ink hover:bg-paper dark:border-line-dark dark:bg-graphite-800 dark:text-white dark:hover:bg-graphite-700",
          variant === "ghost" && "text-ink-muted hover:text-ink dark:text-white/70 dark:hover:text-white",
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
