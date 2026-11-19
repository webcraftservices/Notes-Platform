"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { SearchableEntityType } from "@/lib/search/lexical-search";
import type { SearchMode } from "@/lib/validation/search";

const ENTITY_FACETS: { value: SearchableEntityType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "note", label: "Notes" },
  { value: "material", label: "Materials" },
  { value: "subject", label: "Subjects" },
  { value: "chapter", label: "Chapters" },
  { value: "topic", label: "Topics" },
  { value: "group", label: "Groups" },
  { value: "flashcard", label: "Flashcards" },
];

const MODE_OPTIONS: { value: SearchMode; label: string }[] = [
  { value: "hybrid", label: "Hybrid (AI + Text)" },
  { value: "lexical", label: "Keyword Only" },
  { value: "semantic", label: "Semantic (AI)" },
];

export interface SearchFacetsProps {
  activeTypes?: SearchableEntityType[];
  activeMode?: SearchMode;
}

export function SearchFacets({ activeTypes, activeMode = "hybrid" }: SearchFacetsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedType: SearchableEntityType | "all" =
    activeTypes && activeTypes.length === 1 ? activeTypes[0]! : "all";

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(updates)) {
      if (!v) {
        params.delete(k);
      } else {
        params.set(k, v);
      }
    }
    const qs = params.toString();
    router.replace(`/search${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by entity type">
        {ENTITY_FACETS.map((facet) => {
          const isActive = selectedType === facet.value;
          return (
            <button
              key={facet.value}
              type="button"
              onClick={() =>
                updateParams({
                  types: facet.value === "all" ? null : facet.value,
                })
              }
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-accent text-white"
                  : "bg-paper-raised text-ink-muted hover:bg-paper-subtle dark:bg-graphite-800 dark:text-white/70"
              }`}
            >
              {facet.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
          Mode:
        </span>
        <select
          aria-label="Search mode"
          value={activeMode}
          onChange={(e) =>
            updateParams({
              mode: e.target.value === "hybrid" ? null : e.target.value,
            })
          }
          className="rounded-sm border border-line bg-paper-raised px-2 py-1 text-xs text-ink outline-none dark:border-line-dark dark:bg-graphite-800 dark:text-white"
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
