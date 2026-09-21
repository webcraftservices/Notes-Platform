import type { SpeechService, TranscriptSegmentResult } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/fetch-timeout";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 20 * 60 * 1000; // 20 minutes — generous for a long lecture

// Phase 9.4 — explicit per-request budgets. `fetch` has no timeout of its
// own, so a stalled connection used to hang the whole transcription job.
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // whole audio file, possibly hundreds of MB
const API_TIMEOUT_MS = 30 * 1000; // small JSON create/poll calls
const MAX_BODY_EXCERPT = 300;
// A status poll is a read-only GET on a transcript that is still running
// server-side, so one blip (5xx, 429, timeout, dropped connection) should
// not throw away a job that has been running — and billing — for minutes.
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
const ASSEMBLYAI_TRANSCRIPTION_MODELS = ["universal-2"];

interface AssemblyAIUtterance {
  speaker: string;
  start: number; // milliseconds
  end: number;
  text: string;
}

interface AssemblyAITranscriptResponse {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  language_code?: string;
  utterances?: AssemblyAIUtterance[];
  text?: string;
  audio_duration?: number;
}

/**
 * Real integration against AssemblyAI's REST API (upload → create
 * transcript with speaker_labels → poll until done). Recommended as the
 * default provider specifically because it diarizes (real per-utterance
 * speaker labels, not a guess) and has no practical file-size limit — long
 * lectures don't need client-side chunking the way they would with
 * Whisper's 25MB cap. Untestable from this sandbox (api.assemblyai.com
 * isn't reachable here) — same documented limitation as the S3 backend
 * and the OpenAI provider above; written against AssemblyAI's published
 * API contract.
 */
export class AssemblyAISpeechService implements SpeechService {
  constructor(private readonly apiKey: string) {}

  async transcribe(input: {
    audioBuffer: Buffer;
    mimeType: string;
    languageHint?: string;
  }): Promise<{ segments: TranscriptSegmentResult[]; language: string }> {
    const uploadUrl = await this.upload(input.audioBuffer);
    const transcriptId = await this.requestTranscript(uploadUrl, input.languageHint);
    const result = await this.pollUntilDone(transcriptId);

    if (result.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${result.error ?? "unknown error"}`);
    }

    const segments: TranscriptSegmentResult[] = (result.utterances ?? []).map((u) => ({
      startSeconds: Math.round(u.start / 1000),
      endSeconds: Math.round(u.end / 1000),
      text: u.text.trim(),
      speakerLabel: `Speaker ${u.speaker}`,
    }));

    if (segments.length === 0 && result.text) {
      segments.push({
        startSeconds: 0,
        endSeconds: result.audio_duration ?? 0,
        text: result.text.trim(),
      });
    }

    return { segments, language: result.language_code ?? "unknown" };
  }

  private async upload(buffer: Buffer): Promise<string> {
    // Not retried: re-sending the whole file is expensive and, if the
    // first attempt actually landed, would just duplicate the upload.
    const res = await fetchWithTimeout(
      "https://api.assemblyai.com/v2/upload",
      { method: "POST", headers: { authorization: this.apiKey }, body: new Uint8Array(buffer) },
      { timeoutMs: UPLOAD_TIMEOUT_MS, label: "AssemblyAI upload" }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AssemblyAI upload failed (${res.status}): ${body.slice(0, MAX_BODY_EXCERPT)}`);
    }
    const { upload_url } = (await res.json()) as { upload_url: string };
    return upload_url;
  }

  private async requestTranscript(audioUrl: string, languageHint?: string): Promise<string> {
    // Not retried: every successful POST here creates a separate, billed
    // transcript, so a retry after an ambiguous failure could pay twice.
    const res = await fetchWithTimeout(
      "https://api.assemblyai.com/v2/transcript",
      {
        method: "POST",
        headers: { authorization: this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          audio_url: audioUrl,
          speech_models: ASSEMBLYAI_TRANSCRIPTION_MODELS,
          speaker_labels: true,
          language_code: languageHint,
        }),
      },
      { timeoutMs: API_TIMEOUT_MS, label: "AssemblyAI transcript request" }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AssemblyAI transcript request failed (${res.status}): ${body.slice(0, MAX_BODY_EXCERPT)}`);
    }
    const data = (await res.json()) as AssemblyAITranscriptResponse;
    return data.id;
  }

  private async pollUntilDone(id: string): Promise<AssemblyAITranscriptResponse> {
    const deadline = Date.now() + MAX_POLL_MS;
    let consecutiveFailures = 0;

    while (Date.now() < deadline) {
      try {
        const res = await fetchWithTimeout(
          `https://api.assemblyai.com/v2/transcript/${id}`,
          { headers: { authorization: this.apiKey } },
          { timeoutMs: API_TIMEOUT_MS, label: "AssemblyAI status check" }
        );
        if (!res.ok) {
          // 429/5xx are transient; anything else (401/403/404...) will not
          // fix itself, so fail immediately instead of polling it for 20 minutes.
          if (res.status === 429 || res.status >= 500) {
            throw new TransientPollError(`AssemblyAI status check failed (${res.status})`);
          }
          throw new Error(`AssemblyAI status check failed (${res.status})`);
        }
        const data = (await res.json()) as AssemblyAITranscriptResponse;
        consecutiveFailures = 0;
        if (data.status === "completed" || data.status === "error") return data;
      } catch (err) {
        if (!isTransientPollFailure(err)) throw err;
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          throw new Error(
            `AssemblyAI status checks failed ${MAX_CONSECUTIVE_POLL_FAILURES} times in a row: ${
              err instanceof Error ? err.message : "unknown error"
            }`
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("AssemblyAI transcription timed out after 20 minutes.");
  }
}

class TransientPollError extends Error {}

function isTransientPollFailure(err: unknown): boolean {
  if (err instanceof TransientPollError || err instanceof RequestTimeoutError) return true;
  // Transport-level failure (connection reset, DNS blip) — fetch rejects with a TypeError.
  return err instanceof TypeError;
}

export function createAssemblyAIService(): AssemblyAISpeechService {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new ServiceNotConfiguredError("AssemblyAI SpeechService", ["ASSEMBLYAI_API_KEY"]);
  }
  return new AssemblyAISpeechService(apiKey);
}
