import type { RetrievedChunk } from "@/lib/retrieval";
import type { AIChatMessage } from "@/lib/services/interfaces";
import { formatDuration } from "@/lib/material-style";

/** The shape stored in AIMessage.sources (see prisma/schema.prisma's comment on that field). */
export interface AIMessageSource {
  materialId: string;
  label: string;
  timestampSeconds?: number;
  page?: number;
}

/**
 * A short human-readable label for a retrieved chunk, e.g.
 * "Lecture 12 — 12:45" (timestamp) or "Thermodynamics.pdf — Page 8".
 * Pure formatting logic, reused for both the sources array and the
 * context block sent to the AI.
 */
export function formatChunkLabel(chunk: RetrievedChunk): string {
  if (chunk.startSeconds != null) return `${chunk.materialTitle} — ${formatDuration(chunk.startSeconds)}`;
  if (chunk.pageNumber != null) return `${chunk.materialTitle} — Page ${chunk.pageNumber}`;
  return chunk.materialTitle;
}

export function chunksToSources(chunks: RetrievedChunk[]): AIMessageSource[] {
  return chunks.map((chunk) => ({
    materialId: chunk.materialId,
    label: formatChunkLabel(chunk),
    ...(chunk.startSeconds != null ? { timestampSeconds: chunk.startSeconds } : {}),
    ...(chunk.pageNumber != null ? { page: chunk.pageNumber } : {}),
  }));
}

/**
 * Builds the pre-formatted context string passed as AIService.chat()'s
 * `context` param — numbered passages the system prompt (owned by the
 * concrete AIService implementation, not this file) can instruct the
 * model to cite and to avoid contradicting. Returns null when there are
 * no chunks, so callers can distinguish "nothing indexed" from "AI
 * answered with no supporting context" and prompt the model (or inform
 * the user) accordingly — see CLAUDE.md / spec §24's hallucination
 * control requirement.
 */
export function buildContextBlock(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  return chunks
    .map((chunk, i) => `[${i + 1}] Source: ${formatChunkLabel(chunk)}\n${chunk.content}`)
    .join("\n\n");
}

export interface StoredMessage {
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
}

/** Maps persisted AIMessage rows to the AIChatMessage[] shape AIService.chat() expects. */
export function toChatMessages(messages: StoredMessage[]): AIChatMessage[] {
  return messages.map((m) => ({ role: m.role.toLowerCase() as AIChatMessage["role"], content: m.content }));
}
