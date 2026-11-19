import React from "react";
import Link from "next/link";
import {
  BookOpen,
  CreditCard,
  FileText,
  FolderOpen,
  Layers,
  Library,
  ListTree,
  Users,
} from "lucide-react";
import type { SearchHit } from "@/lib/search/rrf-ranking";
import type { SearchableEntityType } from "@/lib/search/lexical-search";
import { HighlightedSnippet } from "./highlighted-snippet";

interface SubjectResult {
  id: string;
  name: string;
  description: string | null;
}
interface ChapterResult {
  id: string;
  name: string;
  description: string | null;
  subject: { id: string; name: string };
}
interface TopicResult {
  id: string;
  name: string;
  description: string | null;
  chapter: { id: string; name: string; subject: { id: string; name: string } };
}

export interface SearchResultsListProps {
  hits?: SearchHit[];
  query?: string;
  subjects?: SubjectResult[];
  chapters?: ChapterResult[];
  topics?: TopicResult[];
}

const DISPLAY_ORDER: SearchableEntityType[] = [
  "note",
  "material",
  "subject",
  "chapter",
  "topic",
  "group",
  "flashcard",
];

const GROUP_LABELS: Record<SearchableEntityType, string> = {
  subject: "Subjects",
  chapter: "Chapters",
  topic: "Topics",
  note: "Notes",
  material: "Materials",
  group: "Study Groups",
  flashcard: "Flashcard Decks",
};

function iconForEntity(
  entityType: SearchableEntityType
): React.ComponentType<{ className?: string }> {
  switch (entityType) {
    case "subject":
      return BookOpen;
    case "chapter":
      return Library;
    case "topic":
      return ListTree;
    case "material":
      return FolderOpen;
    case "note":
      return FileText;
    case "group":
      return Users;
    case "flashcard":
      return CreditCard;
    default:
      return Layers;
  }
}

function badgeLabel(matchType: SearchHit["matchType"]): string {
  switch (matchType) {
    case "hybrid":
      return "AI+Text";
    case "semantic":
      return "AI";
    case "lexical":
      return "Text";
  }
}

function formatHierarchyBreadcrumb(hierarchy: SearchHit["hierarchy"]): string {
  const parts: string[] = [];
  if (hierarchy.groupName) parts.push(hierarchy.groupName);
  if (hierarchy.subjectName) parts.push(hierarchy.subjectName);
  if (hierarchy.chapterName) parts.push(hierarchy.chapterName);
  if (hierarchy.topicName) parts.push(hierarchy.topicName);
  return parts.join(" › ");
}

export function SearchResultsList({
  hits,
  query = "",
  subjects = [],
  chapters = [],
  topics = [],
}: SearchResultsListProps) {
  if (hits) {
    if (hits.length === 0) return null;

    const grouped = hits.reduce<Partial<Record<SearchableEntityType, SearchHit[]>>>(
      (acc, hit) => {
        if (!acc[hit.entityType]) acc[hit.entityType] = [];
        acc[hit.entityType]!.push(hit);
        return acc;
      },
      {}
    );

    return (
      <div className="space-y-6">
        {DISPLAY_ORDER.map((entityType) => {
          const group = grouped[entityType];
          if (!group || group.length === 0) return null;
          const Icon = iconForEntity(entityType);

          return (
            <ResultGroup key={entityType} label={GROUP_LABELS[entityType]}>
              {group.map((hit) => {
                const breadcrumb = formatHierarchyBreadcrumb(hit.hierarchy);
                const badge = badgeLabel(hit.matchType);
                const deepLinkLabel =
                  hit.navigation.pageNumber != null
                    ? `Page ${hit.navigation.pageNumber}`
                    : hit.navigation.timestampSeconds != null
                    ? `${Math.floor(hit.navigation.timestampSeconds / 60)}:${String(
                        Math.floor(hit.navigation.timestampSeconds % 60)
                      ).padStart(2, "0")}`
                    : undefined;

                return (
                  <Link
                    key={`${hit.entityType}:${hit.id}`}
                    href={hit.navigation.href}
                    className="card flex items-start gap-3 px-3.5 py-2.5 transition-shadow hover:shadow-panel"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink dark:text-white">
                          {hit.title}
                        </p>
                        <span className="shrink-0 rounded-sm bg-paper-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-faint dark:bg-graphite-800 dark:text-white/50">
                          {badge}
                        </span>
                        {deepLinkLabel && (
                          <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent dark:bg-accent/20">
                            {deepLinkLabel}
                          </span>
                        )}
                      </div>
                      {breadcrumb && (
                        <p className="truncate text-xs text-ink-faint dark:text-white/40">
                          {breadcrumb}
                        </p>
                      )}
                      {hit.snippet && (
                        <HighlightedSnippet
                          snippet={hit.snippet}
                          query={query}
                          className="mt-1 line-clamp-2 text-xs text-ink-muted dark:text-white/60"
                        />
                      )}
                    </div>
                  </Link>
                );
              })}
            </ResultGroup>
          );
        })}
      </div>
    );
  }

  if (subjects.length === 0 && chapters.length === 0 && topics.length === 0) return null;

  return (
    <div className="space-y-6">
      {subjects.length > 0 && (
        <ResultGroup label="Subjects">
          {subjects.map((s) => (
            <ResultRow key={s.id} icon={BookOpen} href={`/subjects/${s.id}`} title={s.name} />
          ))}
        </ResultGroup>
      )}
      {chapters.length > 0 && (
        <ResultGroup label="Chapters">
          {chapters.map((c) => (
            <ResultRow
              key={c.id}
              icon={Library}
              href={`/subjects/${c.subject.id}/chapters/${c.id}`}
              title={c.name}
              subtitle={c.subject.name}
            />
          ))}
        </ResultGroup>
      )}
      {topics.length > 0 && (
        <ResultGroup label="Topics">
          {topics.map((t) => (
            <ResultRow
              key={t.id}
              icon={ListTree}
              href={`/subjects/${t.chapter.subject.id}/chapters/${t.chapter.id}/topics/${t.id}`}
              title={t.name}
              subtitle={`${t.chapter.subject.name} · ${t.chapter.name}`}
            />
          ))}
        </ResultGroup>
      )}
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/30">
        {label}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ResultRow({
  icon: Icon,
  href,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 px-3.5 py-2.5 transition-shadow hover:shadow-panel">
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink dark:text-white">{title}</p>
        {subtitle && <p className="truncate text-xs text-ink-faint dark:text-white/30">{subtitle}</p>}
      </div>
    </Link>
  );
}
