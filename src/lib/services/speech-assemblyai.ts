import type { SpeechService, TranscriptSegmentResult } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 20 * 60 * 1000; // 20 minutes — generous for a long lecture

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
    const res = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: this.apiKey },
      body: new Uint8Array(buffer),
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI upload failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
    const { upload_url } = (await res.json()) as { upload_url: string };
    return upload_url;
  }

  private async requestTranscript(audioUrl: string, languageHint?: string): Promise<string> {
    const res = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { authorization: this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: audioUrl,
        speaker_labels: true,
        language_code: languageHint,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `AssemblyAI transcript request failed (${res.status}): ${await res.text().catch(() => "")}`
      );
    }
    const data = (await res.json()) as AssemblyAITranscriptResponse;
    return data.id;
  }

  private async pollUntilDone(id: string): Promise<AssemblyAITranscriptResponse> {
    const deadline = Date.now() + MAX_POLL_MS;
    while (Date.now() < deadline) {
      const res = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { authorization: this.apiKey },
      });
      if (!res.ok) {
        throw new Error(`AssemblyAI status check failed (${res.status})`);
      }
      const data = (await res.json()) as AssemblyAITranscriptResponse;
      if (data.status === "completed" || data.status === "error") return data;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("AssemblyAI transcription timed out after 20 minutes.");
  }
}

export function createAssemblyAIService(): AssemblyAISpeechService {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new ServiceNotConfiguredError("AssemblyAI SpeechService", ["ASSEMBLYAI_API_KEY"]);
  }
  return new AssemblyAISpeechService(apiKey);
}
