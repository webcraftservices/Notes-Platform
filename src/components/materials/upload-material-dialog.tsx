"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FolderUp } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { MaterialUploader } from "@/components/materials/material-uploader";
import { RecorderPanel } from "@/components/materials/recorder-panel";
import type { UploadScope } from "@/lib/hooks/use-material-upload";

export function UploadMaterialDialog({
  scope,
  label = "Upload",
  defaultTab = "upload",
}: {
  scope: UploadScope;
  label?: string;
  defaultTab?: "upload" | "record" | "link";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [submittingLink, setSubmittingLink] = useState(false);

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    setSubmittingLink(true);
    try {
      const res = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: linkTitle, url: linkUrl, ...scope }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't save that link.");
        return;
      }
      toast.success("Link saved");
      setLinkTitle("");
      setLinkUrl("");
      router.refresh();
    } finally {
      setSubmittingLink(false);
    }
  }

  function handleRecorded(materialId: string) {
    setOpen(false);
    toast.success("Recording saved");
    router.push(`/materials/${materialId}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderUp className="h-4 w-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Add material" className="max-w-lg">
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="upload">Upload file</TabsTrigger>
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="link">Add link</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <MaterialUploader scope={scope} onUploaded={() => router.refresh()} />
          </TabsContent>
          <TabsContent value="record">
            <RecorderPanel scope={scope} onRecorded={handleRecorded} />
          </TabsContent>
          <TabsContent value="link">
            <form onSubmit={handleAddLink} className="space-y-4">
              <div>
                <Label htmlFor="link-title">Title</Label>
                <Input
                  id="link-title"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="e.g. Course syllabus"
                  required
                />
              </div>
              <div>
                <Label htmlFor="link-url">URL</Label>
                <Input
                  id="link-url"
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  required
                />
              </div>
              <p className="text-xs text-ink-faint dark:text-white/30">
                This saves the link for reference. Fetching and indexing the page&apos;s content arrives
                with the RAG pipeline in Phase 5.
              </p>
              <Button type="submit" className="w-full" loading={submittingLink} disabled={!linkTitle.trim() || !linkUrl.trim()}>
                <Plus className="h-4 w-4" />
                Save link
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
