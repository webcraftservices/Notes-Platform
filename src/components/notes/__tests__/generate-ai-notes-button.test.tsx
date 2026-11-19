import React from "react";
(globalThis as any).React = React;
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GenerateAINotesButton,
  submitNoteGeneration,
  setupNoteGenerationPolling,
} from "@/components/notes/generate-ai-notes-button";
import type { NoteEligibleMaterial } from "@/lib/note-eligible-material";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown-root">{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div data-testid="dropdown-trigger">{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({ children, disabled, onClick, className }: any) => (
    <div
      data-testid="dropdown-item"
      data-disabled={disabled ? "true" : undefined}
      aria-disabled={disabled ? "true" : undefined}
      className={className}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </div>
  ),
}));

describe("GenerateAINotesButton UI rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. a single ready audio material renders the existing single button", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "mat-1", title: "Lecture Recording", type: "AUDIO", isReady: true, isProcessing: false },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("Generate AI Notes");
    expect(html).not.toContain("lucide-chevron-down");
    expect(html).toContain("<button");
  });

  it("2. a single ready PDF renders the existing single button", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "doc-1", title: "Lecture Notes.pdf", type: "PDF", isReady: true, isProcessing: false },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("Generate AI Notes");
    expect(html).not.toContain("lucide-chevron-down");
  });

  it("3. multiple ready materials render a dropdown", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "doc-1", title: "Lecture Slides.pdf", type: "PDF", isReady: true, isProcessing: false },
      { id: "mat-2", title: "Class Audio", type: "AUDIO", isReady: true, isProcessing: false },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("Generate AI Notes");
    expect(html).toContain("lucide-chevron-down");
    expect(html).toContain("Lecture Slides.pdf");
    expect(html).toContain("Class Audio");
  });

  it("4. PDF, DOCX, PPTX and GOOGLE_DOC entries show appropriate labels", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "m-pdf", title: "Book.pdf", type: "PDF", isReady: true, isProcessing: false },
      { id: "m-docx", title: "Thesis.docx", type: "DOCX", isReady: true, isProcessing: false },
      { id: "m-pptx", title: "Presentation.pptx", type: "PPTX", isReady: true, isProcessing: false },
      { id: "m-gdoc", title: "Team Syllabus", type: "GOOGLE_DOC", isReady: true, isProcessing: false },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("PDF");
    expect(html).toContain("Word Document");
    expect(html).toContain("Presentation");
    expect(html).toContain("Google Doc");
  });

  it("5. processing documents appear disabled and show Extracting…", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "m-ready", title: "Ready Audio", type: "AUDIO", isReady: true, isProcessing: false },
      { id: "m-proc", title: "Heavy.pdf", type: "PDF", isReady: false, isProcessing: true },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("Extracting…");
    expect(html).toContain("Heavy.pdf");
    expect(html).toMatch(/data-disabled="true"|aria-disabled="true"/);
  });

  it("6. a ready material remains selectable alongside processing materials", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "m-ready", title: "Ready Document.docx", type: "DOCX", isReady: true, isProcessing: false },
      { id: "m-proc", title: "Incoming.pptx", type: "PPTX", isReady: false, isProcessing: true },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("Ready Document.docx");
    expect(html).toContain("Word Document");
    expect(html).toContain("Incoming.pptx");
    expect(html).toContain("Extracting…");
  });

  it("7. only-processing state does not expose an active generation action", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "m-proc-1", title: "First.pdf", type: "PDF", isReady: false, isProcessing: true },
    ];
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={materials} onComplete={() => {}} />
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Extracting material…");
    expect(html).not.toContain("Generate AI Notes");

    // Multiple processing documents
    const multiMaterials: NoteEligibleMaterial[] = [
      { id: "m-proc-1", title: "First.pdf", type: "PDF", isReady: false, isProcessing: true },
      { id: "m-proc-2", title: "Second.docx", type: "DOCX", isReady: false, isProcessing: true },
    ];
    const htmlMulti = renderToStaticMarkup(
      <GenerateAINotesButton materials={multiMaterials} onComplete={() => {}} />
    );
    expect(htmlMulti).toContain("Extracting materials…");
    expect(htmlMulti).not.toContain("Generate AI Notes");
  });

  it("returns null when materials list is empty", () => {
    const html = renderToStaticMarkup(
      <GenerateAINotesButton materials={[]} onComplete={() => {}} />
    );
    expect(html).toBe("");
  });
});

describe("submitNoteGeneration API interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("8. handles successful 202 response and triggers success toast", async () => {
    const mockJob = {
      id: "job-new",
      status: "QUEUED" as const,
      error: null,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({ job: mockJob }),
      })
    );

    const result = await submitNoteGeneration("mat-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.id).toBe("job-new");
    }
    expect(toast.success).toHaveBeenCalledWith("Generating AI notes… this can take a moment.");
  });

  it("9. handles existing active duplicate job 200 response correctly", async () => {
    const mockJob = {
      id: "job-existing",
      status: "RUNNING" as const,
      error: null,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ job: mockJob }),
      })
    );

    const result = await submitNoteGeneration("mat-2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.id).toBe("job-existing");
    }
    expect(toast.success).toHaveBeenCalledWith("Generating AI notes… this can take a moment.");
  });

  it("10. handles API error responses and produces appropriate toast feedback", async () => {
    // 409 DOCUMENT_EXTRACTION_PENDING
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Document text extraction is still in progress. Please wait a moment and try again.",
          code: "DOCUMENT_EXTRACTION_PENDING",
        }),
      })
    );

    const resPending = await submitNoteGeneration("doc-pending");
    expect(resPending.ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Document text extraction is still in progress. Please wait a moment and try again."
    );

    // 409 DOCUMENT_TEXT_EMPTY
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "This document has no extracted text or extraction failed. Please upload a readable document with selectable text.",
          code: "DOCUMENT_TEXT_EMPTY",
        }),
      })
    );

    const resEmpty = await submitNoteGeneration("doc-empty");
    expect(resEmpty.ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "This document has no extracted text or extraction failed. Please upload a readable document with selectable text."
    );

    // 413 DOCUMENT_TOO_LARGE
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({
          error: "This document is too large for single-pass note generation. Please split the document into smaller sections and try again.",
          code: "DOCUMENT_TOO_LARGE",
        }),
      })
    );

    const resLarge = await submitNoteGeneration("doc-large");
    expect(resLarge.ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "This document is too large for single-pass note generation. Please split the document into smaller sections and try again."
    );

    // 429 AI_QUOTA_EXCEEDED
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: "You've used all of your AI credits for this billing period. Upgrade your plan or wait for it to reset.",
          code: "AI_QUOTA_EXCEEDED",
        }),
      })
    );

    const resQuota = await submitNoteGeneration("doc-quota");
    expect(resQuota.ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "You've used all of your AI credits for this billing period. Upgrade your plan or wait for it to reset."
    );
  });
});

describe("setupNoteGenerationPolling lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("11. polls endpoint and triggers SUCCEEDED callback and toast exactly once", async () => {
    const onSucceeded = vi.fn();
    const onUpdate = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ job: { id: "job-1", status: "RUNNING", error: null } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ job: { id: "job-1", status: "SUCCEEDED", error: null } }),
        })
    );

    const cleanup = setupNoteGenerationPolling({
      jobId: "job-1",
      intervalMs: 1000,
      onSucceeded,
      onUpdate,
    });

    // Advance 1s -> RUNNING
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).toHaveBeenCalledWith({ id: "job-1", status: "RUNNING", error: null });
    expect(onSucceeded).not.toHaveBeenCalled();

    // Advance 1s -> SUCCEEDED
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("AI notes added to this topic's notes.");

    // Advance more -> should not poll again because timer was cleared
    await vi.advanceTimersByTimeAsync(5000);
    expect(onSucceeded).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("12. FAILED and CANCELLED terminate polling and trigger error toast", async () => {
    const onFailed = vi.fn();
    const onCancelled = vi.fn();

    // Test FAILED
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ job: { id: "job-fail", status: "FAILED", error: "Generation timed out" } }),
      })
    );

    const cleanupFail = setupNoteGenerationPolling({
      jobId: "job-fail",
      intervalMs: 1000,
      onFailed,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onFailed).toHaveBeenCalledWith("Generation timed out");
    expect(toast.error).toHaveBeenCalledWith("Generation timed out");
    cleanupFail();

    // Test CANCELLED
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ job: { id: "job-cancel", status: "CANCELLED", error: null } }),
      })
    );

    const cleanupCancel = setupNoteGenerationPolling({
      jobId: "job-cancel",
      intervalMs: 1000,
      onCancelled,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("AI note generation was cancelled.");
    cleanupCancel();
  });

  it("13. cleanup cancels polling on unmount", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job: { id: "job-clean", status: "RUNNING", error: null } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const cleanup = setupNoteGenerationPolling({
      jobId: "job-clean",
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Trigger cleanup
    cleanup();

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
