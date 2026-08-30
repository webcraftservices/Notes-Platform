import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Mirrors the avatar markup `shell/user-menu.tsx` already has inline for
 * the current user — pulled out here since Phase 6.3 needs the same
 * "image if present, else first-letter-of-name-or-email" treatment in at
 * least two more places (a group's member-avatar stack, each row in the
 * members list), which is the repo's actual bar for factoring out a
 * shared component rather than over-componentizing speculatively.
 */
export function Avatar({
  name,
  email,
  image,
  size = 26,
  className,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (name ?? email ?? "?")[0]?.toUpperCase() ?? "?";

  if (image) {
    return (
      <Image
        src={image}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full", className)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-graphite-700 font-medium text-white",
        className
      )}
    >
      <span style={{ fontSize: Math.max(10, Math.round(size * 0.42)) }}>{initial}</span>
    </div>
  );
}
