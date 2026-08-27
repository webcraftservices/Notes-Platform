import { NewSubjectButton } from "@/components/subjects/new-subject-button";
import { UploadMaterialDialog } from "@/components/materials/upload-material-dialog";
import { Sparkles, Users } from "lucide-react";

const FUTURE_ACTIONS = [
  { label: "Ask AI", icon: Sparkles, phase: "Phase 5" },
  { label: "New Group", icon: Users, phase: "Phase 6" },
];

/**
 * "New Subject", "Upload Material", and "Record Lecture" are real,
 * clickable actions. The rest are shown disabled with their arrival phase
 * labeled — spec §92 forbids fake "coming soon" buttons that pretend to
 * work, but naming a genuinely scheduled later phase is different from
 * that, and keeps the dashboard layout honest about where things are headed.
 */
export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <NewSubjectButton />
      <UploadMaterialDialog scope={{}} label="Upload Material" />
      <UploadMaterialDialog scope={{}} label="Record Lecture" defaultTab="record" />
      {FUTURE_ACTIONS.map((action) => (
        <button
          key={action.label}
          disabled
          title={`Arrives in ${action.phase}`}
          className="flex cursor-not-allowed items-center gap-2 rounded-sm border border-line px-4 py-2.5 text-sm font-medium text-ink-faint opacity-60 dark:border-line-dark dark:text-white/30"
        >
          <action.icon className="h-4 w-4" />
          {action.label}
          <span className="font-mono text-[10px] uppercase tracking-wide">{action.phase}</span>
        </button>
      ))}
    </div>
  );
}
