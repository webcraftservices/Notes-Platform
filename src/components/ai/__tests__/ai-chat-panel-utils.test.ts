import { describe, expect, it } from "vitest";
import { scopeToQuery } from "@/components/ai/ai-chat-panel";

/**
 * Phase 8.4 — UI/API contract (task item G). Proves the exact query string
 * AIChatPanel sends to GET /api/ai/conversations for each kind, since
 * that's the only thing that actually changes between the plain "Ask AI"
 * panel and the Tutor panel at the UI layer.
 */
describe("scopeToQuery", () => {
  it("omits the kind param entirely for CHAT (byte-identical to every pre-8.4 caller)", () => {
    expect(scopeToQuery({ topicId: "topic-1" }, "CHAT")).toBe("topicId=topic-1");
  });

  it("includes kind=TUTOR for a Tutor panel", () => {
    const query = scopeToQuery({ topicId: "topic-1" }, "TUTOR");
    expect(query).toContain("topicId=topic-1");
    expect(query).toContain("kind=TUTOR");
  });

  it("preserves the topicId alongside kind=TUTOR — Tutor is always Topic-scoped", () => {
    const params = new URLSearchParams(scopeToQuery({ topicId: "topic-42" }, "TUTOR"));
    expect(params.get("topicId")).toBe("topic-42");
    expect(params.get("kind")).toBe("TUTOR");
  });

  it("produces an empty query string for the workspace-level CHAT scope, same as before Phase 8.4", () => {
    expect(scopeToQuery({}, "CHAT")).toBe("");
  });
});
