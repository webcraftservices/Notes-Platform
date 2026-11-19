import { Search as SearchIcon } from "lucide-react";
import { requireUser } from "@/lib/access";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBox } from "@/components/search/search-box";
import { SearchFacets } from "@/components/search/search-facets";
import { SearchResultsList } from "@/components/search/search-results-list";
import { resolveUserSearchScope } from "@/lib/search/search-access";
import {
  executeLexicalSearch,
  type RawLexicalHit,
  type SearchableEntityType,
} from "@/lib/search/lexical-search";
import { executeVectorSearch, type RawVectorHit } from "@/lib/search/vector-search";
import { fuseRankings, type SearchHit } from "@/lib/search/rrf-ranking";
import {
  VALID_SEARCH_ENTITY_TYPES,
  VALID_SEARCH_MODES,
  type SearchMode,
} from "@/lib/validation/search";

interface SearchPageProps {
  searchParams: {
    q?: string;
    mode?: string;
    types?: string;
    groupId?: string;
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const user = await requireUser();
  const q = searchParams.q?.trim() ?? "";

  const mode: SearchMode =
    searchParams.mode && (VALID_SEARCH_MODES as readonly string[]).includes(searchParams.mode)
      ? (searchParams.mode as SearchMode)
      : "hybrid";

  const requestedTypes: SearchableEntityType[] | undefined = searchParams.types
    ? searchParams.types
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t): t is SearchableEntityType =>
          (VALID_SEARCH_ENTITY_TYPES as readonly string[]).includes(t)
        )
    : undefined;

  const activeTypes =
    requestedTypes && requestedTypes.length > 0 ? requestedTypes : undefined;

  let hits: SearchHit[] = [];

  if (q.length >= 2) {
    const scope = await resolveUserSearchScope(user.id);
    const shouldRunLexical = mode === "hybrid" || mode === "lexical";
    const shouldRunSemantic = mode === "hybrid" || mode === "semantic";
    const vectorTypes = (activeTypes ?? ["material", "note"]).filter(
      (t): t is "material" | "note" => t === "material" || t === "note"
    );

    const [lexicalHits, vectorHits] = await Promise.all([
      shouldRunLexical
        ? executeLexicalSearch({
            query: q,
            scope,
            limit: 40,
            types: activeTypes,
            groupId: searchParams.groupId,
            subjectId: searchParams.subjectId,
            chapterId: searchParams.chapterId,
            topicId: searchParams.topicId,
          })
        : Promise.resolve<RawLexicalHit[]>([]),
      shouldRunSemantic && vectorTypes.length > 0
        ? executeVectorSearch({
            query: q,
            scope,
            limit: 40,
            types: vectorTypes,
            groupId: searchParams.groupId,
            subjectId: searchParams.subjectId,
            chapterId: searchParams.chapterId,
            topicId: searchParams.topicId,
          })
        : Promise.resolve<RawVectorHit[]>([]),
    ]);

    hits = fuseRankings({
      lexicalHits,
      vectorHits,
      query: q,
      limit: 40,
      offset: 0,
    });
  }

  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Search" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <SearchBox initialQuery={q} />
          <SearchFacets activeTypes={activeTypes} activeMode={mode} />

          <p className="mb-4 mt-4 text-xs text-ink-faint dark:text-white/30">
            Unified hybrid search across subjects, chapters, topics, materials, notes, flashcards,
            and study groups. Press Ctrl+K (or ⌘K) anytime to open the global command palette.
          </p>

          {q.length >= 2 && hits.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No results"
              description={`Nothing matched "${q}".`}
            />
          ) : (
            <SearchResultsList hits={hits} query={q} />
          )}
        </div>
      </main>
    </>
  );
}
