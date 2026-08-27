import Link from "next/link";
import type { Material } from "@prisma/client";
import { getMaterialIcon, getMaterialLabel, formatBytes, formatDuration } from "@/lib/material-style";
import { MaterialActionsMenu } from "@/components/materials/material-actions-menu";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle } from "lucide-react";

export function MaterialCard({ material }: { material: Material }) {
  const Icon = getMaterialIcon(material.type);

  return (
    <div className="card group relative p-4 transition-shadow hover:shadow-panel">
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
        <MaterialActionsMenu material={material} />
      </div>
      <Link href={`/materials/${material.id}`} className="block">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-paper dark:bg-graphite-800">
          <Icon className="h-[18px] w-[18px] text-ink-muted dark:text-white/60" strokeWidth={1.75} />
        </div>
        <h3 className="mt-3 truncate pr-6 text-[14px] font-medium text-ink dark:text-white">
          {material.title}
        </h3>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-faint dark:text-white/30">
          <span>{getMaterialLabel(material.type)}</span>
          {material.sizeBytes ? <span>· {formatBytes(material.sizeBytes)}</span> : null}
          {material.durationSeconds ? <span>· {formatDuration(material.durationSeconds)}</span> : null}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          {material.status === "UPLOADING" && (
            <Badge variant="muted" className="!normal-case">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading
            </Badge>
          )}
          {material.status === "FAILED" && (
            <Badge className="!normal-case bg-signal-danger/10 text-signal-danger">
              <AlertCircle className="h-3 w-3" /> Failed
            </Badge>
          )}
          {material.archivedAt && <Badge variant="muted">Archived</Badge>}
        </div>
      </Link>
    </div>
  );
}
