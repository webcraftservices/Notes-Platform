import { describe, expect, it, vi } from "vitest";

// materials-scope.ts imports lib/access.ts, which imports lib/db.ts (a real
// PrismaClient) — mock it out the same way materials-scope.test.ts does, so
// this file only needs the module identity, never a live client.
vi.mock("@/lib/access", () => ({
  getAccessibleSubject: vi.fn(),
  getAccessibleChapter: vi.fn(),
  getAccessibleTopic: vi.fn(),
}));

import { resolveLearningScope, ScopeNotFoundError as LearningScopeNotFoundError } from "@/lib/learning-scope";
import { resolveMaterialScope, ScopeNotFoundError } from "@/lib/materials-scope";

describe("Learning scope (Phase 8.1)", () => {
  it("resolveLearningScope IS resolveMaterialScope — no second resolver was introduced", () => {
    expect(resolveLearningScope).toBe(resolveMaterialScope);
  });

  it("re-exports the same ScopeNotFoundError class", () => {
    expect(LearningScopeNotFoundError).toBe(ScopeNotFoundError);
  });
});
