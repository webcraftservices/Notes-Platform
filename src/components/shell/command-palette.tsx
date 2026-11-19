"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Home,
  BookOpen,
  Search as SearchIcon,
  Settings,
  Plus,
  LogOut,
  Loader2,
  FolderOpen,
  Mic,
  Users,
  FileText,
  Library,
  ListTree,
  Layers,
  CreditCard,
} from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";
import type { SearchableEntityType } from "@/lib/search/lexical-search";
import { HighlightedSnippet } from "@/components/search/highlighted-snippet";

/** Phase 12: Unified search result shape from /api/search */
export interface UnifiedSearchHit {
  id: string;
  entityType: SearchableEntityType;
  title: string;
  snippet?: string;
  matchType: "hybrid" | "lexical" | "semantic";
  score: number;
  hierarchy: {
    subjectId?: string;
    subjectName?: string;
    chapterId?: string;
    chapterName?: string;
    topicId?: string;
    topicName?: string;
    groupId?: string;
    groupName?: string;
  };
  navigation: {
    href: string;
    pageNumber?: number;
    timestampSeconds?: number;
  };
}

/** Returns the Lucide icon component appropriate for each entity type. */
export function entityTypeIcon(
  entityType: SearchableEntityType
): React.ComponentType<{ className?: string }> {
  switch (entityType) {
    case "subject": return BookOpen;
    case "chapter": return Library;
    case "topic": return ListTree;
    case "material": return FolderOpen;
    case "note": return FileText;
    case "group": return Users;
    case "flashcard": return CreditCard;
    default: return Layers;
  }
}

/** Builds a human-readable breadcrumb string from a hit's hierarchy metadata. */
export function buildHierarchyBreadcrumb(
  hierarchy: UnifiedSearchHit["hierarchy"]
): string {
  const parts: string[] = [];
  if (hierarchy.groupName) parts.push(hierarchy.groupName);
  if (hierarchy.subjectName) parts.push(hierarchy.subjectName);
  if (hierarchy.chapterName) parts.push(hierarchy.chapterName);
  if (hierarchy.topicName) parts.push(hierarchy.topicName);
  return parts.join(" › ");
}

/** Returns the match-type badge label. */
export function matchTypeBadgeLabel(matchType: UnifiedSearchHit["matchType"]): string {
  switch (matchType) {
    case "hybrid": return "AI+Text";
    case "semantic": return "AI";
    case "lexical": return "Text";
  }
}

interface CommandPaletteContext {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const Ctx = createContext<CommandPaletteContext | null>(null);

export function useCommandPalette() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

/**
 * Minimum query character threshold before firing search requests.
 */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Checks whether a keyboard event is the command palette toggle shortcut (⌘K or Ctrl+K).
 */
export function isCommandPaletteShortcut(e: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  key: string;
}): boolean {
  return Boolean((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k");
}

/**
 * Determines whether a query string meets the minimum length requirements for search dispatch.
 */
export function shouldTriggerSearch(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_QUERY_LENGTH;
}

/**
 * Manages AbortController lifecycle for search requests: aborts previous controller
 * if active, and creates a fresh controller for the incoming request.
 */
export function createSearchAbortController(
  prevController: AbortController | null
): AbortController {
  if (prevController) {
    prevController.abort();
  }
  return new AbortController();
}

/**
 * Resolves destination URL for a selected command palette search hit or navigation item.
 */
export function resolveCommandNavigationHref(destination: {
  href?: string;
  entityType?: string;
  id?: string;
  navigation?: { href: string };
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}): string {
  if (destination.navigation?.href) {
    return destination.navigation.href;
  }
  if (destination.href) {
    return destination.href;
  }
  if (destination.entityType === "subject" && destination.id) {
    return `/subjects/${destination.id}`;
  }
  if (destination.entityType === "chapter" && destination.id && destination.subjectId) {
    return `/subjects/${destination.subjectId}/chapters/${destination.id}`;
  }
  if (destination.entityType === "topic" && destination.id && destination.subjectId && destination.chapterId) {
    return `/subjects/${destination.subjectId}/chapters/${destination.chapterId}/topics/${destination.id}`;
  }
  return "/home";
}

/** Phase 12: Paginated unified search response from /api/search */
interface UnifiedSearchResponse {
  hits: UnifiedSearchHit[];
  total: number;
  query: string;
  meta: {
    lexicalCount: number;
    vectorCount: number;
    limit: number;
    offset: number;
  };
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UnifiedSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const setCreateSubjectOpen = useUIStore((s) => s.setCreateSubjectOpen);
  const setCreateGroupOpen = useUIStore((s) => s.setCreateGroupOpen);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isCommandPaletteShortcut(e)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!shouldTriggerSearch(query)) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = createSearchAbortController(null);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=15`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data: UnifiedSearchResponse = await res.json();
          setHits(data.hits ?? []);
        }
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setHits([]);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
      setQuery("");
    },
    [router]
  );

  // Group hits by entity type for display
  const hitsByType = hits.reduce<Partial<Record<SearchableEntityType, UnifiedSearchHit[]>>>(
    (acc, hit) => {
      if (!acc[hit.entityType]) acc[hit.entityType] = [];
      acc[hit.entityType]!.push(hit);
      return acc;
    },
    {}
  );

  const DISPLAY_ORDER: SearchableEntityType[] = [
    "subject", "chapter", "topic", "note", "material", "group", "flashcard",
  ];

  const GROUP_LABELS: Record<SearchableEntityType, string> = {
    subject: "Subjects",
    chapter: "Chapters",
    topic: "Topics",
    note: "Notes",
    material: "Materials",
    group: "Groups",
    flashcard: "Flashcards",
  };

  return (
    <Ctx.Provider value={{ open, setOpen }}>
      {children}
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        shouldFilter={false}
        label="Command Menu"
        className="fixed left-1/2 top-[20%] z-[60] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-paper-raised shadow-panel dark:border-line-dark dark:bg-graphite-900"
      >
        <div className="flex items-center border-b border-line px-4 dark:border-line-dark">
          <SearchIcon className="h-4 w-4 text-ink-faint" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search notes, materials, subjects… or run a command"
            className="w-full bg-transparent px-3 py-3.5 text-sm text-ink outline-none placeholder:text-ink-faint dark:text-white"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />}
        </div>
        <Command.List className="max-h-[28rem] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-ink-faint">
            {query.length >= MIN_SEARCH_QUERY_LENGTH && !loading
              ? "No results found."
              : "Start typing to search…"}
          </Command.Empty>

          {/* Quick-action group: shown when no query is typed */}
          {!query && (
            <Command.Group
              heading="Actions"
              className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5"
            >
              <Item icon={Plus} onSelect={() => { go("/subjects"); setCreateSubjectOpen(true); }}>
                New Subject
              </Item>
              <Item icon={Users} onSelect={() => { go("/groups"); setCreateGroupOpen(true); }}>
                New Group
              </Item>
              <Item icon={Home} onSelect={() => go("/home")}>Go to Home</Item>
              <Item icon={BookOpen} onSelect={() => go("/subjects")}>Go to Subjects</Item>
              <Item icon={Users} onSelect={() => go("/groups")}>Go to Groups</Item>
              <Item icon={FolderOpen} onSelect={() => go("/materials")}>Go to Materials</Item>
              <Item icon={Mic} onSelect={() => go("/materials")}>Record Lecture</Item>
              <Item icon={Settings} onSelect={() => go("/settings")}>Go to Settings</Item>
              <Item icon={LogOut} destructive onSelect={() => signOut({ callbackUrl: "/sign-in" })}>
                Sign out
              </Item>
            </Command.Group>
          )}

          {/* Unified search results, grouped by entity type */}
          {hits.length > 0 &&
            DISPLAY_ORDER.map((entityType) => {
              const group = hitsByType[entityType];
              if (!group || group.length === 0) return null;
              const Icon = entityTypeIcon(entityType);
              return (
                <Command.Group
                  key={entityType}
                  heading={GROUP_LABELS[entityType]}
                  className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5"
                >
                  {group.map((hit) => {
                    const breadcrumb = buildHierarchyBreadcrumb(hit.hierarchy);
                    const badge = matchTypeBadgeLabel(hit.matchType);
                    return (
                      <Command.Item
                        key={`${hit.entityType}:${hit.id}`}
                        onSelect={() => go(hit.navigation.href)}
                        className="flex cursor-pointer items-start gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors data-[selected=true]:bg-paper dark:data-[selected=true]:bg-graphite-800"
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-ink dark:text-white">
                              {hit.title}
                            </span>
                            <span className="shrink-0 rounded-sm bg-paper px-1 py-px text-[10px] font-medium text-ink-faint dark:bg-graphite-700 dark:text-white/40">
                              {badge}
                            </span>
                          </div>
                          {breadcrumb && (
                            <p className="truncate text-xs text-ink-faint dark:text-white/30">
                              {breadcrumb}
                            </p>
                          )}
                          {hit.snippet && (
                            <HighlightedSnippet
                              snippet={hit.snippet}
                              query={query}
                              className="mt-0.5 line-clamp-1 text-xs text-ink-faint dark:text-white/30"
                            />
                          )}
                        </div>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              );
            })}
        </Command.List>
      </Command.Dialog>
    </Ctx.Provider>
  );
}

function Item({
  icon: Icon,
  children,
  onSelect,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-sm transition-colors data-[selected=true]:bg-paper dark:data-[selected=true]:bg-graphite-800 ${destructive ? "text-signal-danger" : "text-ink dark:text-white/90"
        }`}
    >
      <Icon className="h-4 w-4 text-ink-faint" />
      {children}
    </Command.Item>
  );
}
