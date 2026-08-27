import { CardGridSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 h-8 w-40 animate-pulse rounded-sm bg-line/60 dark:bg-line-dark/60" />
        <CardGridSkeleton count={6} />
      </div>
    </div>
  );
}
