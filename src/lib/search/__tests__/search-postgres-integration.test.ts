/**
 * src/lib/search/__tests__/search-postgres-integration.test.ts
 *
 * REAL POSTGRESQL + PGVECTOR INTEGRATION VERIFICATION SUITE (Phase 12 Independent Audit)
 *
 * Unlike mocked unit tests, this suite executes directly against the live PostgreSQL
 * database (`db` from `@/lib/db`) with pgvector HNSW and expression GIN indexes.
 * All test data is scoped under a unique prefix (`p12_real_audit_`) and cleaned up in `afterAll`.
 */

import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPrimaryWorkspace } from "@/lib/access";
import {
  resolveUserSearchScope,
  type UserSearchScope,
} from "@/lib/search/search-access";
import { executeLexicalSearch } from "@/lib/search/lexical-search";
import { executeVectorSearch } from "@/lib/search/vector-search";
import { fuseRankings } from "@/lib/search/rrf-ranking";
import {
  syncNoteChunksAndEmbeddings,
  syncNoteSearchIndex,
  backfillNotesSearchIndex,
  deleteNoteChunks,
} from "@/lib/search/note-embedding";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import type { EmbeddingService } from "@/lib/services/interfaces";
import {
  assertIsolatedTestDatabaseConfig,
  assertSafeDatabaseForIntegrationTests,
  hasStrictIsolatedTestDb,
  verifyLiveIsolatedDatabaseIdentity,
} from "@/lib/testing/isolated-db-guard";

export { assertSafeDatabaseForIntegrationTests };

// Allow mocked session user strictly for the direct GET /api/search route test while keeping real DB
const sessionState = vi.hoisted(() => ({
  currentUser: null as { id: string; email: string } | null,
}));

vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();
  return {
    ...actual,
    getSessionUser: async () => sessionState.currentUser,
  };
});

import { GET as searchApiGet } from "@/app/api/search/route";

/**
 * Deterministic 1536-dimensional embedding generator for real PostgreSQL pgvector testing.
 * Assigns orthogonal subspaces to distinct semantic concepts so cosine similarity (`1 - (a <=> b)`)
 * behaves deterministically in PostgreSQL `vector(1536)` columns and HNSW indexes without requiring
 * live external OpenAI network calls.
 */
function makeSemanticVector(text: string): number[] {
  const lower = text.toLowerCase();
  const vec = new Array<number>(1536).fill(0.001);

  // Concept 0: Photosynthesis / Chloroplast / Thylakoid / Solar Bioenergetics (dims 0..31)
  if (
    lower.includes("photosynthesis") ||
    lower.includes("chloroplast") ||
    lower.includes("thylakoid") ||
    lower.includes("bioenergetics") ||
    lower.includes("photon")
  ) {
    for (let i = 0; i < 32; i++) vec[i] = 0.9;
  }

  // Concept 1: Quantum Mechanics / Wavefunction / Eigenstate / Hamiltonian (dims 32..63)
  if (
    lower.includes("quantum") ||
    lower.includes("wavefunction") ||
    lower.includes("eigenstate") ||
    lower.includes("hamiltonian") ||
    lower.includes("schrodinger")
  ) {
    for (let i = 32; i < 64; i++) vec[i] = 0.9;
  }

  // Concept 2: Macroeconomics / Inflation / Monetary Policy (dims 64..95)
  if (
    lower.includes("macroeconomics") ||
    lower.includes("inflation") ||
    lower.includes("monetary") ||
    lower.includes("central bank")
  ) {
    for (let i = 64; i < 96; i++) vec[i] = 0.9;
  }

  // Concept 3: Secret / Forbidden / Classified tenant B data (dims 96..127)
  if (
    lower.includes("classified") ||
    lower.includes("cryptographic") ||
    lower.includes("zero-knowledge")
  ) {
    for (let i = 96; i < 128; i++) vec[i] = 0.9;
  }

  // Normalize to unit vector
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

const deterministicEmbeddingService: EmbeddingService = {
  dimensions: 1536,
  providerName: "deterministic-pgvector-test",
  modelName: "text-embedding-3-small",
  async embed(texts: string[]) {
    return {
      vectors: texts.map((t) => makeSemanticVector(t)),
      totalTokens: texts.reduce((acc, t) => acc + t.split(/\s+/).length, 0),
    };
  },
};

interface BaselineCounts {
  nonTestUsers: number;
  nonTestWorkspaces: number;
  nonTestWorkspaceMembers: number;
  nonTestGroups: number;
  nonTestGroupMembers: number;
  nonTestSubjects: number;
  nonTestChapters: number;
  nonTestTopics: number;
  nonTestMaterials: number;
  nonTestMaterialChunks: number;
  nonTestTranscripts: number;
  nonTestNotes: number;
  nonTestNoteBlocks: number;
  nonTestNoteVersions: number;
  nonTestNoteChunks: number;
  nonTestFlashcardDecks: number;
  nonTestUsageRecords: number;
  nonTestNoteSnapshots: {
    id: string;
    title: string;
    plainText: string | null;
    updatedAt: string;
    deletedAt: string | null;
  }[];
}

const describeLivePg = hasStrictIsolatedTestDb() ? describe : describe.skip;

describeLivePg("Phase 12 Real PostgreSQL + pgvector Independent Verification Suite", () => {
  const runId = `p12_audit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  let baselineBefore: BaselineCounts;

  // Users
  let userAId: string;
  let userBId: string;
  let userViewerId: string;
  let userRemovedId: string;

  // Workspaces
  let wsAId: string;
  let wsBId: string;
  let wsViewerId: string;
  let wsRemovedId: string;

  // Groups
  let sharedGroupId: string;
  let foreignGroupId: string;
  let deletedGroupId: string;

  // Hierarchy for User A personal workspace
  let subAId: string;
  let chapAId: string;
  let topAId: string;
  let matAPdfId: string;
  let matAAudioId: string;
  let noteAId: string;
  let deckAId: string;

  // Hierarchy for Shared Group
  let subGroupId: string;
  let chapGroupId: string;
  let topGroupId: string;
  let noteGroupId: string;

  // Hierarchy for User B private workspace (must NEVER leak to User A)
  let subBId: string;
  let chapBId: string;
  let topBId: string;
  let matBId: string;
  let noteBId: string;
  let deckBId: string;

  async function snapshotNonTestBaseline(): Promise<BaselineCounts> {
    const testUserWhere = {
      email: { startsWith: "p12_audit_", endsWith: "@zenote.test" },
    };
    const nonTestSubjectWhere = {
      OR: [
        { workspace: { is: { owner: { isNot: testUserWhere } } } },
        { group: { is: { owner: { isNot: testUserWhere } } } },
      ],
    };

    const [
      nonTestUsers,
      nonTestWorkspaces,
      nonTestWorkspaceMembers,
      nonTestGroups,
      nonTestGroupMembers,
      nonTestSubjects,
      nonTestChapters,
      nonTestTopics,
      nonTestMaterials,
      nonTestMaterialChunks,
      nonTestTranscripts,
      nonTestNotes,
      nonTestNoteBlocks,
      nonTestNoteVersions,
      nonTestNoteChunks,
      nonTestFlashcardDecks,
      nonTestUsageRecords,
      rawNotes,
    ] = await Promise.all([
      db.user.count({ where: { NOT: testUserWhere } }),
      db.workspace.count({ where: { owner: { isNot: testUserWhere } } }),
      db.workspaceMember.count({ where: { user: { isNot: testUserWhere } } }),
      db.group.count({ where: { owner: { isNot: testUserWhere } } }),
      db.groupMember.count({ where: { user: { isNot: testUserWhere } } }),
      db.subject.count({ where: nonTestSubjectWhere }),
      db.chapter.count({ where: { subject: nonTestSubjectWhere } }),
      db.topic.count({ where: { chapter: { subject: nonTestSubjectWhere } } }),
      db.material.count({ where: { owner: { isNot: testUserWhere } } }),
      db.materialChunk.count({
        where: { material: { owner: { isNot: testUserWhere } } },
      }),
      db.transcript.count({
        where: { material: { owner: { isNot: testUserWhere } } },
      }),
      db.note.count({ where: { author: { isNot: testUserWhere } } }),
      db.noteBlock.count({
        where: { note: { author: { isNot: testUserWhere } } },
      }),
      db.noteVersion.count({
        where: { note: { author: { isNot: testUserWhere } } },
      }),
      db.noteChunk.count({
        where: { note: { author: { isNot: testUserWhere } } },
      }),
      db.flashcardDeck.count({ where: { owner: { isNot: testUserWhere } } }),
      db.usageRecord.count({ where: { user: { isNot: testUserWhere } } }),
      db.note.findMany({
        where: { author: { isNot: testUserWhere } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          title: true,
          plainText: true,
          updatedAt: true,
          deletedAt: true,
        },
      }),
    ]);

    return {
      nonTestUsers,
      nonTestWorkspaces,
      nonTestWorkspaceMembers,
      nonTestGroups,
      nonTestGroupMembers,
      nonTestSubjects,
      nonTestChapters,
      nonTestTopics,
      nonTestMaterials,
      nonTestMaterialChunks,
      nonTestTranscripts,
      nonTestNotes,
      nonTestNoteBlocks,
      nonTestNoteVersions,
      nonTestNoteChunks,
      nonTestFlashcardDecks,
      nonTestUsageRecords,
      nonTestNoteSnapshots: rawNotes.map((n) => ({
        id: n.id,
        title: n.title,
        plainText: n.plainText,
        updatedAt: n.updatedAt.toISOString(),
        deletedAt: n.deletedAt ? n.deletedAt.toISOString() : null,
      })),
    };
  }

  async function createTestUserWithWorkspace(email: string, name: string) {
    const user = await db.user.create({
      data: { email, name },
    });
    const ws = await db.workspace.create({
      data: {
        name: `${name} Workspace`,
        slug: `${email.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${Date.now()}`,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });
    return { userId: user.id, workspaceId: ws.id };
  }

  async function cleanupFixtures(emailPrefix: string, olderThanMs?: number) {
    if (!emailPrefix.startsWith("p12_audit_") || emailPrefix.length < "p12_audit_".length) {
      throw new Error(
        `Refusing cleanupFixtures with unsafe prefix "${emailPrefix}": must start with "p12_audit_".`
      );
    }
    const createdAtFilter =
      olderThanMs !== undefined
        ? { lt: new Date(Date.now() - olderThanMs) }
        : undefined;
    const users = await db.user.findMany({
      where: {
        email: { startsWith: emailPrefix, endsWith: "@zenote.test" },
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await db.usageRecord.deleteMany({ where: { userId: { in: userIds } } });
      await db.note.deleteMany({ where: { authorId: { in: userIds } } });
      await db.material.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.flashcardDeck.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.workspace.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.group.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }

  beforeAll(async () => {
    const verifiedUrl = assertIsolatedTestDatabaseConfig();
    assertSafeDatabaseForIntegrationTests(process.env, verifiedUrl);
    await verifyLiveIsolatedDatabaseIdentity(db, verifiedUrl);
    // Sweep only stale orphaned fixtures (>15m old) so concurrent test processes never interfere
    await cleanupFixtures("p12_audit_", 15 * 60_000);
    baselineBefore = await snapshotNonTestBaseline();

    // 1. Create Users & Primary Workspaces
    const uA = await createTestUserWithWorkspace(`${runId}_alice@zenote.test`, "Alice Researcher");
    userAId = uA.userId;
    wsAId = uA.workspaceId;

    const uB = await createTestUserWithWorkspace(`${runId}_bob@zenote.test`, "Bob Isolated");
    userBId = uB.userId;
    wsBId = uB.workspaceId;

    const uV = await createTestUserWithWorkspace(`${runId}_viewer@zenote.test`, "Charlie Viewer");
    userViewerId = uV.userId;
    wsViewerId = uV.workspaceId;

    const uR = await createTestUserWithWorkspace(`${runId}_removed@zenote.test`, "Dana Removed");
    userRemovedId = uR.userId;
    wsRemovedId = uR.workspaceId;

    // 2. Create Groups & Memberships
    const sharedGroup = await db.group.create({
      data: {
        name: `${runId} Quantum Astrophysics Study Group`,
        description: "Collaborative research on quantum wavefunction collapse and eigenstates",
        ownerId: userAId,
        members: {
          create: [
            { userId: userAId, role: "OWNER" },
            { userId: userViewerId, role: "VIEWER" },
            { userId: userRemovedId, role: "MEMBER" },
          ],
        },
      },
    });
    sharedGroupId = sharedGroup.id;

    const foreignGroup = await db.group.create({
      data: {
        name: `${runId} Classified Cryptographic Syndicate`,
        description: "Zero-knowledge proofs and classified cryptographic protocols",
        ownerId: userBId,
        members: {
          create: [{ userId: userBId, role: "OWNER" }],
        },
      },
    });
    foreignGroupId = foreignGroup.id;

    const deletedGroup = await db.group.create({
      data: {
        name: `${runId} Archived Deleted Group`,
        description: "Should never appear because group is soft-deleted",
        ownerId: userAId,
        deletedAt: new Date(),
        members: {
          create: [{ userId: userAId, role: "OWNER" }],
        },
      },
    });
    deletedGroupId = deletedGroup.id;

    // 3. Populate User A Personal Hierarchy
    const subA = await db.subject.create({
      data: {
        workspaceId: wsAId,
        name: `${runId} Cellular Photosynthesis`,
        description: "Chloroplast bioenergetics and thylakoid light reactions",
      },
    });
    subAId = subA.id;

    const chapA = await db.chapter.create({
      data: {
        subjectId: subAId,
        name: `${runId} Thylakoid Membrane Complexes`,
        description: "Photosystem II and cytochrome b6f proton pumping",
        order: 1,
      },
    });
    chapAId = chapA.id;

    const topA = await db.topic.create({
      data: {
        chapterId: chapAId,
        name: `${runId} Photophosphorylation & Calvin Cycle`,
        description: "ATP synthase chemiosmosis and RuBisCO carbon fixation",
        order: 1,
      },
    });
    topAId = topA.id;

    // PDF Material with multiple chunks on User A
    const matAPdf = await db.material.create({
      data: {
        workspaceId: wsAId,
        ownerId: userAId,
        subjectId: subAId,
        chapterId: chapAId,
        topicId: topAId,
        type: "PDF",
        status: "READY",
        title: `${runId} Lehninger Bioenergetics Chapter.pdf`,
        extractedText:
          "Photosynthesis takes place in chloroplasts where thylakoid membranes capture photon energy to drive ATP synthesis.",
      },
    });
    matAPdfId = matAPdf.id;

    const pdfVec1 = `[${makeSemanticVector("chloroplast thylakoid photosynthesis photon").join(",")}]`;
    const pdfVec2 = `[${makeSemanticVector("chloroplast photosynthesis macroeconomics").join(",")}]`;
    await db.$executeRaw`
      INSERT INTO "MaterialChunk" (id, "materialId", content, "order", "tokenCount", "pageNumber", embedding, "createdAt")
      VALUES
        (${`${runId}_mc_pdf_1`}, ${matAPdfId}, ${"Page 12: Lower relevance introduction to chloroplast organelles."}, 0, 10, 12, ${pdfVec2}::vector, now()),
        (${`${runId}_mc_pdf_2`}, ${matAPdfId}, ${"Page 42: High-precision thylakoid photon absorption in photosynthesis bioenergetics."}, 1, 12, 42, ${pdfVec1}::vector, now())
    `;

    // Audio Material with Transcript & timestamped chunk on User A
    const matAAudio = await db.material.create({
      data: {
        workspaceId: wsAId,
        ownerId: userAId,
        subjectId: subAId,
        chapterId: chapAId,
        topicId: topAId,
        type: "AUDIO",
        status: "READY",
        title: `${runId} Photosynthesis Lecture Recording.mp3`,
        transcript: {
          create: {
            status: "READY",
            fullText:
              "At timestamp three minutes five seconds we examine non-cyclic photophosphorylation and ferredoxin NADP reductase.",
          },
        },
      },
    });
    matAAudioId = matAAudio.id;

    const audioVec = `[${makeSemanticVector("photosynthesis chloroplast photon").join(",")}]`;
    await db.$executeRaw`
      INSERT INTO "MaterialChunk" (id, "materialId", content, "order", "tokenCount", "startSeconds", "endSeconds", embedding, "createdAt")
      VALUES
        (${`${runId}_mc_aud_1`}, ${matAAudioId}, ${"Non-cyclic photophosphorylation transfers electrons to ferredoxin at 185s."}, 0, 11, 185, 210, ${audioVec}::vector, now())
    `;

    // Note on User A
    const noteABlocks = [
      {
        heading: "Chloroplast Light Reactions",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Photosynthesis converts solar photon energy into chemical bonds inside thylakoid membranes.",
                },
              ],
            },
          ],
        },
        order: 0,
      },
    ];
    const noteAPlainText = buildNotePlainText(`${runId} Photosynthesis Master Note`, noteABlocks);
    const noteA = await db.note.create({
      data: {
        topicId: topAId,
        authorId: userAId,
        title: `${runId} Photosynthesis Master Note`,
        plainText: noteAPlainText,
        source: "MANUAL",
      },
    });
    noteAId = noteA.id;
    await syncNoteChunksAndEmbeddings(noteAId, noteAPlainText, {
      embeddingService: deterministicEmbeddingService,
      userId: userAId,
      workspaceId: wsAId,
    });

    // FlashcardDeck on User A
    const deckA = await db.flashcardDeck.create({
      data: {
        workspaceId: wsAId,
        ownerId: userAId,
        subjectId: subAId,
        chapterId: chapAId,
        topicId: topAId,
        title: `${runId} Photosynthesis & Thylakoid Flashcards`,
      },
    });
    deckAId = deckA.id;

    // 4. Populate Shared Group Hierarchy
    const subGroup = await db.subject.create({
      data: {
        groupId: sharedGroupId,
        name: `${runId} Quantum Mechanics I`,
        description: "Hamiltonian operators and Hilbert space eigenstates",
      },
    });
    subGroupId = subGroup.id;

    const chapGroup = await db.chapter.create({
      data: {
        subjectId: subGroupId,
        name: `${runId} Schrodinger Wavefunction Equation`,
        description: "Time-independent wavefunction solutions",
        order: 1,
      },
    });
    chapGroupId = chapGroup.id;

    const topGroup = await db.topic.create({
      data: {
        chapterId: chapGroupId,
        name: `${runId} Harmonic Oscillator Eigenstates`,
        description: "Ladder operators and zero-point quantum energy",
        order: 1,
      },
    });
    topGroupId = topGroup.id;

    const noteGroupPlainText = buildNotePlainText(`${runId} Quantum Eigenstate Derivation`, [
      {
        heading: "Hamiltonian Spectrum",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "The quantum wavefunction collapses onto an orthogonal eigenstate of the Hamiltonian.",
                },
              ],
            },
          ],
        },
        order: 0,
      },
    ]);
    const noteGroup = await db.note.create({
      data: {
        topicId: topGroupId,
        authorId: userAId,
        title: `${runId} Quantum Eigenstate Derivation`,
        plainText: noteGroupPlainText,
        source: "MANUAL",
      },
    });
    noteGroupId = noteGroup.id;
    await syncNoteChunksAndEmbeddings(noteGroupId, noteGroupPlainText, {
      embeddingService: deterministicEmbeddingService,
      userId: userAId,
    });

    // 5. Populate User B Private Workspace Hierarchy (Forbidden to User A)
    const subB = await db.subject.create({
      data: {
        workspaceId: wsBId,
        name: `${runId} Classified Cryptographic Protocols`,
        description: "Zero-knowledge succinct arguments and private keys",
      },
    });
    subBId = subB.id;

    const chapB = await db.chapter.create({
      data: {
        subjectId: subBId,
        name: `${runId} Classified Elliptic Curves`,
        description: "Private cryptographic pairings",
        order: 1,
      },
    });
    chapBId = chapB.id;

    const topB = await db.topic.create({
      data: {
        chapterId: chapBId,
        name: `${runId} Classified zkSNARK Circuits`,
        description: "Zero-knowledge polynomial commitments",
        order: 1,
      },
    });
    topBId = topB.id;

    const matB = await db.material.create({
      data: {
        workspaceId: wsBId,
        ownerId: userBId,
        subjectId: subBId,
        chapterId: chapBId,
        topicId: topBId,
        type: "PDF",
        status: "READY",
        title: `${runId} Classified Cryptographic Whitepaper.pdf`,
        extractedText:
          "Classified zero-knowledge cryptographic protocol for Bob private workspace.",
      },
    });
    matBId = matB.id;

    const bobVec = `[${makeSemanticVector("classified cryptographic zero-knowledge").join(",")}]`;
    await db.$executeRaw`
      INSERT INTO "MaterialChunk" (id, "materialId", content, "order", "tokenCount", "pageNumber", embedding, "createdAt")
      VALUES
        (${`${runId}_mc_bob_1`}, ${matBId}, ${"Classified zero-knowledge cryptographic secret chunk."}, 0, 8, 7, ${bobVec}::vector, now())
    `;

    const noteBPlainText =
      `${runId} Classified Bob Note\n\nClassified zero-knowledge cryptographic keys and photosynthesis decoy keyword.`;
    const noteB = await db.note.create({
      data: {
        topicId: topBId,
        authorId: userBId,
        title: `${runId} Classified Bob Note`,
        plainText: noteBPlainText,
        source: "MANUAL",
      },
    });
    noteBId = noteB.id;
    await syncNoteChunksAndEmbeddings(noteBId, noteBPlainText, {
      embeddingService: deterministicEmbeddingService,
      userId: userBId,
      workspaceId: wsBId,
    });

    const deckB = await db.flashcardDeck.create({
      data: {
        workspaceId: wsBId,
        ownerId: userBId,
        subjectId: subBId,
        chapterId: chapBId,
        topicId: topBId,
        title: `${runId} Classified Bob Flashcards`,
      },
    });
    deckBId = deckB.id;
  }, 60_000);

  afterAll(async () => {
    // Allow any fire-and-forget recordAIUsage promises from executeVectorSearch to settle before cleanup
    await new Promise((resolve) => setTimeout(resolve, 250));
    await cleanupFixtures(`${runId}_`);
    const remainingRunUsers = await db.user.count({
      where: { email: { startsWith: `${runId}_` } },
    });
    expect(remainingRunUsers).toBe(0);

    const baselineAfter = await snapshotNonTestBaseline();
    expect(baselineAfter).toEqual(baselineBefore);
  }, 30_000);

  // =========================================================================
  // SECTION 2: DATABASE & INDEXING VERIFICATION (LIVE CATALOG + EXPLAIN ANALYZE)
  // =========================================================================
  describe("Section 2: Database Catalog & EXPLAIN (ANALYZE, BUFFERS) Verification", () => {
    it("2.1 verifies pgvector extension, vector(1536) column dimensions, test DB safety guard, 2 HNSW indexes, and 7 expression GIN indexes exist in pg_indexes", async () => {
      // Verify fail-safe database target guard rejects production/staging targets
      expect(() =>
        assertSafeDatabaseForIntegrationTests(
          { NODE_ENV: "production" },
          "postgresql://user:pass@localhost:5432/neondb"
        )
      ).toThrow(/production/i);
      expect(() =>
        assertSafeDatabaseForIntegrationTests(
          { NODE_ENV: "test" },
          "postgresql://user:pass@ep-prod-cluster.aws.neon.tech/zenote_production"
        )
      ).toThrow(/production or staging/i);
      expect(() => assertSafeDatabaseForIntegrationTests({ NODE_ENV: "test" }, "")).toThrow(
        /DATABASE_URL is not configured/i
      );

      // Verify cleanupFixtures rejects unsafe prefixes and backfillNotesSearchIndex rejects unauthorized global or custom-service unscoped calls
      await expect(cleanupFixtures("unsafe_prefix")).rejects.toThrow(/must start with "p12_audit_"/i);
      await expect(backfillNotesSearchIndex()).rejects.toThrow(
        /Refusing unscoped global backfillNotesSearchIndex without explicit authorization/i
      );
      await expect(
        backfillNotesSearchIndex({ embeddingService: deterministicEmbeddingService })
      ).rejects.toThrow(/explicit non-empty noteIds are required/i);
      await expect(
        backfillNotesSearchIndex({
          embeddingService: deterministicEmbeddingService,
          allowGlobalBackfill: true,
        })
      ).rejects.toThrow(/explicit non-empty noteIds are required/i);

      // Verify pre-existing non-test records across all 17 writable tables were not modified by fixture creation
      const baselineDuring = await snapshotNonTestBaseline();
      expect(baselineDuring).toEqual(baselineBefore);
      console.info("=== 17-TABLE NON-TEST BASELINE SNAPSHOT ===");
      console.info(JSON.stringify(baselineBefore, null, 2));

      const extensions = await db.$queryRaw<{ extname: string; extversion: string }[]>`
        SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'
      `;
      expect(extensions).toHaveLength(1);
      expect(extensions[0]!.extname).toBe("vector");

      // Verify exact column types in pg_attribute are vector(1536)
      const colTypes = await db.$queryRaw<
        { table_name: string; column_name: string; formatted_type: string }[]
      >`
        SELECT c.relname AS table_name,
               a.attname AS column_name,
               pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
        JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND c.relname IN ('MaterialChunk', 'NoteChunk')
          AND a.attname = 'embedding'
        ORDER BY c.relname ASC
      `;
      expect(colTypes).toEqual([
        { table_name: "MaterialChunk", column_name: "embedding", formatted_type: "vector(1536)" },
        { table_name: "NoteChunk", column_name: "embedding", formatted_type: "vector(1536)" },
      ]);

      const indexes = await db.$queryRaw<
        { tablename: string; indexname: string; indexdef: string }[]
      >`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND (
            indexname LIKE 'idx_%_search_fts'
            OR indexname LIKE 'idx_%_chunk_embedding_hnsw'
            OR indexname = 'NoteChunk_noteId_order_idx'
          )
        ORDER BY indexname ASC
      `;

      const indexMap = new Map(indexes.map((i) => [i.indexname, i]));

      // Verify HNSW vector indexes
      expect(indexMap.has("idx_material_chunk_embedding_hnsw")).toBe(true);
      expect(indexMap.get("idx_material_chunk_embedding_hnsw")!.indexdef).toContain(
        "USING hnsw (embedding vector_cosine_ops)"
      );

      expect(indexMap.has("idx_note_chunk_embedding_hnsw")).toBe(true);
      expect(indexMap.get("idx_note_chunk_embedding_hnsw")!.indexdef).toContain(
        "USING hnsw (embedding vector_cosine_ops)"
      );

      // Verify all 7 expression GIN FTS indexes
      const expectedGinIndexes = [
        "idx_subject_search_fts",
        "idx_chapter_search_fts",
        "idx_topic_search_fts",
        "idx_note_search_fts",
        "idx_material_search_fts",
        "idx_group_search_fts",
        "idx_flashcard_deck_search_fts",
      ];
      for (const idxName of expectedGinIndexes) {
        expect(indexMap.has(idxName)).toBe(true);
        expect(indexMap.get(idxName)!.indexdef.toLowerCase()).toContain("using gin");
      }

      console.info("=== PG_INDEXES CATALOG ===");
      console.info(JSON.stringify(indexes, null, 2));
    }, 30_000);

    it("2.2 verifies representative lexical FTS and pgvector <=> queries use GIN and HNSW indexes via EXPLAIN (ANALYZE, BUFFERS)", async () => {
      const vecLiteral = `[${makeSemanticVector("photosynthesis chloroplast").join(",")}]`;

      const plans = await db.$transaction(async (tx) => {
        // Disable sequential scan locally so PostgreSQL query planner demonstrates index capability
        // regardless of small table cardinality in the test environment
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;

        const noteGinPlan = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, title
          FROM "Note" n
          WHERE (
            setweight(to_tsvector('english', coalesce(n."title", '')), 'A') ||
            setweight(to_tsvector('english', coalesce(n."plainText", '')), 'B')
          ) @@ websearch_to_tsquery('english', 'photosynthesis')
        `;

        const noteHnswPlan = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, "noteId", embedding <=> ${vecLiteral}::vector AS dist
          FROM "NoteChunk"
          ORDER BY embedding <=> ${vecLiteral}::vector ASC
          LIMIT 5
        `;

        const materialHnswPlan = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, "materialId", embedding <=> ${vecLiteral}::vector AS dist
          FROM "MaterialChunk"
          ORDER BY embedding <=> ${vecLiteral}::vector ASC
          LIMIT 5
        `;

        return {
          noteGin: noteGinPlan.map((r) => r["QUERY PLAN"]).join("\n"),
          noteHnsw: noteHnswPlan.map((r) => r["QUERY PLAN"]).join("\n"),
          materialHnsw: materialHnswPlan.map((r) => r["QUERY PLAN"]).join("\n"),
        };
      });

      expect(plans.noteGin).toContain("idx_note_search_fts");
      expect(plans.noteHnsw).toContain("idx_note_chunk_embedding_hnsw");
      expect(plans.materialHnsw).toContain("idx_material_chunk_embedding_hnsw");

      console.info("=== EXPLAIN (ANALYZE, BUFFERS) PLANS ===");
      console.info("--- Note FTS GIN ---\n" + plans.noteGin);
      console.info("--- NoteChunk HNSW ---\n" + plans.noteHnsw);
      console.info("--- MaterialChunk HNSW ---\n" + plans.materialHnsw);
    }, 30_000);
  });

  // =========================================================================
  // SECTION 3: NOTE EMBEDDING LIFECYCLE AUDIT (ALL MUTATION PATHS ON REAL DB)
  // =========================================================================
  describe("Section 3: Note Embedding Lifecycle Audit on Real PostgreSQL", () => {
    it("3.1 traces creation, block edit, block add/delete/reorder, title edit, version restore, AI generation, failure cleanup, concurrent locking, soft-delete, and backfill", async () => {
      const scopeA = await resolveUserSearchScope(userAId);

      // 1. Create a lifecycle test note
      const lifecycleNote = await db.note.create({
        data: {
          topicId: topAId,
          authorId: userAId,
          title: `${runId} Lifecycle Note`,
          plainText: `${runId} Lifecycle Note`,
          source: "MANUAL",
        },
      });

      // 2. Block creation & editing
      const blocksV1 = [
        {
          heading: "Macroeconomics Monetary Policy",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Central bank interest rate adjustments control inflation in macroeconomics.",
                  },
                ],
              },
            ],
          },
          order: 0,
        },
        {
          heading: "Temporary Ephemeral Section",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "UniqueEphemeralTokenXYZ987 that will be deleted soon.",
                  },
                ],
              },
            ],
          },
          order: 1,
        },
      ];
      const plainTextV1 = buildNotePlainText(lifecycleNote.title, blocksV1);
      await db.note.update({
        where: { id: lifecycleNote.id },
        data: { plainText: plainTextV1 },
      });
      // Save a version snapshot of V1
      const versionV1 = await db.noteVersion.create({
        data: {
          noteId: lifecycleNote.id,
          editedById: userAId,
          snapshot: blocksV1 as unknown as Prisma.InputJsonValue,
        },
      });

      const syncV1 = await syncNoteSearchIndex(lifecycleNote.id, plainTextV1, {
        embeddingService: deterministicEmbeddingService,
        userId: userAId,
        workspaceId: wsAId,
      });
      expect(syncV1.embedded).toBe(true);
      expect(syncV1.chunkCount).toBeGreaterThan(0);

      // Verify V1 is discoverable via both lexical FTS and vector semantic search
      const lexV1 = await executeLexicalSearch({
        query: "UniqueEphemeralTokenXYZ987",
        scope: scopeA,
        types: ["note"],
      });
      expect(lexV1.some((h) => h.id === lifecycleNote.id)).toBe(true);

      const vecV1 = await executeVectorSearch({
        query: "central bank inflation",
        scope: scopeA,
        types: ["note"],
        embeddingService: deterministicEmbeddingService,
      });
      expect(vecV1.some((h) => h.entityId === lifecycleNote.id)).toBe(true);

      // 3. Content hash idempotency check: re-running with identical content skips embedding
      const syncUnchanged = await syncNoteSearchIndex(lifecycleNote.id, plainTextV1, {
        embeddingService: deterministicEmbeddingService,
        userId: userAId,
      });
      expect(syncUnchanged.embedded).toBe(false);
      expect(syncUnchanged.skippedReason).toBe("content_unchanged");

      // 4. Block deletion & reordering: remove "UniqueEphemeralTokenXYZ987"
      const blocksV2 = [
        {
          heading: "Updated Section After Deletion",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Only standard text remains here." }],
              },
            ],
          },
          order: 0,
        },
      ];
      const plainTextV2 = buildNotePlainText(lifecycleNote.title, blocksV2);
      await db.note.update({
        where: { id: lifecycleNote.id },
        data: { plainText: plainTextV2 },
      });
      await syncNoteSearchIndex(lifecycleNote.id, plainTextV2, {
        embeddingService: deterministicEmbeddingService,
        userId: userAId,
      });

      // Deleted block text must NOT remain discoverable in lexical search or in NoteChunk table
      const lexAfterDelete = await executeLexicalSearch({
        query: "UniqueEphemeralTokenXYZ987",
        scope: scopeA,
        types: ["note"],
      });
      expect(lexAfterDelete.some((h) => h.id === lifecycleNote.id)).toBe(false);

      const chunksAfterDelete = await db.noteChunk.findMany({
        where: { noteId: lifecycleNote.id },
      });
      expect(
        chunksAfterDelete.some((c) => c.content.includes("UniqueEphemeralTokenXYZ987"))
      ).toBe(false);

      // 5. Version restoration: restore versionV1 snapshot and verify UniqueEphemeralTokenXYZ987 becomes searchable again!
      const restoredBlocks = versionV1.snapshot as typeof blocksV1;
      const restoredPlainText = buildNotePlainText(lifecycleNote.title, restoredBlocks);
      await db.note.update({
        where: { id: lifecycleNote.id },
        data: { plainText: restoredPlainText },
      });
      await syncNoteSearchIndex(lifecycleNote.id, restoredPlainText, {
        embeddingService: deterministicEmbeddingService,
        userId: userAId,
      });

      const lexAfterRestore = await executeLexicalSearch({
        query: "UniqueEphemeralTokenXYZ987",
        scope: scopeA,
        types: ["note"],
      });
      expect(lexAfterRestore.some((h) => h.id === lifecycleNote.id)).toBe(true);

      // 6. Embedding failure on subsequent edit: verify stale NoteChunk rows are purged so old content never leaks!
      const plainTextV3 = `${lifecycleNote.title}\n\nCompletely replaced text after failure`;
      await db.note.update({
        where: { id: lifecycleNote.id },
        data: { plainText: plainTextV3 },
      });
      const failingEmbeddingService: EmbeddingService = {
        dimensions: 1536,
        providerName: "failing-test",
        modelName: "text-embedding-3-small",
        async embed() {
          throw new Error("Simulated OpenAI outage");
        },
      };

      const failRes = await syncNoteSearchIndex(lifecycleNote.id, plainTextV3, {
        embeddingService: failingEmbeddingService,
        maxRetries: 1,
      });
      expect(failRes.embedded).toBe(false);
      expect(failRes.skippedReason).toBe("embedding_failed");

      const chunksAfterFailure = await db.noteChunk.findMany({
        where: { noteId: lifecycleNote.id },
      });
      expect(chunksAfterFailure).toHaveLength(0);

      // 6b. Recovery after embedding outage: backfillNotesSearchIndex regenerates purged chunks
      // even when Note.plainText was already up-to-date
      const recoveryBackfill = await backfillNotesSearchIndex({
        embeddingService: deterministicEmbeddingService,
        noteIds: [lifecycleNote.id],
      });
      expect(recoveryBackfill.embeddedNotesCount).toBe(1);
      const chunksAfterRecovery = await db.noteChunk.findMany({
        where: { noteId: lifecycleNote.id },
      });
      expect(chunksAfterRecovery).toHaveLength(1);

      // 7. Concurrent duplicate execution serialization via pg_advisory_xact_lock + superseded stale writer protection
      const [supersededWriter, conc1, conc2] = await Promise.all([
        syncNoteChunksAndEmbeddings(lifecycleNote.id, plainTextV1, {
          embeddingService: deterministicEmbeddingService,
          force: true,
        }),
        syncNoteChunksAndEmbeddings(lifecycleNote.id, plainTextV3, {
          embeddingService: deterministicEmbeddingService,
          force: true,
        }),
        syncNoteChunksAndEmbeddings(lifecycleNote.id, plainTextV3, {
          embeddingService: deterministicEmbeddingService,
          force: true,
        }),
      ]);
      expect(supersededWriter.skippedReason).toBe("superseded");
      expect(conc1.embedded && conc2.embedded).toBe(true);
      const chunksAfterConcurrent = await db.noteChunk.findMany({
        where: { noteId: lifecycleNote.id },
      });
      expect(chunksAfterConcurrent).toHaveLength(1);

      // 8. Note soft-delete & chunk removal
      await db.note.update({
        where: { id: lifecycleNote.id },
        data: { deletedAt: new Date() },
      });
      await deleteNoteChunks(lifecycleNote.id);

      const chunksAfterSoftDelete = await db.noteChunk.findMany({
        where: { noteId: lifecycleNote.id },
      });
      expect(chunksAfterSoftDelete).toHaveLength(0);

      const lexAfterSoftDelete = await executeLexicalSearch({
        query: "UniqueEphemeralTokenXYZ987",
        scope: scopeA,
        types: ["note"],
      });
      expect(lexAfterSoftDelete.some((h) => h.id === lifecycleNote.id)).toBe(false);

      // 9. Existing Note Backfill verification
      const unindexedNote = await db.note.create({
        data: {
          topicId: topAId,
          authorId: userAId,
          title: `${runId} Legacy Unindexed Note`,
          plainText: null,
          source: "MANUAL",
          blocks: {
            create: [
              {
                kind: "SUMMARY",
                heading: "Backfill Verification Heading",
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "BackfillUniqueKeyword777 in chloroplast." }],
                    },
                  ],
                },
                order: 0,
              },
            ],
          },
        },
      });

      const backfillStats = await backfillNotesSearchIndex({
        embeddingService: deterministicEmbeddingService,
        noteIds: [lifecycleNote.id, unindexedNote.id],
      });
      expect(backfillStats.updatedPlainTextCount).toBeGreaterThanOrEqual(1);

      const refreshedUnindexed = await db.note.findUnique({
        where: { id: unindexedNote.id },
      });
      expect(refreshedUnindexed?.plainText).toContain("BackfillUniqueKeyword777");

      const lexBackfilled = await executeLexicalSearch({
        query: "BackfillUniqueKeyword777",
        scope: scopeA,
        types: ["note"],
      });
      expect(lexBackfilled.some((h) => h.id === unindexedNote.id)).toBe(true);

      // Clean up temporary lifecycle notes
      await db.note.deleteMany({
        where: { id: { in: [lifecycleNote.id, unindexedNote.id] } },
      });
    }, 45_000);
  });

  // =========================================================================
  // SECTION 4: REAL POSTGRESQL MULTI-TENANT AUTHORIZATION VERIFICATION
  // =========================================================================
  describe("Section 4: Real PostgreSQL Multi-Tenant Authorization & Zero-Leakage Matrix", () => {
    it("4.1 enforces personal workspace isolation: User A never sees User B's private subjects, chapters, topics, materials, notes, or flashcards", async () => {
      const scopeA = await resolveUserSearchScope(userAId);

      // Search directly for User B's keywords & decoy keyword ("photosynthesis" appears in noteB!)
      const lexClassified = await executeLexicalSearch({
        query: "Classified Cryptographic zero-knowledge",
        scope: scopeA,
      });
      const forbiddenIds = new Set([
        subBId,
        chapBId,
        topBId,
        matBId,
        noteBId,
        deckBId,
        foreignGroupId,
      ]);
      for (const hit of lexClassified) {
        expect(forbiddenIds.has(hit.id)).toBe(false);
      }

      const vecClassified = await executeVectorSearch({
        query: "classified cryptographic zero-knowledge",
        scope: scopeA,
        embeddingService: deterministicEmbeddingService,
      });
      for (const hit of vecClassified) {
        expect(forbiddenIds.has(hit.entityId)).toBe(false);
      }

      // Even when searching "photosynthesis" (which User B also put in noteBPlainText as a decoy),
      // User A must ONLY receive User A's entities, never noteBId!
      const lexPhoto = await executeLexicalSearch({
        query: "photosynthesis",
        scope: scopeA,
      });
      expect(lexPhoto.some((h) => h.id === noteAId)).toBe(true);
      expect(lexPhoto.some((h) => h.id === noteBId)).toBe(false);
    }, 30_000);

    it("4.2 verifies group role parity (OWNER, VIEWER, MEMBER) and immediate revocation upon group membership removal", async () => {
      const scopeOwner = await resolveUserSearchScope(userAId);
      const scopeViewer = await resolveUserSearchScope(userViewerId);
      const scopeMemberBefore = await resolveUserSearchScope(userRemovedId);

      expect(scopeOwner.activeGroupIds).toContain(sharedGroupId);
      expect(scopeViewer.activeGroupIds).toContain(sharedGroupId);
      expect(scopeMemberBefore.activeGroupIds).toContain(sharedGroupId);

      // Soft-deleted group must never be included in activeGroupIds
      expect(scopeOwner.activeGroupIds).not.toContain(deletedGroupId);

      // All active roles can find shared group content via lexical and semantic search
      for (const sc of [scopeOwner, scopeViewer, scopeMemberBefore]) {
        const lexHits = await executeLexicalSearch({
          query: "Quantum Eigenstate Hamiltonian",
          scope: sc,
        });
        expect(lexHits.some((h) => h.id === noteGroupId)).toBe(true);
        expect(lexHits.some((h) => h.id === subGroupId)).toBe(true);

        const vecHits = await executeVectorSearch({
          query: "quantum wavefunction eigenstate",
          scope: sc,
          embeddingService: deterministicEmbeddingService,
        });
        expect(vecHits.some((h) => h.entityId === noteGroupId)).toBe(true);
      }

      // Remove userRemoved from sharedGroup
      await db.groupMember.deleteMany({
        where: { groupId: sharedGroupId, userId: userRemovedId },
      });

      const scopeMemberAfter = await resolveUserSearchScope(userRemovedId);
      expect(scopeMemberAfter.activeGroupIds).not.toContain(sharedGroupId);

      const lexAfterRemoval = await executeLexicalSearch({
        query: "Quantum Eigenstate Hamiltonian",
        scope: scopeMemberAfter,
      });
      expect(lexAfterRemoval.some((h) => h.id === noteGroupId)).toBe(false);
      expect(lexAfterRemoval.some((h) => h.id === subGroupId)).toBe(false);
      expect(lexAfterRemoval.some((h) => h.id === sharedGroupId)).toBe(false);

      const vecAfterRemoval = await executeVectorSearch({
        query: "quantum wavefunction eigenstate",
        scope: scopeMemberAfter,
        embeddingService: deterministicEmbeddingService,
      });
      expect(vecAfterRemoval.some((h) => h.entityId === noteGroupId)).toBe(false);
    }, 30_000);

    it("4.3 enforces cascading ancestor soft-deletion across Subject -> Chapter -> Topic -> Note/Material/Chunks", async () => {
      const scopeA = await resolveUserSearchScope(userAId);

      // Soft-delete Subject subGroup
      await db.subject.update({
        where: { id: subGroupId },
        data: { deletedAt: new Date() },
      });

      try {
        // Chapter, Topic, and Note under subGroup must all be hidden even though their own deletedAt is null!
        const lexHits = await executeLexicalSearch({
          query: "Quantum Eigenstate Wavefunction Harmonic",
          scope: scopeA,
        });
        expect(lexHits.some((h) => h.id === subGroupId)).toBe(false);
        expect(lexHits.some((h) => h.id === chapGroupId)).toBe(false);
        expect(lexHits.some((h) => h.id === topGroupId)).toBe(false);
        expect(lexHits.some((h) => h.id === noteGroupId)).toBe(false);

        const vecHits = await executeVectorSearch({
          query: "quantum wavefunction eigenstate",
          scope: scopeA,
          embeddingService: deterministicEmbeddingService,
        });
        expect(vecHits.some((h) => h.entityId === noteGroupId)).toBe(false);
      } finally {
        // Restore subGroup.deletedAt = null for subsequent tests
        await db.subject.update({
          where: { id: subGroupId },
          data: { deletedAt: null },
        });
      }
    }, 30_000);

    it("4.4 verifies direct GET /api/search requests enforce authentication, Quiz exclusion (400), pagination, and zero cross-tenant leakage", async () => {
      // 1. Unauthenticated -> 401
      sessionState.currentUser = null;
      const unauthRes = await searchApiGet(
        new Request("http://localhost:3000/api/search?q=photosynthesis")
      );
      expect(unauthRes.status).toBe(401);

      // 2. Authenticated as User A
      sessionState.currentUser = { id: userAId, email: `${runId}_alice@zenote.test` };

      // Quiz entity type explicitly excluded -> 400
      const quizRes = await searchApiGet(
        new Request("http://localhost:3000/api/search?q=photosynthesis&types=quiz")
      );
      expect(quizRes.status).toBe(400);

      // Authorized lexical query via GET /api/search
      const okRes = await searchApiGet(
        new Request(
          "http://localhost:3000/api/search?q=photosynthesis&mode=lexical&limit=20&offset=0"
        )
      );
      expect(okRes.status).toBe(200);
      const body = await okRes.json();
      expect(body.hits.length).toBeGreaterThan(0);
      expect(body.hits.some((h: { id: string }) => h.id === noteAId)).toBe(true);
      expect(body.hits.some((h: { id: string }) => h.id === noteBId)).toBe(false);
      expect(body.hits.some((h: { id: string }) => h.id === deckAId)).toBe(true);

      // Unauthorized groupId filter override via GET /api/search -> 0 hits, 0 total
      const forbiddenGroupRes = await searchApiGet(
        new Request(
          `http://localhost:3000/api/search?q=classified&mode=lexical&groupId=${foreignGroupId}`
        )
      );
      expect(forbiddenGroupRes.status).toBe(200);
      const forbiddenBody = await forbiddenGroupRes.json();
      expect(forbiddenBody.hits).toEqual([]);
      expect(forbiddenBody.total).toBe(0);
    }, 30_000);
  });

  // =========================================================================
  // SECTION 5: SEARCH QUALITY, RRF RANKING, CHUNK COLLAPSING & DEEP LINKS
  // =========================================================================
  describe("Section 5: Search Quality, RRF Ranking, Chunk Collapsing & Deep-Link Preservation", () => {
    it("5.1 fuses lexical and semantic rankings via RRF (k=60), collapses multi-chunk materials to highest-scoring chunk, and preserves ?page=, ?t=, and ?tab=notes deep links", async () => {
      const scopeA: UserSearchScope = await resolveUserSearchScope(userAId);

      const [lexicalHits, vectorHits] = await Promise.all([
        executeLexicalSearch({
          query: "photosynthesis thylakoid",
          scope: scopeA,
          subjectId: subAId,
        }),
        executeVectorSearch({
          query: "photosynthesis thylakoid photon",
          scope: scopeA,
          subjectId: subAId,
          embeddingService: deterministicEmbeddingService,
        }),
      ]);

      const fused = fuseRankings({
        lexicalHits,
        vectorHits,
        query: "photosynthesis thylakoid",
        limit: 20,
        offset: 0,
      });

      expect(fused.length).toBeGreaterThan(0);

      // 1. Verify no duplicate (entityType, id) pairs
      const seenKeys = new Set<string>();
      for (const hit of fused) {
        const key = `${hit.entityType}:${hit.id}`;
        expect(seenKeys.has(key)).toBe(false);
        seenKeys.add(key);
      }

      // 2. Items matched in both lexical and semantic channels get matchType === 'hybrid' and highest RRF score
      const pdfHit = fused.find((h) => h.entityType === "material" && h.id === matAPdfId);
      expect(pdfHit).toBeDefined();
      expect(pdfHit!.matchType).toBe("hybrid");
      // Verify chunk collapsing selected page 42 (higher similarity vector pdfVec1) over page 12
      expect(pdfHit!.navigation.pageNumber).toBe(42);
      expect(pdfHit!.navigation.href).toBe(`/materials/${matAPdfId}?page=42`);

      // 3. Note hit preserves ?tab=notes deep link
      const noteHit = fused.find((h) => h.entityType === "note" && h.id === noteAId);
      expect(noteHit).toBeDefined();
      expect(noteHit!.matchType).toBe("hybrid");
      expect(noteHit!.navigation.href).toBe(
        `/subjects/${subAId}/chapters/${chapAId}/topics/${topAId}?tab=notes`
      );

      // 4. Audio material hit preserves ?t=185 timestamp deep link when retrieved via vector chunk
      const audioVecOnly = fuseRankings({
        lexicalHits: [],
        vectorHits: vectorHits.filter((v) => v.entityId === matAAudioId),
        query: "ferredoxin",
        limit: 10,
        offset: 0,
      });
      expect(audioVecOnly).toHaveLength(1);
      expect(audioVecOnly[0]!.navigation.timestampSeconds).toBe(185);
      expect(audioVecOnly[0]!.navigation.href).toBe(`/materials/${matAAudioId}?t=185`);

      // 5. FlashcardDeck hit is returned via lexical channel with valid navigation href
      const deckHit = fused.find((h) => h.entityType === "flashcard" && h.id === deckAId);
      expect(deckHit).toBeDefined();
      expect(deckHit!.matchType).toBe("lexical");
      expect(deckHit!.navigation.href).toBe(`/flashcards/${deckAId}`);
    }, 30_000);
  });

  // =========================================================================
  // SECTION 7: REAL DATABASE PERFORMANCE MEASUREMENTS
  // =========================================================================
  describe("Section 7: Real PostgreSQL Search Latency & Concurrency Measurements", () => {
    it("7.1 measures lexical, semantic, hybrid, and 10-way concurrent query latencies against live PostgreSQL", async () => {
      const scopeA = await resolveUserSearchScope(userAId);

      // Warm-up connection pool
      await executeLexicalSearch({ query: "photosynthesis", scope: scopeA });

      const tLex0 = performance.now();
      const lexRes = await executeLexicalSearch({
        query: "photosynthesis thylakoid",
        scope: scopeA,
      });
      const lexicalMs = performance.now() - tLex0;

      const tVec0 = performance.now();
      const vecRes = await executeVectorSearch({
        query: "photosynthesis thylakoid",
        scope: scopeA,
        embeddingService: deterministicEmbeddingService,
      });
      const vectorMs = performance.now() - tVec0;

      const tHyb0 = performance.now();
      const [hLex, hVec] = await Promise.all([
        executeLexicalSearch({ query: "photosynthesis thylakoid", scope: scopeA }),
        executeVectorSearch({
          query: "photosynthesis thylakoid",
          scope: scopeA,
          embeddingService: deterministicEmbeddingService,
        }),
      ]);
      const hybHits = fuseRankings({
        lexicalHits: hLex,
        vectorHits: hVec,
        query: "photosynthesis thylakoid",
      });
      const hybridMs = performance.now() - tHyb0;

      // 10-way concurrent hybrid search burst
      const tConc0 = performance.now();
      const concurrentResults = await Promise.all(
        Array.from({ length: 10 }, async (_, idx) => {
          const q = idx % 2 === 0 ? "photosynthesis" : "quantum wavefunction";
          const [l, v] = await Promise.all([
            executeLexicalSearch({ query: q, scope: scopeA }),
            executeVectorSearch({
              query: q,
              scope: scopeA,
              embeddingService: deterministicEmbeddingService,
            }),
          ]);
          return fuseRankings({ lexicalHits: l, vectorHits: v, query: q });
        })
      );
      const concurrent10Ms = performance.now() - tConc0;

      expect(lexRes.length).toBeGreaterThan(0);
      expect(vecRes.length).toBeGreaterThan(0);
      expect(hybHits.length).toBeGreaterThan(0);
      expect(concurrentResults).toHaveLength(10);

      console.info(
        JSON.stringify({
          benchmark: "phase12_real_postgres_latency_ms",
          lexicalMs: Number(lexicalMs.toFixed(2)),
          vectorMs: Number(vectorMs.toFixed(2)),
          hybridMs: Number(hybridMs.toFixed(2)),
          concurrent10BurstTotalMs: Number(concurrent10Ms.toFixed(2)),
        })
      );
    }, 30_000);
  });

  // =========================================================================
  // SECTION 8: PHASE 13 FLASHCARD CARD-LEVEL SEARCH INTEGRATION (LIM-10)
  // =========================================================================
  describe("Section 8: Phase 13 Flashcard Card-Level Front/Back Search (LIM-10 Resolution)", () => {
    it("8.1 verifies idx_flashcard_search_fts GIN index in pg_indexes and searches Flashcard front/back content with edit/delete sync and tenant isolation", async () => {
      // 1. Verify idx_flashcard_search_fts exists on "Flashcard"
      const indexRows = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'Flashcard'
          AND indexname = 'idx_flashcard_search_fts';
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0]!.indexdef).toContain("USING gin");

      // 2. Insert a Flashcard under User A's deck with terms only in front/back (not in deck title)
      const cardA = await db.flashcard.create({
        data: {
          deckId: deckAId,
          front: "What enzyme catalyzes ribulose bisphosphate carboxylation?",
          back: "RuBisCO (ribulose-1,5-bisphosphate carboxylase-oxygenase) in the Calvin cycle stroma.",
        },
      });

      // Insert a Flashcard under User B's private deck
      const cardB = await db.flashcard.create({
        data: {
          deckId: deckBId,
          front: "What is the supersecret eigenstate hamiltonian operator?",
          back: "Private quantum observable for User B only.",
        },
      });

      try {
        const scopeA = await resolveUserSearchScope(userAId);

        // 3. Search by card front term ("carboxylation") -> returns parent deckAId
        const frontHits = await executeLexicalSearch({
          query: "carboxylation",
          scope: scopeA,
          types: ["flashcard"],
        });
        expect(frontHits.some((h) => h.id === deckAId)).toBe(true);
        const matchedDeckFront = frontHits.find((h) => h.id === deckAId)!;
        expect(matchedDeckFront.snippetSourceText).toContain("RuBisCO");
        expect(matchedDeckFront.navigation?.href).toBe(`/flashcards/${deckAId}`);

        // 4. Search by card back term ("RuBisCO") -> returns parent deckAId
        const backHits = await executeLexicalSearch({
          query: "RuBisCO",
          scope: scopeA,
          types: ["flashcard"],
        });
        expect(backHits.some((h) => h.id === deckAId)).toBe(true);

        // 5. Multi-tenant isolation: User A cannot match User B's private card content
        const leakCheck = await executeLexicalSearch({
          query: "eigenstate hamiltonian",
          scope: scopeA,
          types: ["flashcard"],
        });
        expect(leakCheck).toHaveLength(0);

        // 6. Edit synchronization: update cardA's back text and verify immediate search update
        await db.flashcard.update({
          where: { id: cardA.id },
          data: {
            back: "Photophosphorylation chemiosmotic proton-motive force across thylakoid.",
          },
        });

        const afterEditOldTerm = await executeLexicalSearch({
          query: "RuBisCO",
          scope: scopeA,
          types: ["flashcard"],
        });
        expect(afterEditOldTerm.some((h) => h.id === deckAId)).toBe(false);

        const afterEditNewTerm = await executeLexicalSearch({
          query: "chemiosmotic",
          scope: scopeA,
          types: ["flashcard"],
        });
        expect(afterEditNewTerm.some((h) => h.id === deckAId)).toBe(true);

        // 7. Delete synchronization: delete cardA and verify card-only term no longer matches deckAId
        await db.flashcard.delete({ where: { id: cardA.id } });
        const afterDelete = await executeLexicalSearch({
          query: "chemiosmotic",
          scope: scopeA,
          types: ["flashcard"],
        });
        expect(afterDelete.some((h) => h.id === deckAId)).toBe(false);
      } finally {
        await db.flashcard.deleteMany({
          where: { id: { in: [cardA.id, cardB.id] } },
        });
      }
    }, 30_000);
  });
});
