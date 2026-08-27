"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function handleChange(next: string) {
    setValue(next);
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next.trim());
    router.replace(`/search${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search subjects, chapters, topics…"
        className="pl-10 text-base"
        autoFocus
      />
    </div>
  );
}
