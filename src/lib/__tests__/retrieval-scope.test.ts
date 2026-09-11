import { describe, expect, it } from "vitest";
import { materialWhereForScope } from "@/lib/retrieval-scope";
import type { ResolvedAIScope } from "@/lib/access";

const workspaceScope: ResolvedAIScope = {
  ownerType: "workspace",
  workspaceId: "cworkspace000000000000000000",
  groupId: null,
  subjectId: null,
  chapterId: null,
  topicId: null,
};

describe("materialWhereForScope", () => {
  const materials = [
    { id: "subject-material", subjectId: "subject-a", chapterId: null, topicId: null },
    { id: "chapter-a-material", subjectId: "subject-a", chapterId: "chapter-a", topicId: null },
    { id: "topic-a-material", subjectId: "subject-a", chapterId: "chapter-a", topicId: "topic-a" },
    { id: "chapter-b-material", subjectId: "subject-a", chapterId: "chapter-b", topicId: null },
    { id: "subject-b-material", subjectId: "subject-b", chapterId: null, topicId: null },
  ];

  function materialsMatching(where: { subjectId?: string; chapterId?: string }) {
    return materials
      .filter((material) =>
        Object.entries(where).every(([field, value]) => material[field as keyof typeof material] === value)
      )
      .map((material) => material.id);
  }

  it("Subject scope retrieves direct, chapter, and topic materials across the subject", () => {
    const where = materialWhereForScope({ ...workspaceScope, subjectId: "subject-a" });

    expect(materialsMatching(where)).toEqual([
      "subject-material",
      "chapter-a-material",
      "topic-a-material",
      "chapter-b-material",
    ]);
    expect(materialsMatching(where)).not.toContain("subject-b-material");
  });

  it("Chapter scope retrieves direct chapter and topic materials only", () => {
    const where = materialWhereForScope({
      ...workspaceScope,
      subjectId: "subject-a",
      chapterId: "chapter-a",
    });

    expect(materialsMatching(where)).toEqual(["chapter-a-material", "topic-a-material"]);
    expect(materialsMatching(where)).not.toContain("chapter-b-material");
    expect(materialsMatching(where)).not.toContain("subject-material");
    expect(materialsMatching(where)).not.toContain("subject-b-material");
  });

  it("Subject scope: filters to exactly that subject, and nothing else", () => {
    const scope: ResolvedAIScope = { ...workspaceScope, subjectId: "csubject000000000000000000a" };
    expect(materialWhereForScope(scope)).toEqual({ subjectId: "csubject000000000000000000a" });
  });

  it("Chapter scope: filters to exactly that chapter, not its subject or sibling chapters", () => {
    const scope: ResolvedAIScope = {
      ...workspaceScope,
      subjectId: "csubject000000000000000000a",
      chapterId: "cchapter000000000000000000a",
    };
    const where = materialWhereForScope(scope);
    expect(where).toEqual({ chapterId: "cchapter000000000000000000a" });
    // Explicitly not the subject-level filter — a chapter-scoped question
    // must not widen out to every material in the subject.
    expect(where).not.toHaveProperty("subjectId");
  });

  it("Topic scope takes precedence over chapter/subject when all three are present", () => {
    const scope: ResolvedAIScope = {
      ...workspaceScope,
      subjectId: "csubject000000000000000000a",
      chapterId: "cchapter000000000000000000a",
      topicId: "ctopic0000000000000000000a",
    };
    expect(materialWhereForScope(scope)).toEqual({ topicId: "ctopic0000000000000000000a" });
  });

  it("Chapter scope takes precedence over subject when both are present but no topic", () => {
    const scope: ResolvedAIScope = {
      ...workspaceScope,
      subjectId: "csubject000000000000000000a",
      chapterId: "cchapter000000000000000000a",
      topicId: null,
    };
    expect(materialWhereForScope(scope)).toEqual({ chapterId: "cchapter000000000000000000a" });
  });

  it("a group-owned Subject/Chapter still filters by subjectId/chapterId, not groupId", () => {
    const scope: ResolvedAIScope = {
      ownerType: "group",
      workspaceId: null,
      groupId: "cgroup0000000000000000000a",
      subjectId: "csubject000000000000000000a",
      chapterId: "cchapter000000000000000000a",
      topicId: null,
    };
    expect(materialWhereForScope(scope)).toEqual({ chapterId: "cchapter000000000000000000a" });
  });

  it("bare group scope (no subject/chapter/topic) falls back to groupId", () => {
    const scope: ResolvedAIScope = {
      ownerType: "group",
      workspaceId: null,
      groupId: "cgroup0000000000000000000a",
      subjectId: null,
      chapterId: null,
      topicId: null,
    };
    expect(materialWhereForScope(scope)).toEqual({ groupId: "cgroup0000000000000000000a" });
  });

  it("workspace scope (no subject/chapter/topic/group) falls back to workspaceId", () => {
    expect(materialWhereForScope(workspaceScope)).toEqual({ workspaceId: "cworkspace000000000000000000" });
  });
});
