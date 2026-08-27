import { CardGridSkeleton } from "@/components/ui/skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <CardGridSkeleton count={4} />
      </div>
    </div>
  );
}
