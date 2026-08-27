/**
 * Provider-agnostic service interfaces (spec §64, §106).
 *
 * Nothing in the app should import Anthropic/OpenAI/Google SDKs directly
 * outside of the concrete implementation files in this folder. Route
 * handlers, workers, and components depend on these interfaces only, so
 * swapping providers later never touches call sites.
 *
 * Implementations are added phase-by-phase:
 *   - SpeechService            -> Phase 4 (transcription)
 *   - VisionService            -> Phase 4/5 (image + OCR understanding)
 *   - DocumentProcessingService-> Phase 3/4 (PDF/DOCX/PPTX text extraction)
 *   - EmbeddingService         -> Phase 5 (RAG)
 *   - AIService                -> Phase 5 (chat, note generation, study tools)
 *
 * Each is registered in `src/lib/services/registry.ts` behind an env-driven
 * switch, so a missing API key produces a clear configuration error instead
 * of a silently fake response (spec §92).
 */

export interface TranscriptSegmentResult {
  startSeconds: number;
  endSeconds: number;
  text: string;
  speakerLabel?: string;
}

export interface SpeechService {
  /**
   * Takes raw audio bytes (the orchestrator resolves these from whichever
   * StorageService backend is active — local disk or S3 — so providers
   * themselves never touch storage) and returns real, provider-produced
   * segments. Speaker labels are populated only by providers that actually
   * diarize (see speech-assemblyai.ts); providers that don't (see
   * speech-openai.ts) leave `speakerLabel` undefined rather than guessing.
   */
  transcribe(input: {
    audioBuffer: Buffer;
    mimeType: string;
    languageHint?: string;
  }): Promise<{ segments: TranscriptSegmentResult[]; language: string }>;
}

export interface VisionService {
  analyzeImage(input: { imageStorageKey: string }): Promise<{
    extractedText: string;
    description: string;
  }>;
}

export interface DocumentProcessingService {
  extractText(input: { storageKey: string; mimeType: string }): Promise<{
    text: string;
    pages?: { pageNumber: number; text: string }[];
  }>;
}

export interface EmbeddingService {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIService {
  chat(input: {
    messages: AIChatMessage[];
    context?: string; // retrieved chunks, pre-formatted
    stream?: boolean;
  }): Promise<{ content: string; tokensInput: number; tokensOutput: number }>;

  generateNotes(input: { transcriptText: string; templateKind: "lecture" | "meeting" }): Promise<{
    blocks: { kind: string; heading?: string; content: string }[];
  }>;
}

/** Thrown when a provider is selected but its required env vars are absent. */
export class ServiceNotConfiguredError extends Error {
  constructor(serviceName: string, missingEnvVars: string[]) {
    super(
      `${serviceName} is not configured. Set the following environment variable(s): ${missingEnvVars.join(
        ", "
      )}. See docs/ai-setup.md for activation steps.`
    );
    this.name = "ServiceNotConfiguredError";
  }
}
