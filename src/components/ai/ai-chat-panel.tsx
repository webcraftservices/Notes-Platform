"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface AISource {
  materialId: string;
  label: string;
  timestampSeconds?: number;
  page?: number;
}

interface AIMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  sources?: AISource[] | null;
  createdAt: string;
}

/**
 * One scope query param (topicId/chapterId/subjectId/groupId) — omit all
 * of them for the workspace-level (global) assistant. Matches
 * lib/validation/ai.ts's aiScopeQuerySchema exactly. `groupId` (Phase
 * 6.5) is the bare "ask across everything this group has shared" scope —
 * distinct from a group-owned Subject/Chapter/Topic, which uses the
 * matching subjectId/chapterId/topicId scope instead.
 */
type AIScope =
  | { topicId: string }
  | { chapterId: string }
  | { subjectId: string }
  | { groupId: string }
  | Record<string, never>;

function scopeToQuery(scope: AIScope): string {
  const params = new URLSearchParams(scope as Record<string, string>);
  return params.toString();
}

export function AIChatPanel({ scope, emptyStateHint }: { scope: AIScope; emptyStateHint: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const query = scopeToQuery(scope);

  useEffect(() => {
    fetch(`/api/ai/conversations${query ? `?${query}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setConversationId(d.conversation.id);
        setMessages(d.conversation.messages);
      })
      .catch(() => toast.error("Couldn't load this AI conversation."));
    // Scope is stable for the lifetime of this panel instance (each page
    // renders one AIChatPanel per fixed scope), so `query` alone is a
    // sufficient effect dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || !conversationId || sending) return;

    setSending(true);
    setConfigError(null);
    // Optimistic user bubble — replaced by the server's persisted version
    // once the request succeeds; removed again if it fails, since a
    // failed turn intentionally persists nothing (see the messages route's
    // doc comment) and shouldn't leave a dangling local-only bubble either.
    const optimisticId = `optimistic-${Date.now()}`;
    setMessages((prev) => [
      ...(prev ?? []),
      { id: optimisticId, role: "USER", content, createdAt: new Date().toISOString() },
    ]);
    setDraft("");

    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.status === 503) {
        const { error } = await res.json();
        setConfigError(error);
        setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimisticId));
        return;
      }
      if (!res.ok) {
        toast.error("Couldn't send that message.");
        setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimisticId));
        return;
      }

      const { userMessage, assistantMessage } = await res.json();
      setMessages((prev) => [
        ...(prev ?? []).filter((m) => m.id !== optimisticId),
        userMessage,
        assistantMessage,
      ]);
    } catch {
      toast.error("Couldn't send that message.");
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimisticId));
    } finally {
      setSending(false);
    }
  }

  if (messages === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {messages.length === 0 && !configError && (
        <EmptyState
          icon={Sparkles}
          title="Ask AI anything about this"
          description={emptyStateHint}
        />
      )}

      {messages.length > 0 && (
        <div className="space-y-4 pb-4">
          {messages.map((message) => (
            <div key={message.id} className={message.role === "USER" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  message.role === "USER"
                    ? "max-w-[80%] rounded-sm bg-ink px-3.5 py-2.5 text-sm text-paper dark:bg-white dark:text-graphite-950"
                    : "max-w-[80%] rounded-sm border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-ink dark:border-line-dark dark:bg-graphite-800 dark:text-white"
                }
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line/60 pt-2.5 dark:border-line-dark/60">
                    {message.sources.map((source, i) => (
                      <Badge key={i} variant="muted">
                        {source.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {configError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-sm border border-signal-info/30 bg-signal-info/5 px-3.5 py-3 text-sm text-ink dark:text-white">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-info" />
          <div>
            <p className="font-medium">AI chat isn&apos;t configured yet</p>
            <p className="mt-0.5 text-ink-muted dark:text-white/50">{configError}</p>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 flex items-end gap-2 border-t border-line bg-paper pt-3 dark:border-line-dark dark:bg-graphite-950">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask a question..."
          rows={2}
          disabled={sending}
        />
        <Button onClick={handleSend} loading={sending} disabled={!draft.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
