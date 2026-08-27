import { Users } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export default function GroupsPage() {
  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Groups" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <PhasePlaceholder
            icon={Users}
            title="Groups arrive in Phase 6"
            description="Create collaborative groups, invite members, share subjects and materials, and get group-scoped AI answers."
            phase="Phase 6 · Groups & collaboration"
          />
        </div>
      </main>
    </>
  );
}
