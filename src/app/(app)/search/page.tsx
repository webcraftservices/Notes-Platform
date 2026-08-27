import { Search as SearchIcon } from "lucide-react";
import { requireUser, getPrimaryWorkspace } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBox } from "@/components/search/search-box";
import { SearchResultsList } from "@/components/search/search-results-list";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const workspace = await getPrimaryWorkspace(user.id);
  const q = searchParams.q?.trim() ?? "";

  const results =
    q.length >= 2
      ? await Promise.all([
          db.subject.findMany({
            where: {
              workspaceId: workspace.id,
              deletedAt: null,
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
            take: 15,
          }),
          db.chapter.findMany({
            where: {
              deletedAt: null,
              subject: { workspaceId: workspace.id, deletedAt: null },
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
            include: { subject: true },
            take: 15,
          }),
          db.topic.findMany({
            where: {
              deletedAt: null,
              chapter: { subject: { workspaceId: workspace.id, deletedAt: null } },
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
            include: { chapter: { include: { subject: true } } },
            take: 15,
          }),
        ])
      : [[], [], []];

  const [subjects, chapters, topics] = results;
  const totalResults = subjects.length + chapters.length + topics.length;

  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Search" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <SearchBox initialQuery={q} />

          <p className="mb-4 mt-6 text-xs text-ink-faint dark:text-white/30">
            Searches subject, chapter, and topic names — semantic search over notes, transcripts, and
            materials arrives in Phase 5.
          </p>

          {q.length >= 2 && totalResults === 0 ? (
            <EmptyState icon={SearchIcon} title="No results" description={`Nothing matched "${q}".`} />
          ) : (
            <SearchResultsList subjects={subjects} chapters={chapters} topics={topics} />
          )}
        </div>
      </main>
    </>
  );
}
