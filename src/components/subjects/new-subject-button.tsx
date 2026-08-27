"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/lib/stores/ui-store";

export function NewSubjectButton() {
  const setOpen = useUIStore((s) => s.setCreateSubjectOpen);
  return (
    <Button onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" />
      New Subject
    </Button>
  );
}
