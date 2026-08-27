import { describe, expect, it } from "vitest";
import { OpenAIWhisperSpeechService } from "@/lib/services/speech-openai";

describe("OpenAIWhisperSpeechService", () => {
  it("rejects buffers over the 25MB Whisper limit before making any network call", async () => {
    const service = new OpenAIWhisperSpeechService("fake-key-not-used");
    const oversized = Buffer.alloc(26 * 1024 * 1024);

    await expect(
      service.transcribe({ audioBuffer: oversized, mimeType: "audio/webm" })
    ).rejects.toThrow(/25MB/);
  });

  it("mentions the assemblyai fallback in the size-limit error", async () => {
    const service = new OpenAIWhisperSpeechService("fake-key-not-used");
    const oversized = Buffer.alloc(30 * 1024 * 1024);

    await expect(
      service.transcribe({ audioBuffer: oversized, mimeType: "audio/webm" })
    ).rejects.toThrow(/assemblyai/i);
  });
});
