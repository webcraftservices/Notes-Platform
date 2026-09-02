import Link from "next/link";
import { Sparkles } from "lucide-react";
import { NewSubjectButton } from "@/components/subjects/new-subject-button";
import { UploadMaterialDialog } from "@/components/materials/upload-material-dialog";
import { NewGroupButton } from "@/components/groups/new-group-button";

/**
 * "New Subject", "Upload Material", "Record Lecture", "Ask AI", and "New
 * Group" are all real, clickable actions. "Ask AI" links to the already-
 * implemented `/assistant` route (Phase 5) — it doesn't claim an AI
 * provider is configured; `AIChatPanel` itself shows the honest
 * "not configured" state if no provider is set up, same as everywhere
 * else in the app. "New Group" reuses the existing `NewGroupButton` /
 * `CreateGroupDialog` pair (Phase 6.1/6.3) rather than a second
 * implementation — `CreateGroupDialog` is mounted once, alongside
 * `CreateSubjectDialog`, at the bottom of the Home page itself.
 *
 * Previously both were hardcoded into a `FUTURE_ACTIONS` disabled list
 * dating back to the Phase 2 dashboard, before AI (Phase 5) or Groups
 * (Phase 6) existed — never updated once those phases shipped. Spec §92
 * ("no fake features") cuts both ways: a real, implemented surface
 * should not sit behind a stale "arrives later" gate any more than an
 * unimplemented one should pretend to work.
 */
export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <NewSubjectButton />
      <UploadMaterialDialog scope={{}} label="Upload Material" />
      <UploadMaterialDialog scope={{}} label="Record Lecture" defaultTab="record" />
      <Link
        href="/assistant"
        className="flex items-center gap-2 rounded-sm border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-raised dark:border-line-dark dark:text-white dark:hover:bg-graphite-800"
      >
        <Sparkles className="h-4 w-4" />
        Ask AI
      </Link>
      <NewGroupButton />
    </div>
  );
}
