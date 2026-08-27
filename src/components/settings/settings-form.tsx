"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Sun, Moon, Monitor } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "LIGHT", label: "Light", icon: Sun },
  { value: "DARK", label: "Dark", icon: Moon },
  { value: "SYSTEM", label: "System", icon: Monitor },
] as const;

export function SettingsForm({
  name,
  email,
  theme,
}: {
  name: string;
  email: string;
  theme: "LIGHT" | "DARK" | "SYSTEM";
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [draftName, setDraftName] = useState(name);
  const [selectedTheme, setSelectedTheme] = useState(theme);
  const [saving, setSaving] = useState(false);

  async function handleThemeChange(next: typeof theme) {
    setSelectedTheme(next);
    setTheme(next.toLowerCase());
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!draftName.trim() || draftName === name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName }),
      });
      if (!res.ok) {
        toast.error("Couldn't save your name.");
        return;
      }
      toast.success("Profile updated");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-sm font-semibold text-ink dark:text-white">Profile</h2>

      <form onSubmit={handleSaveName} className="mt-4 space-y-4">
        <div>
          <Label htmlFor="settings-name">Name</Label>
          <div className="flex gap-2">
            <Input id="settings-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <Button type="submit" variant="secondary" loading={saving} disabled={draftName === name || !draftName.trim()}>
              Save
            </Button>
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <p className="text-sm text-ink-muted dark:text-white/50">{email}</p>
        </div>
      </form>

      <div className="mt-6">
        <Label>Theme</Label>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleThemeChange(opt.value)}
              className={cn(
                "flex flex-1 flex-col items-center gap-1.5 rounded-sm border py-3 text-xs font-medium transition-colors",
                selectedTheme === opt.value
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-line text-ink-muted hover:border-ink-faint dark:border-line-dark dark:text-white/50"
              )}
            >
              <opt.icon className="h-4 w-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
