import { NextResponse } from "next/server";
import { getSessionUser, getAccessibleTopic, NotAuthorizedError } from "@/lib/access";
import { getOrCreateTopicNote } from "@/lib/notes";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Phase 3 keeps the UI to one note per topic — the schema (Note.topicId is
 * a plain nullable FK, not unique) technically allows several, which
 * later phases can expose if needed, but a single get-or-create note per
 * topic is the simplest thing that satisfies "every topic has notes"
 * without adding a notes-list UI this phase doesn't need yet. The actual
 * get-or-create logic lives in lib/notes.ts (extracted in Phase 5 so the
 * AI note-generation job can reuse it too).
 */
export async function GET(_req: Request, { params }: { params: { topicId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const topic = await getAccessibleTopic(params.topicId, user.id);
    if (!topic) return NOT_FOUND();

    const note = await getOrCreateTopicNote(topic, user.id);

    return NextResponse.json({ note });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
