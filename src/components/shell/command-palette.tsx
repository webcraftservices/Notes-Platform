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
} from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";

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

interface SearchResults {
  subjects: { id: string; name: string }[];
  chapters: { id: string; name: string; subjectId: string }[];
  topics: { id: string; name: string; chapterId: string; chapter: { subjectId: string } }[];
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const setCreateSubjectOpen = useUIStore((s) => s.setCreateSubjectOpen);
  const setCreateGroupOpen = useUIStore((s) => s.setCreateGroupOpen);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) setResults(await res.json());
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
      setQuery("");
    },
    [router]
  );

  return (
    <Ctx.Provider value={{ open, setOpen }}>
      {children}
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command Menu"
        className="fixed left-1/2 top-[20%] z-[60] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-paper-raised shadow-panel dark:border-line-dark dark:bg-graphite-900"
      >
        <div className="flex items-center border-b border-line px-4 dark:border-line-dark">
          <SearchIcon className="h-4 w-4 text-ink-faint" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search subjects, chapters, topics… or run a command"
            className="w-full bg-transparent px-3 py-3.5 text-sm text-ink outline-none placeholder:text-ink-faint dark:text-white"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />}
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-ink-faint">
            No results found.
          </Command.Empty>

          {!query && (
            <Command.Group heading="Actions" className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5">
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

          {results && results.subjects.length > 0 && (
            <Command.Group heading="Subjects" className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5">
              {results.subjects.map((s) => (
                <Item key={s.id} icon={BookOpen} onSelect={() => go(`/subjects/${s.id}`)}>
                  {s.name}
                </Item>
              ))}
            </Command.Group>
          )}

          {results && results.chapters.length > 0 && (
            <Command.Group heading="Chapters" className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5">
              {results.chapters.map((c) => (
                <Item key={c.id} icon={BookOpen} onSelect={() => go(`/subjects/${c.subjectId}/chapters/${c.id}`)}>
                  {c.name}
                </Item>
              ))}
            </Command.Group>
          )}

          {results && results.topics.length > 0 && (
            <Command.Group heading="Topics" className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5">
              {results.topics.map((t) => (
                <Item
                  key={t.id}
                  icon={BookOpen}
                  onSelect={() =>
                    go(`/subjects/${t.chapter.subjectId}/chapters/${t.chapterId}/topics/${t.id}`)
                  }
                >
                  {t.name}
                </Item>
              ))}
            </Command.Group>
          )}
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
      className={`flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-sm transition-colors data-[selected=true]:bg-paper dark:data-[selected=true]:bg-graphite-800 ${
        destructive ? "text-signal-danger" : "text-ink dark:text-white/90"
      }`}
    >
      <Icon className="h-4 w-4 text-ink-faint" />
      {children}
    </Command.Item>
  );
}
