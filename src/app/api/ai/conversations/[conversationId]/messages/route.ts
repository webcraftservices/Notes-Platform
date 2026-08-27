import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleAIConversation, getAccessibleAIScope, NotAuthorizedError } from "@/lib/access";
import { sendAIMessageSchema } from "@/lib/validation/ai";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import { buildContextBlock, chunksToSources, toChatMessages } from "@/lib/ai-chat";
import { getAIService } from "@/lib/services/ai";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { zodError, jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Sends a user message and gets a real AI reply grounded in retrieved
 * chunks (spec §21-24). Both the user message and the assistant reply are
 * written in a single transaction ONLY if the AI call actually succeeds —
 * if AIService/EmbeddingService aren't configured (always true in this
 * codebase state, see lib/services/ai.ts and embedding.ts) or the call
 * otherwise fails, NOTHING is persisted and a real 503 is returned. This
 * keeps conversation history free of orphaned user-only turns from a
 * broken configuration, and makes retrying (once a provider is
 * eventually wired up) exactly re-submit the same content — never a fake
 * assistant reply written to make the failure "go away" (CLAUDE.md's
 * "never fake a feature" rule).
 */
export async function POST(req: Request, { params }: { params: { conversationId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = sendAIMessageSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const conversation = await getAccessibleAIConversation(params.conversationId, user.id);
    if (!conversation) return NOT_FOUND();

    // Re-resolve the conversation's stored scope to get the same
    // ResolvedAIScope shape retrieval.ts needs — getAccessibleAIConversation
    // already re-validated access to it above.
    const scope = await getAccessibleAIScope(
      {
        topicId: conversation.topicId ?? undefined,
        chapterId: conversation.chapterId ?? undefined,
        subjectId: conversation.subjectId ?? undefined,
      },
      user.id
    );

    const priorMessages = await db.aIMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    const chunks = await retrieveRelevantChunks(parsed.data.content, scope);
    const context = buildContextBlock(chunks) ?? undefined;

    const ai = getAIService();
    const result = await ai.chat({
      messages: [...toChatMessages(priorMessages), { role: "user", content: parsed.data.content }],
      context,
    });

    const [userMessage, assistantMessage] = await db.$transaction([
      db.aIMessage.create({
        data: { conversationId: conversation.id, role: "USER", content: parsed.data.content },
      }),
      db.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: result.content,
          sources: chunks.length > 0 ? chunksToSources(chunks) : undefined,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
        },
      }),
    ]);
    await db.aIConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    return NextResponse.json({ userMessage, assistantMessage });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof ServiceNotConfiguredError) return jsonError(err.message, 503);
    throw err;
  }
}
