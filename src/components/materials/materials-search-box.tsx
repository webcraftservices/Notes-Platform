"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function MaterialsSearchBox({ initialQuery, scope }: { initialQuery: string; scope: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function handleChange(next: string) {
    setValue(next);
    const params = new URLSearchParams();
    if (scope !== "all") params.set("scope", scope);
    if (next.trim()) params.set("q", next.trim());
    router.replace(`/materials${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="relative w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search materials…"
        className="pl-8 text-sm"
      />
    </div>
  );
}
