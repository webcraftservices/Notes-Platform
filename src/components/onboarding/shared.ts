import { useCallback, useSyncExternalStore } from "react";

/** Tiny class joiner so the components don't depend on the host's `cn`. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Event-based media query (no resize listener, no polling).
 * Server snapshot is `false`, so the mobile layout is the default and
 * hydration never mismatches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Controlled Zenote accents: violet, magenta, pink, subtle orange, subtle gold. */
export const ZENOTE_ACCENT = {
  violet: "#7C6CF0",
  magenta: "#BE4BDB",
  pink: "#E85D9E",
  orange: "#EE8F5C",
  gold: "#D9B365",
} as const;

export const ZENOTE_GRADIENT_CSS = `linear-gradient(90deg, ${ZENOTE_ACCENT.violet}, ${ZENOTE_ACCENT.magenta}, ${ZENOTE_ACCENT.pink}, ${ZENOTE_ACCENT.gold})`;
