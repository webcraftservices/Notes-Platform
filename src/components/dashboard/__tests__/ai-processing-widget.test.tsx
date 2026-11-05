import React from "react";
(globalThis as any).React = React;
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AiProcessingWidget,
  getJobTypeLabel,
  hasActiveProcessingJobs,
  setupActiveJobPolling,
  JOB_TYPE_LABELS,
} from "@/components/dashboard/ai-processing-widget";
import type { DashboardProcessingJob } from "@/lib/dashboard";
import type { JobStatus, JobType } from "@prisma/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function createJob(overrides: Partial<DashboardProcessingJob> = {}): DashboardProcessingJob {
  return {
    id: "job-1",
    type: "TRANSCRIPTION" as JobType,
    status: "SUCCEEDED" as JobStatus,
    progress: 100,
    error: null,
    createdAt: new Date("2026-11-04T12:00:00Z"),
    startedAt: new Date("2026-11-04T12:00:05Z"),
    completedAt: new Date("2026-11-04T12:00:30Z"),
    material: {
      id: "mat-1",
      title: "Lecture Recording",
      type: "AUDIO",
    },
    ...overrides,
  };
}

describe("AiProcessingWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. renders empty state when jobs array is empty", () => {
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[]} pollingEnabled={false} />);
    expect(html).toContain("No AI activity yet");
    expect(html).toContain("Once you record or upload material, processing status will show up here.");
  });

  it("2. renders QUEUED job correctly", () => {
    const job = createJob({
      id: "job-q",
      type: "TRANSCRIPTION",
      status: "QUEUED",
      progress: 0,
      material: { id: "mat-1", title: "Bio Audio", type: "AUDIO" },
    });
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[job]} pollingEnabled={false} />);
    expect(html).toContain("Queued");
    expect(html).toContain("Audio Transcription");
    expect(html).toContain("Bio Audio");
  });

  it("3. renders RUNNING job with meaningful progress percentage and progress bar", () => {
    const jobWithProgress = createJob({
      id: "job-run-1",
      type: "AI_NOTE_GENERATION",
      status: "RUNNING",
      progress: 45,
    });
    const htmlWithProgress = renderToStaticMarkup(
      <AiProcessingWidget jobs={[jobWithProgress]} pollingEnabled={false} />
    );
    expect(htmlWithProgress).toContain("Processing (45%)");
    expect(htmlWithProgress).toContain('style="width:45%"');

    // Job with progress = 0 should not display "0%"
    const jobZeroProgress = createJob({
      id: "job-run-2",
      type: "TRANSCRIPTION",
      status: "RUNNING",
      progress: 0,
    });
    const htmlZeroProgress = renderToStaticMarkup(
      <AiProcessingWidget jobs={[jobZeroProgress]} pollingEnabled={false} />
    );
    expect(htmlZeroProgress).toContain("Processing");
    expect(htmlZeroProgress).not.toContain("Processing (0%)");
  });

  it("4. renders SUCCEEDED job correctly", () => {
    const job = createJob({
      id: "job-suc",
      type: "DOCUMENT_EXTRACTION",
      status: "SUCCEEDED",
      progress: 100,
    });
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[job]} pollingEnabled={false} />);
    expect(html).toContain("Completed");
    expect(html).toContain("Document Extraction");
  });

  it("5. renders FAILED job with safe error text", () => {
    const job = createJob({
      id: "job-fail",
      type: "OCR",
      status: "FAILED",
      progress: 10,
      error: "Document pages are blurry or corrupted.",
    });
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[job]} pollingEnabled={false} />);
    expect(html).toContain("Failed");
    expect(html).toContain("Document pages are blurry or corrupted.");
  });

  it("6. renders CANCELLED job without misrepresenting as succeeded", () => {
    const job = createJob({
      id: "job-cancel",
      type: "TRANSCRIPTION",
      status: "CANCELLED",
      progress: 50,
    });
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[job]} pollingEnabled={false} />);
    expect(html).toContain("Cancelled");
    expect(html).not.toContain("Completed");
    expect(html).not.toContain("Processing");
  });

  it("7. supports every JobType and safe fallback behavior", () => {
    const allJobTypes: JobType[] = [
      "TRANSCRIPTION",
      "OCR",
      "DOCUMENT_EXTRACTION",
      "AI_NOTE_GENERATION",
      "SUMMARY_GENERATION",
      "QUESTION_GENERATION",
      "EMBEDDING",
      "FLASHCARD_GENERATION",
      "QUIZ_GENERATION",
      "LINK_IMPORT",
      "GOOGLE_SYNC",
    ];

    for (const type of allJobTypes) {
      expect(JOB_TYPE_LABELS[type]).toBeDefined();
      expect(getJobTypeLabel(type)).toBe(JOB_TYPE_LABELS[type]);
    }

    // Safe fallback for future / unknown job type
    expect(getJobTypeLabel("FUTURE_AI_SYNTHESIS" as any)).toBe("Future Ai Synthesis");
  });

  it("8. renders material link only when authorized material data exists", () => {
    const job = createJob({
      material: {
        id: "mat-abc",
        title: "Microbiology Notes",
        type: "PDF",
      },
    });
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[job]} pollingEnabled={false} />);
    expect(html).toContain('href="/materials/mat-abc"');
    expect(html).toContain("Microbiology Notes");
  });

  it("9. renders no material link when material is null", () => {
    const job = createJob({
      material: null,
    });
    const html = renderToStaticMarkup(<AiProcessingWidget jobs={[job]} pollingEnabled={false} />);
    expect(html).not.toContain('href="/materials/');
    expect(html).toContain("No linked material");
  });

  describe("active-job polling behavior", () => {
    it("10. starts polling when at least one job is active", () => {
      const activeJob = createJob({ status: "RUNNING" });
      const onRefresh = vi.fn();

      const cleanup = setupActiveJobPolling({
        jobs: [activeJob],
        intervalMs: 1000,
        enabled: true,
        onRefresh,
      });

      expect(onRefresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(onRefresh).toHaveBeenCalledTimes(2);

      cleanup();
    });

    it("11. stops polling when all jobs become terminal", () => {
      const terminalJobs = [
        createJob({ status: "SUCCEEDED" }),
        createJob({ status: "FAILED" }),
        createJob({ status: "CANCELLED" }),
      ];

      expect(hasActiveProcessingJobs(terminalJobs)).toBe(false);

      const onRefresh = vi.fn();
      const cleanup = setupActiveJobPolling({
        jobs: terminalJobs,
        intervalMs: 1000,
        enabled: true,
        onRefresh,
      });

      vi.advanceTimersByTime(5000);
      expect(onRefresh).not.toHaveBeenCalled();

      cleanup();
    });

    it("12. cleans up polling timer on unmount", () => {
      const activeJob = createJob({ status: "QUEUED" });
      const onRefresh = vi.fn();

      const cleanup = setupActiveJobPolling({
        jobs: [activeJob],
        intervalMs: 1000,
        enabled: true,
        onRefresh,
      });

      vi.advanceTimersByTime(1000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Call cleanup function (simulating component unmount)
      cleanup();

      vi.advanceTimersByTime(5000);
      expect(onRefresh).toHaveBeenCalledTimes(1); // No further calls
    });

    it("13. does not poll when the jobs array is empty", () => {
      expect(hasActiveProcessingJobs([])).toBe(false);

      const onRefresh = vi.fn();
      const cleanup = setupActiveJobPolling({
        jobs: [],
        intervalMs: 1000,
        enabled: true,
        onRefresh,
      });

      vi.advanceTimersByTime(5000);
      expect(onRefresh).not.toHaveBeenCalled();

      cleanup();
    });

    it("14. skips refresh when document tab is hidden", () => {
      const activeJob = createJob({ status: "RUNNING" });
      const onRefresh = vi.fn();

      let visibility: DocumentVisibilityState = "hidden";

      const cleanup = setupActiveJobPolling({
        jobs: [activeJob],
        intervalMs: 1000,
        enabled: true,
        onRefresh,
        getVisibilityState: () => visibility,
      });

      vi.advanceTimersByTime(2000);
      expect(onRefresh).not.toHaveBeenCalled();

      // Tab becomes visible again
      visibility = "visible";
      vi.advanceTimersByTime(1000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it("15. invokes router.refresh when router is passed directly", () => {
      const activeJob = createJob({ status: "RUNNING" });
      const refreshMock = vi.fn();

      const cleanup = setupActiveJobPolling({
        jobs: [activeJob],
        intervalMs: 1000,
        enabled: true,
        router: { refresh: refreshMock },
      });

      vi.advanceTimersByTime(1000);
      expect(refreshMock).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });
});
