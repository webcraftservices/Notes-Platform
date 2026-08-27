import Link from "next/link";
import { BookOpen, Library, ListTree } from "lucide-react";

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

export function SearchResultsList({
  subjects,
  chapters,
  topics,
}: {
  subjects: SubjectResult[];
  chapters: ChapterResult[];
  topics: TopicResult[];
}) {
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
