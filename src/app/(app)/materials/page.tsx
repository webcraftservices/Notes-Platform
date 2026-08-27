import { FolderOpen } from "lucide-react";
import { requireUser, getPrimaryWorkspace } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { MaterialCard } from "@/components/materials/material-card";
import { UploadMaterialDialog } from "@/components/materials/upload-material-dialog";
import { MaterialsScopeTabs } from "@/components/materials/materials-scope-tabs";
import { MaterialsSearchBox } from "@/components/materials/materials-search-box";
import { getStorageUsage } from "@/lib/storage-usage";
import { formatBytes } from "@/lib/material-style";
import type { Prisma } from "@prisma/client";

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: { scope?: string; q?: string };
}) {
  const user = await requireUser();
  const workspace = await getPrimaryWorkspace(user.id);
  const scope = searchParams.scope === "unorganized" || searchParams.scope === "archived" ? searchParams.scope : "all";
  const q = searchParams.q?.trim() ?? "";

  const where: Prisma.MaterialWhereInput = {
    workspaceId: workspace.id,
    deletedAt: null,
    archivedAt: scope === "archived" ? { not: null } : null,
  };
  if (scope === "unorganized") {
    where.subjectId = null;
    where.chapterId = null;
    where.topicId = null;
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { originalFilename: { contains: q, mode: "insensitive" } },
      { tags: { has: q.toLowerCase() } },
    ];
  }

  const [materials, usage] = await Promise.all([
    db.material.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    getStorageUsage(user.id),
  ]);

  return (
    <>
      <Topbar actions={<UploadMaterialDialog scope={{}} />}>
        <Breadcrumbs trail={[{ label: "Materials" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Materials</h1>
              <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
                {formatBytes(usage.usedBytes)} of {formatBytes(usage.limitBytes)} used ({usage.percentUsed}%)
              </p>
            </div>
            <MaterialsSearchBox initialQuery={q} scope={scope} />
          </div>

          <MaterialsScopeTabs scope={scope} q={q} />

          {materials.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={q ? "No matches" : scope === "archived" ? "Nothing archived" : "No materials yet"}
              description={
                q
                  ? `Nothing matched "${q}".`
                  : "Upload PDFs, slides, images, audio, or video — or save a link for reference."
              }
              action={!q && scope === "all" ? <UploadMaterialDialog scope={{}} /> : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {materials.map((material) => (
                <MaterialCard key={material.id} material={material} />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
