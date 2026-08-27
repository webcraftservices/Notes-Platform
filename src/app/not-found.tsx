import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <FileQuestion className="mb-4 h-8 w-8 text-ink-faint" strokeWidth={1.5} />
      <h1 className="font-display text-xl font-semibold text-ink dark:text-white">
        We couldn&apos;t find that
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted dark:text-white/50">
        It may have been deleted, or you might not have access to it.
      </p>
      <Link
        href="/home"
        className="mt-6 rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper dark:bg-white dark:text-graphite-950"
      >
        Back to Home
      </Link>
    </div>
  );
}
