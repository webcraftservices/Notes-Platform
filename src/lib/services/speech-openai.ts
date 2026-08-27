import type { SpeechService, TranscriptSegmentResult } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // OpenAI's hard limit for this endpoint

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperVerboseResponse {
  language?: string;
  segments?: WhisperSegment[];
  text?: string;
}

/**
 * Real integration against OpenAI's /v1/audio/transcriptions endpoint
 * (whisper-1, verbose_json with segment timestamps). This is untestable
 * from this sandbox — api.openai.com isn't reachable here — the same
 * documented limitation as the S3 storage backend in Phase 3. The request
 * shape and response parsing below are written against OpenAI's published
 * API contract and are ready to run wherever network access allows it.
 *
 * Whisper's API doesn't diarize, so every segment's `speakerLabel` is left
 * undefined — never fabricated. Use the AssemblyAI provider for real
 * speaker labels.
 */
export class OpenAIWhisperSpeechService implements SpeechService {
  constructor(private readonly apiKey: string) {}

  async transcribe(input: {
    audioBuffer: Buffer;
    mimeType: string;
    languageHint?: string;
  }): Promise<{ segments: TranscriptSegmentResult[]; language: string }> {
    if (input.audioBuffer.byteLength > WHISPER_MAX_BYTES) {
      throw new Error(
        `This file is ${Math.round(input.audioBuffer.byteLength / (1024 * 1024))}MB, which exceeds ` +
          `OpenAI Whisper's 25MB limit. Switch SPEECH_PROVIDER to "assemblyai" for long recordings — ` +
          `it has no such limit and handles chunking server-side. See docs/ARCHITECTURE.md.`
      );
    }

    const form = new FormData();
    const extension = input.mimeType.split("/")[1] ?? "webm";
    form.append("file", new Blob([new Uint8Array(input.audioBuffer)], { type: input.mimeType }), `audio.${extension}`);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (input.languageHint) form.append("language", input.languageHint);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI Whisper request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as WhisperVerboseResponse;
    const segments: TranscriptSegmentResult[] = (data.segments ?? []).map((s) => ({
      startSeconds: s.start,
      endSeconds: s.end,
      text: s.text.trim(),
    }));

    // Fall back to a single whole-file segment if the API returned plain
    // text without segment timestamps (can happen for very short clips).
    if (segments.length === 0 && data.text) {
      segments.push({ startSeconds: 0, endSeconds: 0, text: data.text.trim() });
    }

    return { segments, language: data.language ?? "unknown" };
  }
}

export function createOpenAIWhisperService(): OpenAIWhisperSpeechService {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceNotConfiguredError("OpenAI Whisper SpeechService", ["OPENAI_API_KEY"]);
  }
  return new OpenAIWhisperSpeechService(apiKey);
}
