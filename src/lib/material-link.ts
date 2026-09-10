/**
 * Builds the destination URL for an AI chat source citation (Phase 5 —
 * source click-through navigation), reusing the existing material detail
 * route (`/materials/[materialId]`, see that page) rather than inventing
 * a new one. At most one of `page`/`timestampSeconds` is ever meaningful
 * for a given citation (see AIMessageSource / chunksToSources in
 * ai-chat.ts — a chunk is either page-based or timestamp-based, never
 * both), but this function tolerates both being present by preferring
 * `page`, and tolerates neither being present by linking to the bare
 * material page — see requirement #5 (material-only source still
 * navigates normally).
 *
 * Pure and framework-agnostic on purpose: used both to build the `href`
 * for AIChatPanel's citation links and directly unit-tested without
 * needing to render anything.
 */
export function materialSourceHref(source: {
  materialId: string;
  label?: string;
  page?: number;
  timestampSeconds?: number;
}): string {
  const base = `/materials/${encodeURIComponent(source.materialId)}`;

  if (source.page != null && Number.isFinite(source.page) && source.page > 0) {
    return `${base}?page=${Math.floor(source.page)}`;
  }

  if (source.timestampSeconds != null && Number.isFinite(source.timestampSeconds) && source.timestampSeconds >= 0) {
    return `${base}?t=${Math.floor(source.timestampSeconds)}`;
  }

  return base;
}

/**
 * Accessible name for a source citation link, used as AIChatPanel's
 * `aria-label` — the visible label text alone (e.g. "Thermodynamics.pdf —
 * Page 8") reads fine visually next to other citations, but a screen
 * reader announcing a list of bare links with no "open"/"navigate" verb is
 * exactly the kind of ambiguous interactive-element case spec §7 calls
 * out. Kept as its own pure function (like materialSourceHref above) so
 * it's directly unit-testable without rendering anything.
 */
export function materialSourceAriaLabel(source: { label: string }): string {
  return `Open source: ${source.label}`;
}
