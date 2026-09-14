import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  topic: { findUnique: vi.fn() },
  quiz: { create: vi.fn(), findUniqueOrThrow: vi.fn() },
  quizQuestion: { create: vi.fn() },
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
  generateQuizForTopic,
  InsufficientSourceMaterialError,
  QuizGenerationOutputError,
} from "@/lib/services/quiz-generation";

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

const VALID_MIXED_ITEMS = [
  {
    prompt: "What is thermal equilibrium?",
    questionType: "MCQ",
    options: [
      { id: "a", text: "No net heat flow between systems" },
      { id: "b", text: "Maximum energy transfer" },
    ],
    correctAnswer: "a",
    explanation: "Systems in thermal equilibrium exchange no net heat.",
  },
  {
    prompt: "Entropy always increases in an isolated system.",
    questionType: "TRUE_FALSE",
    correctAnswer: true,
  },
  {
    prompt: "State the Zeroth Law.",
    questionType: "SHORT_ANSWER",
    correctAnswer: "If A is in equilibrium with B, and B with C, then A is in equilibrium with C.",
  },
];

describe("generateQuizForTopic", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
    db.topic.findUnique.mockResolvedValue({ id: "topic-1", name: "Zeroth Law", description: "Thermal equilibrium" });
    retrieval.retrieveRelevantChunks.mockResolvedValue([SAMPLE_CHUNK]);
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(mockChatResult(JSON.stringify(VALID_MIXED_ITEMS))),
    });

    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => {
      db.quiz.create.mockResolvedValue({ id: "quiz-1", title: "Quiz — Zeroth Law", quizType: "MIXED" });
      let orderCounter = 0;
      db.quizQuestion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: `question-${orderCounter}`, ...data };
        orderCounter += 1;
        return created;
      });
      db.quiz.findUniqueOrThrow.mockResolvedValue({ id: "quiz-1", title: "Quiz — Zeroth Law", questions: [] });
      return fn(db);
    });
  });

  it("retrieves knowledge scoped to the topic before calling the AI", async () => {
    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(access.getAccessibleAIScope).toHaveBeenCalledWith({ topicId: "topic-1" }, "user-1");
    expect(retrieval.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.any(String),
      WORKSPACE_SCOPE,
      "user-1",
      expect.any(Number)
    );
  });

  it("creates exactly one quiz scoped to the topic's resolved owner", async () => {
    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.quiz.create).toHaveBeenCalledTimes(1);
    expect(db.quiz.create).toHaveBeenCalledWith({
      data: {
        title: "Quiz — Zeroth Law",
        quizType: "MIXED",
        ownerId: "user-1",
        workspaceId: "workspace-1",
        groupId: null,
        subjectId: "subject-1",
        chapterId: "chapter-1",
        topicId: "topic-1",
      },
    });
  });

  it("infers quizType MIXED for a batch spanning multiple question types", async () => {
    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });
    expect(db.quiz.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quizType: "MIXED" }) }));
  });

  it("infers a single quizType when every generated question shares one type", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(
        mockChatResult(
          JSON.stringify([
            { prompt: "Q1?", questionType: "TRUE_FALSE", correctAnswer: true },
            { prompt: "Q2?", questionType: "TRUE_FALSE", correctAnswer: false },
          ])
        )
      ),
    });

    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quizType: "TRUE_FALSE" }) })
    );
  });

  it("creates a quiz under the group's scope for a group-owned topic, never a bare workspace", async () => {
    access.getAccessibleAIScope.mockResolvedValue(GROUP_SCOPE);

    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ groupId: "group-1", workspaceId: null }) })
    );
  });

  it("persists questions with stable order and attaches real retrieved-chunk provenance to every question", async () => {
    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.quizQuestion.create).toHaveBeenCalledTimes(3);
    const calls = db.quizQuestion.create.mock.calls;
    expect(calls[0]?.[0].data).toMatchObject({ order: 0, questionType: "MCQ" });
    expect(calls[1]?.[0].data).toMatchObject({ order: 1, questionType: "TRUE_FALSE" });
    expect(calls[2]?.[0].data).toMatchObject({ order: 2, questionType: "SHORT_ANSWER" });

    for (const call of calls) {
      expect(call[0].data.sources).toEqual([
        expect.objectContaining({ materialId: "clabcdefghijklmnopqrstuv", label: expect.stringContaining("Lecture 12") }),
      ]);
    }
  });

  it("never persists a sources value supplied by the model itself", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(
        mockChatResult(
          JSON.stringify([
            {
              prompt: "Q1?",
              questionType: "TRUE_FALSE",
              correctAnswer: true,
              sources: [{ materialId: "fake-invented-id", label: "Hallucinated source" }],
            },
          ])
        )
      ),
    });

    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    const call = db.quizQuestion.create.mock.calls[0];
    expect(call?.[0].data.sources).toEqual([
      expect.objectContaining({ materialId: "clabcdefghijklmnopqrstuv" }),
    ]);
  });

  it("records AI usage under the quiz_generation category with the real provider/model/token counts", async () => {
    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(usageModule.recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "workspace-1",
        category: "quiz_generation",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        tokensInput: 100,
        tokensOutput: 50,
      })
    );
  });

  it("throws InsufficientSourceMaterialError and never calls the AI when nothing is indexed for the topic", async () => {
    retrieval.retrieveRelevantChunks.mockResolvedValue([]);

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      InsufficientSourceMaterialError
    );
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("throws QuizGenerationOutputError and creates nothing when the AI response isn't valid JSON", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(mockChatResult("not json at all")),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      QuizGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("throws QuizGenerationOutputError and creates nothing when the AI returns an empty array", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(mockChatResult("[]")),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      QuizGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid MCQ item (fewer than two options) via the existing schema and creates nothing", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue(
        mockChatResult(
          JSON.stringify([{ prompt: "Q?", questionType: "MCQ", options: [{ id: "a", text: "Only one" }], correctAnswer: "a" }])
        )
      ),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      QuizGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid TRUE_FALSE item (string correctAnswer) via the existing schema and creates nothing", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi
        .fn()
        .mockResolvedValue(mockChatResult(JSON.stringify([{ prompt: "Q?", questionType: "TRUE_FALSE", correctAnswer: "true" }]))),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      QuizGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid SHORT_ANSWER item (boolean correctAnswer) via the existing schema and creates nothing", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi
        .fn()
        .mockResolvedValue(mockChatResult(JSON.stringify([{ prompt: "Q?", questionType: "SHORT_ANSWER", correctAnswer: true }]))),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      QuizGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects questionType MIXED for an individual generated item and creates nothing", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi
        .fn()
        .mockResolvedValue(mockChatResult(JSON.stringify([{ prompt: "Q?", questionType: "MIXED", correctAnswer: "a" }]))),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      QuizGenerationOutputError
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("tolerates the AI wrapping its JSON in a markdown code fence despite being told not to", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi
        .fn()
        .mockResolvedValue(mockChatResult('```json\n[{"prompt": "Q?", "questionType": "TRUE_FALSE", "correctAnswer": true}]\n```')),
    });

    await generateQuizForTopic({ userId: "user-1", topicId: "topic-1" });

    expect(db.quizQuestion.create).toHaveBeenCalledTimes(1);
  });

  it("lets a real AI provider failure propagate without creating anything", async () => {
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockRejectedValue(new Error("Gemini request failed (503): overloaded")),
    });

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow(
      "Gemini request failed"
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("does not let a usage-recording failure undo an already-successful generation", async () => {
    usageModule.recordAIUsage.mockRejectedValue(new Error("usage ledger down"));

    await expect(generateQuizForTopic({ userId: "user-1", topicId: "topic-1" })).rejects.toThrow("usage ledger down");
    // The quiz itself was already committed by this point — db.$transaction already resolved.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates NotAuthorizedError from scope resolution without ever calling the AI", async () => {
    access.getAccessibleAIScope.mockRejectedValue(new access.NotAuthorizedError());

    await expect(generateQuizForTopic({ userId: "user-2", topicId: "topic-1" })).rejects.toThrow(
      access.NotAuthorizedError
    );
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
  });
});
