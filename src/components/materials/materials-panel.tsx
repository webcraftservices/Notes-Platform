import type { Material } from "@prisma/client";
import { FolderOpen } from "lucide-react";
import { MaterialCard } from "@/components/materials/material-card";
import { UploadMaterialDialog } from "@/components/materials/upload-material-dialog";
import { EmptyState } from "@/components/ui/empty-state";

interface Scope {
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

export function MaterialsPanel({
  materials,
  scope,
  emptyDescription,
}: {
  materials: Material[];
  scope: Scope;
  emptyDescription?: string;
}) {
  if (materials.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No materials yet"
        description={
          emptyDescription ??
          "Upload PDFs, slides, images, audio, or video — or save a link for reference."
        }
        action={<UploadMaterialDialog scope={scope} />}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <UploadMaterialDialog scope={scope} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {materials.map((material) => (
          <MaterialCard key={material.id} material={material} />
        ))}
      </div>
    </div>
  );
}
