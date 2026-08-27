import type { SpeechService } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";

/**
 * SPEECH_PROVIDER selects the backend explicitly ("openai" | "assemblyai").
 * No default silently picks a provider — if unset, this throws a clear
 * configuration error naming exactly what to set, same pattern as
 * getStorageService(). "Not configured" and "actually failed" both surface
 * as a real error on the ProcessingJob (spec §92 — never fake success).
 *
 * AssemblyAI is the recommended default in .env.example specifically
 * because it diarizes and has no practical file-size limit; OpenAI Whisper
 * is offered as a cheaper/simpler alternative for users who don't need
 * speaker labels and stay under its 25MB request limit.
 */
export function getSpeechService(): SpeechService {
  const provider = process.env.SPEECH_PROVIDER;

  if (provider === "assemblyai") {
    const { createAssemblyAIService } = require("./speech-assemblyai") as typeof import("./speech-assemblyai");
    return createAssemblyAIService();
  }

  if (provider === "openai") {
    const { createOpenAIWhisperService } = require("./speech-openai") as typeof import("./speech-openai");
    return createOpenAIWhisperService();
  }

  throw new ServiceNotConfiguredError("SpeechService", [
    'SPEECH_PROVIDER ("openai" or "assemblyai")',
    "and the matching API key (OPENAI_API_KEY or ASSEMBLYAI_API_KEY)",
  ]);
}
