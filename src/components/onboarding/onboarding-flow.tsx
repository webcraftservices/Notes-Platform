"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  Users,
  Microscope,
  StickyNote,
  Briefcase,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const INTENTS = [
  { value: "STUDY", label: "Study", icon: GraduationCap },
  { value: "MEETINGS", label: "Meetings", icon: Users },
  { value: "RESEARCH", label: "Research", icon: Microscope },
  { value: "PERSONAL", label: "Personal knowledge", icon: StickyNote },
  { value: "WORK", label: "Work", icon: Briefcase },
] as const;

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [intent, setIntent] = useState<(typeof INTENTS)[number]["value"] | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function finish(skipSubject = false) {
    if (!intent) return;
    setSubmitting(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usageIntent: intent,
          firstSubjectName: skipSubject ? undefined : subjectName || undefined,
        }),
      });
      router.push("/home");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {step === 1 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">Step 1 of 2</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink dark:text-white">
            What are you using this for?
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted dark:text-white/50">
            This shapes how notes get organized — you can change it later.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-2.5">
            {INTENTS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setIntent(opt.value)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                  intent === opt.value
                    ? "border-accent bg-accent-soft"
                    : "border-line hover:border-ink-faint dark:border-line-dark"
                )}
              >
                <opt.icon
                  className={cn("h-5 w-5", intent === opt.value ? "text-accent-strong" : "text-ink-faint")}
                  strokeWidth={1.75}
                />
                <span className={cn("text-sm font-medium", intent === opt.value ? "text-accent-strong" : "text-ink dark:text-white")}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>

          <Button className="mt-8 w-full" disabled={!intent} onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">Step 2 of 2</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink dark:text-white">
            Create your first subject
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted dark:text-white/50">
            Optional — you can always add one later.
          </p>

          <div className="mt-8">
            <Label htmlFor="onboarding-subject">Subject name</Label>
            <Input
              id="onboarding-subject"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="e.g. Physics"
              autoFocus
            />
          </div>

          <div className="mt-8 flex gap-2">
            <Button variant="secondary" onClick={() => finish(true)} disabled={submitting}>
              Skip
            </Button>
            <Button className="flex-1" onClick={() => finish(false)} loading={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Finish"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
