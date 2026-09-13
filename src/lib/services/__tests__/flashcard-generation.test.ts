import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  topic: { findUnique: vi.fn() },
  flashcardDeck: { create: vi.fn(), findUniqueOrThrow: vi.fn() },
  flashcard: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getAccessibleAIScope: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const retrieval = vi.hoisted(() => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("@/lib/retrieval", () => retrieval);

const aiServiceRegistry = vi.hoisted(() => ({ getAIService: vi.fn() }));
vi.mock("@/lib/services/ai", () => aiServiceRegistry);

const usageModule = vi.hoisted(() => ({ recordAIUsage: vi.fn() }));
vi.mock("@/lib/ai-usage", () => usageModule);

import {
  generateFlashcardsForTopic,
  InsufficientSourceMaterialError,
  FlashcardGenerationOutputError,
} from "@/lib/services/flashcard-generation";

const WORKSPACE_SCOPE = {
  ownerType: "workspace" as const,
  workspaceId: "workspace-1",
  groupId: null,
  subjectId: "subject-1",
  chapterId: "chapter-1",
  topicId: "topic-1",
};

const GROUP_SCOPE = {
  ownerType: "group" as const,
  workspaceId: null,
  groupId: "group-1",
  subjectId: "subject-1",
  chapterId: "chapter-1",
  topicId: "topic-1",
};

const SAMPLE_CHUNK = {
  id: "chunk-1",
  materialId: "clabcdefghijklmnopqrstuv",
  materialTitle: "Lecture 12",
  content: "Thermal equilibrium is reached when no net heat flows.",
  pageNumber: null,
  startSeconds: 120,
  endSeconds: 140,
  similarity: 0.9,
};

function mockChatResult(content: string) {
  return { content, tokensInput: 100, tokensOutput: 50 };
}

describe("generateFlashcardsForTopic", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
    db.topic.findUnique.mockResolvedValue({ id: "topic-1", name: "Zeroth Law", description: "Thermal equilibrium" });
    retrieval.retrieveRelevantChunks.mockResolvedValue([SAMPLE_CHUNK]);
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(
        mockChatResult(
          JSON.stringify([
            { front: "What is thermal equilibrium?", back: "No net heat flow between two systems." },
            { front: "What is the Zeroth Law?", back: "If A~B and B~C, then A~C." },
          ])
        )
      ),
    });

    let createdCount = 0;
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => {
      db.flashcardDeck.create.mockResolvedValue({ id: "deck-1", title: "Flashcards — Zeroth Law" });
      db.flashcard.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        createdCount += 1;
        return { id: `card-${createdCount}`, ...data };
      });
      db.flashcardDeck.findUniqueOrThrow.mockResolvedValue({
        id: "deck-1",
        title: "Flashcards — Zeroth Law",
        cards: [],
      });
      return fn(db);
    });
  });

  it("retrieves knowledge scoped to the topic and generates real cards", async () => {
    await generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(access.getAccessibleAIScope).toHaveBeenCalledWith({ topicId: "topic-1" }, "user-1");
    expect(retrieval.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.any(String),
      WORKSPACE_SCOPE,
      "user-1",
      expect.any(Number)
    );
  });

  it("creates exactly one deck scoped to the topic's resolved owner", async () => {
    await generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.flashcardDeck.create).toHaveBeenCalledTimes(1);
    expect(db.flashcardDeck.create).toHaveBeenCalledWith({
      data: {
        title: "Flashcards — Zeroth Law",
        ownerId: "user-1",
        workspaceId: "workspace-1",
        groupId: null,
        subjectId: "subject-1",
        chapterId: "chapter-1",
        topicId: "topic-1",
      },
    });
  });

  it("creates a deck under the group's scope for a group-owned topic, never a bare workspace", async () => {
    access.getAccessibleAIScope.mockResolvedValue(GROUP_SCOPE);

    await generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.flashcardDeck.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ groupId: "group-1", workspaceId: null }) })
    );
  });

  it("persists cards in insertion order and attaches real retrieved-chunk provenance to every card", async () => {
    await generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.flashcard.create).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = db.flashcard.create.mock.calls;
    expect(firstCall?.[0].data).toMatchObject({ front: "What is thermal equilibrium?" });
    expect(secondCall?.[0].data).toMatchObject({ front: "What is the Zeroth Law?" });

    for (const call of db.flashcard.create.mock.calls) {
      expect(call[0].data.sources).toEqual([
        expect.objectContaining({
          materialId: "clabcdefghijklmnopqrstuv",
          label: expect.stringContaining("Lecture 12"),
        }),
      ]);
    }
  });

  it("records AI usage under the flashcard_generation category with the real provider/model/token counts", async () => {
    await generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(usageModule.recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "workspace-1",
        category: "flashcard_generation",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        tokensInput: 100,
        tokensOutput: 50,
      })
    );
  });

  it("throws InsufficientSourceMaterialError and never calls the AI when nothing is indexed for the topic", async () => {
    retrieval.retrieveRelevantChunks.mockResolvedValue([]);

    await expect(generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      InsufficientSourceMaterialError
    );
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("throws FlashcardGenerationOutputError and creates no deck when the AI response isn't valid JSON", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(mockChatResult("not json at all")),
    });

    await expect(generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      FlashcardGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("throws FlashcardGenerationOutputError and creates no deck when the AI returns an empty array", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(mockChatResult("[]")),
    });

    await expect(generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      FlashcardGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("throws FlashcardGenerationOutputError and creates no deck when items are missing required fields", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(mockChatResult(JSON.stringify([{ front: "Question only, no back" }]))),
    });

    await expect(generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      FlashcardGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("tolerates the AI wrapping its JSON in a markdown code fence despite being told not to", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi
        .fn()
        .mockResolvedValue(mockChatResult('```json\n[{"front": "Q", "back": "A"}]\n```')),
    });

    await generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.flashcard.create).toHaveBeenCalledTimes(1);
  });

  it("lets a real AI provider failure propagate without creating a deck", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockRejectedValue(new Error("Gemini request failed (503): overloaded")),
    });

    await expect(generateFlashcardsForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      "Gemini request failed"
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("propagates NotAuthorizedError from scope resolution without ever calling the AI", async () => {
    access.getAccessibleAIScope.mockRejectedValue(new access.NotAuthorizedError());

    await expect(generateFlashcardsForTopic({ userId: "user-2", topicId: "topic-1" })).rejects.toThrow(
      access.NotAuthorizedError
    );
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
  });
});
