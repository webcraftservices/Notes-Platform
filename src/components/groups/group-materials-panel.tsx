import { FileText } from "lucide-react";
import type { Material } from "@prisma/client";
import { EmptyState } from "@/components/ui/empty-state";
import { MaterialCard } from "@/components/materials/material-card";

/**
 * Phase 6.4, read-only. Materials only become group-owned by being
 * attached under a Group Subject/Chapter/Topic (via
 * lib/materials-scope.ts) — there's no "Unorganized within a Group" home
 * yet, so unlike /materials there's no upload affordance here; uploading
 * happens from inside a group Subject's own Chapter/Topic pages, which
 * already reuse the existing MaterialsPanel/UploadMaterialDialog and now
 * correctly resolve group ownership. Materials are fetched server-side in
 * app/(app)/groups/[groupId]/page.tsx and passed down as props, same as
 * GroupSubjectsPanel.
 */
export function GroupMaterialsPanel({ materials }: { materials: Material[] }) {
  if (materials.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No materials yet"
        description="Materials attached to this group's subjects, chapters, and topics will show up here once someone uploads one."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {materials.map((material) => (
        <MaterialCard key={material.id} material={material} />
      ))}
    </div>
  );
}
