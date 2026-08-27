import Link from "next/link";
import type { Material } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { getMaterialLabel, formatBytes, formatDuration } from "@/lib/material-style";
import { TagEditor } from "@/components/materials/tag-editor";

interface Scope {
  subject: { id: string; name: string } | null;
  chapter: { id: string; name: string } | null;
  topic: { id: string; name: string } | null;
}

export function MaterialInfoPanel({ material, scope }: { material: Material; scope: Scope }) {
  const metadata = (material.metadata as Record<string, unknown> | null) ?? {};

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/30">
          Details
        </h3>
        <dl className="space-y-2.5 text-sm">
          <Row label="Type" value={getMaterialLabel(material.type)} />
          {material.sizeBytes ? <Row label="Size" value={formatBytes(material.sizeBytes)} /> : null}
          {material.durationSeconds ? (
            <Row label="Duration" value={formatDuration(material.durationSeconds)} />
          ) : null}
          {typeof metadata.pageCount === "number" ? (
            <Row label="Pages" value={String(metadata.pageCount)} />
          ) : null}
          {typeof metadata.width === "number" && typeof metadata.height === "number" ? (
            <Row label="Dimensions" value={`${metadata.width} × ${metadata.height}`} />
          ) : null}
          <Row label="Uploaded" value={formatDistanceToNow(new Date(material.createdAt), { addSuffix: true })} />
        </dl>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/30">
          Location
        </h3>
        {scope.topic ? (
          <p className="text-sm text-ink dark:text-white">
            <Link href={`/subjects/${scope.subject?.id}`} className="hover:underline">
              {scope.subject?.name}
            </Link>{" "}
            /{" "}
            <Link href={`/subjects/${scope.subject?.id}/chapters/${scope.chapter?.id}`} className="hover:underline">
              {scope.chapter?.name}
            </Link>{" "}
            /{" "}
            <Link
              href={`/subjects/${scope.subject?.id}/chapters/${scope.chapter?.id}/topics/${scope.topic.id}`}
              className="hover:underline"
            >
              {scope.topic.name}
            </Link>
          </p>
        ) : scope.chapter ? (
          <p className="text-sm text-ink dark:text-white">
            <Link href={`/subjects/${scope.subject?.id}`} className="hover:underline">
              {scope.subject?.name}
            </Link>{" "}
            / {scope.chapter.name}
          </p>
        ) : scope.subject ? (
          <Link href={`/subjects/${scope.subject.id}`} className="text-sm text-ink hover:underline dark:text-white">
            {scope.subject.name}
          </Link>
        ) : (
          <p className="text-sm text-ink-faint dark:text-white/30">Unorganized</p>
        )}
      </div>

      <div className="card p-4">
        <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/30">
          Tags
        </h3>
        <TagEditor materialId={material.id} tags={material.tags} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-muted dark:text-white/50">{label}</dt>
      <dd className="font-medium text-ink dark:text-white">{value}</dd>
    </div>
  );
}
