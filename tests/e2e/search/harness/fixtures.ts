/**
 * Authoritative deterministic test fixtures for Phase 12 E2E Search tests.
 * Provides multi-tenant users, workspaces, study groups, hierarchy entities,
 * notes, materials, chunks with 1536d mock embeddings, flashcards, and quizzes.
 */

export const MOCK_VECTOR_DIMENSION = 1536;

/**
 * Generates a deterministic, unit-normalized 1536-dimensional mock embedding vector.
 */
export function createMockEmbedding(seed: number | string): number[] {
  let numSeed = 0;
  if (typeof seed === "string") {
    for (let i = 0; i < seed.length; i++) {
      numSeed = (numSeed << 5) - numSeed + seed.charCodeAt(i);
      numSeed |= 0;
    }
  } else {
    numSeed = Math.floor(seed);
  }

  const rawValues: number[] = [];
  let sumSq = 0;

  for (let i = 0; i < MOCK_VECTOR_DIMENSION; i++) {
    // Deterministic pseudo-random sequence using seed and index
    const angle = (numSeed * 9301 + 49297 + i * 233) % 233280;
    const val = Math.sin(angle);
    rawValues.push(val);
    sumSq += val * val;
  }

  // Normalize to unit length (L2 norm = 1)
  const norm = Math.sqrt(sumSq) || 1;
  const vector: number[] = rawValues.map((val) => Number((val / norm).toFixed(6)));

  return vector;
}

/**
 * Computes cosine similarity between two unit-normalized vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    if (valA !== undefined && valB !== undefined) {
      dot += valA * valB;
    }
  }
  return dot;
}

// ============================================================================
// FIXTURE DATA DEFINITIONS
// ============================================================================

export interface FixtureUser {
  id: string;
  email: string;
  name: string;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface FixtureWorkspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface FixtureWorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  joinedAt: Date;
}

export interface FixtureGroup {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface FixtureGroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  joinedAt: Date;
}

export interface FixtureSubject {
  id: string;
  name: string;
  description?: string | null;
  workspaceId?: string | null;
  groupId?: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface FixtureChapter {
  id: string;
  subjectId: string;
  name: string;
  description?: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface FixtureTopic {
  id: string;
  chapterId: string;
  name: string;
  description?: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface FixtureNoteBlock {
  id: string;
  noteId: string;
  kind: string;
  heading?: string | null;
  content: unknown;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FixtureNoteChunk {
  id: string;
  noteId: string;
  content: string;
  order: number;
  tokenCount?: number;
  embedding: number[];
  createdAt: Date;
}

export interface FixtureNote {
  id: string;
  topicId?: string | null;
  authorId: string;
  title: string;
  plainText?: string | null;
  source: string;
  templateKind?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  blocks?: FixtureNoteBlock[];
  chunks?: FixtureNoteChunk[];
}

export interface FixtureMaterialChunk {
  id: string;
  materialId: string;
  content: string;
  order: number;
  pageNumber?: number | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  tokenCount?: number | null;
  embedding: number[];
  createdAt: Date;
}

export interface FixtureMaterial {
  id: string;
  ownerId: string;
  workspaceId?: string | null;
  groupId?: string | null;
  subjectId?: string | null;
  chapterId?: string | null;
  topicId?: string | null;
  type: string;
  title: string;
  extractedText?: string | null;
  extractedPages?: unknown;
  sourceUrl?: string | null;
  mimeType?: string | null;
  status: string;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  chunks?: FixtureMaterialChunk[];
}

export interface FixtureFlashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  createdAt: Date;
}

export interface FixtureFlashcardDeck {
  id: string;
  ownerId: string;
  workspaceId?: string | null;
  groupId?: string | null;
  subjectId?: string | null;
  chapterId?: string | null;
  topicId?: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  cards?: FixtureFlashcard[];
}

export interface FixtureQuizQuestion {
  id: string;
  quizId: string;
  prompt: string;
  explanation?: string | null;
  order: number;
}

export interface FixtureQuiz {
  id: string;
  ownerId: string;
  workspaceId?: string | null;
  groupId?: string | null;
  subjectId?: string | null;
  chapterId?: string | null;
  topicId?: string | null;
  title: string;
  quizType: string;
  createdAt: Date;
  questions?: FixtureQuizQuestion[];
}

export interface FixtureDataSet {
  users: FixtureUser[];
  workspaces: FixtureWorkspace[];
  workspaceMembers: FixtureWorkspaceMember[];
  groups: FixtureGroup[];
  groupMembers: FixtureGroupMember[];
  subjects: FixtureSubject[];
  chapters: FixtureChapter[];
  topics: FixtureTopic[];
  notes: FixtureNote[];
  noteBlocks: FixtureNoteBlock[];
  noteChunks: FixtureNoteChunk[];
  materials: FixtureMaterial[];
  materialChunks: FixtureMaterialChunk[];
  flashcardDecks: FixtureFlashcardDeck[];
  flashcards: FixtureFlashcard[];
  quizzes: FixtureQuiz[];
  quizQuestions: FixtureQuizQuestion[];
}

// ============================================================================
// CONCRETE SEED DATA
// ============================================================================

export const SEED_USERS: FixtureUser[] = [
  {
    id: "user-alice",
    email: "alice@example.com",
    name: "Alice Smith",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "user-bob",
    email: "bob@example.com",
    name: "Bob Jones",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "user-charlie",
    email: "charlie@example.com",
    name: "Charlie Brown",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "user-dave",
    email: "dave@example.com",
    name: "Dave Miller",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
];

export const SEED_WORKSPACES: FixtureWorkspace[] = [
  {
    id: "ws-alice",
    name: "Alice's Workspace",
    slug: "alice-ws",
    ownerId: "user-alice",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "ws-bob",
    name: "Bob's Workspace",
    slug: "bob-ws",
    ownerId: "user-bob",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "ws-charlie",
    name: "Charlie's Workspace",
    slug: "charlie-ws",
    ownerId: "user-charlie",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  },
];

export const SEED_WORKSPACE_MEMBERS: FixtureWorkspaceMember[] = [
  {
    id: "wm-alice",
    workspaceId: "ws-alice",
    userId: "user-alice",
    role: "OWNER",
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "wm-bob",
    workspaceId: "ws-bob",
    userId: "user-bob",
    role: "OWNER",
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "wm-charlie",
    workspaceId: "ws-charlie",
    userId: "user-charlie",
    role: "OWNER",
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  },
];

export const SEED_GROUPS: FixtureGroup[] = [
  {
    id: "group-1",
    name: "Biochemistry Study Group",
    description: "Collaborative research group for molecular biology and organic chemistry",
    ownerId: "user-alice",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "group-2",
    name: "Discrete Math Study Group",
    description: "Graph theory, combinatorics and algorithms study group",
    ownerId: "user-bob",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "group-deleted",
    name: "Archived Medical Study Group",
    description: "Soft deleted study group",
    ownerId: "user-alice",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-05T00:00:00Z"),
    deletedAt: new Date("2026-01-05T00:00:00Z"),
  },
];

export const SEED_GROUP_MEMBERS: FixtureGroupMember[] = [
  {
    id: "gm-g1-alice",
    groupId: "group-1",
    userId: "user-alice",
    role: "OWNER",
    joinedAt: new Date("2026-01-02T00:00:00Z"),
  },
  {
    id: "gm-g1-bob",
    groupId: "group-1",
    userId: "user-bob",
    role: "MEMBER",
    joinedAt: new Date("2026-01-02T00:00:00Z"),
  },
  {
    id: "gm-g1-dave",
    groupId: "group-1",
    userId: "user-dave",
    role: "VIEWER",
    joinedAt: new Date("2026-01-03T00:00:00Z"),
  },
  {
    id: "gm-g2-bob",
    groupId: "group-2",
    userId: "user-bob",
    role: "OWNER",
    joinedAt: new Date("2026-01-02T00:00:00Z"),
  },
  {
    id: "gm-g2-charlie",
    groupId: "group-2",
    userId: "user-charlie",
    role: "MEMBER",
    joinedAt: new Date("2026-01-02T00:00:00Z"),
  },
];

export const SEED_SUBJECTS: FixtureSubject[] = [
  {
    id: "subj-alice-bio",
    name: "Molecular Biology",
    description: "Core cellular biology, genetics, and enzymatic processes",
    workspaceId: "ws-alice",
    groupId: null,
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "subj-group1-chem",
    name: "Organic Chemistry",
    description: "Reaction mechanisms, stereochemistry, and aromatics",
    workspaceId: null,
    groupId: "group-1",
    order: 2,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "subj-bob-cs",
    name: "Computer Science",
    description: "Algorithms, distributed systems, and computer architecture",
    workspaceId: "ws-bob",
    groupId: null,
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "subj-charlie-phys",
    name: "Quantum Physics",
    description: "Special relativity, quantum mechanics, and field theory",
    workspaceId: "ws-charlie",
    groupId: null,
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "subj-deleted",
    name: "Deleted Botany Subject",
    description: "Soft deleted subject under Alice workspace",
    workspaceId: "ws-alice",
    groupId: null,
    order: 99,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_CHAPTERS: FixtureChapter[] = [
  {
    id: "chap-dna",
    subjectId: "subj-alice-bio",
    name: "DNA Replication and Repair",
    description: "Semi-conservative replication, replication fork, and DNA repair enzymes",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "chap-rna",
    subjectId: "subj-alice-bio",
    name: "RNA Transcription and Processing",
    description: "RNA polymerase, promoter recognition, and post-transcriptional modification",
    order: 2,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "chap-aromatic",
    subjectId: "subj-group1-chem",
    name: "Aromatic Compounds and Reactions",
    description: "Huckel's rule, resonance stabilization, and electrophilic aromatic substitution",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "chap-relativity",
    subjectId: "subj-charlie-phys",
    name: "Special and General Relativity",
    description: "Spacetime geometry, Lorentz transformations, and curvature tensors",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "chap-deleted",
    subjectId: "subj-alice-bio",
    name: "Deleted DNA Sequencing Chapter",
    description: "Soft deleted chapter under active subject",
    order: 99,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_TOPICS: FixtureTopic[] = [
  {
    id: "topic-helicase",
    chapterId: "chap-dna",
    name: "DNA Helicase and Polymerase Mechanisms",
    description: "ATP-dependent unwinding and Okazaki fragment synthesis",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "topic-mrna",
    chapterId: "chap-rna",
    name: "mRNA Splicing and Ribosomes",
    description: "Spliceosome assembly, intron lariat excision, and translation initiation",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "topic-benzene",
    chapterId: "chap-aromatic",
    name: "Benzene Ring Resonance and Electrophilic Substitution",
    description: "Nitration, sulfonation, and Friedel-Crafts acylation of benzene",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "topic-lorentz",
    chapterId: "chap-relativity",
    name: "Lorentz Transformations and Spacetime Invariance",
    description: "Time dilation, length contraction, and 4-vector kinematics",
    order: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "topic-deleted",
    chapterId: "chap-dna",
    name: "Deleted Helicase Inhibitor Topic",
    description: "Soft deleted topic under active chapter",
    order: 99,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: new Date("2026-01-04T00:00:00Z"),
  },
];

// ProseMirror Tiptap JSON block contents
const tiptapHelicaseContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "DNA helicase unwinds the double helix at the replication fork by breaking hydrogen bonds between base pairs.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "DNA polymerase III synthesizes the leading strand continuously in the 5' to 3' direction.",
        },
      ],
    },
  ],
};

const tiptapBenzeneContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Benzene exhibits remarkable thermodynamic stability due to cyclic delocalized pi electrons.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Electrophilic aromatic substitution preserves the aromatic sextet via a resonance-stabilized arenium ion intermediate.",
        },
      ],
    },
  ],
};

const tiptapCharlieSecretContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Lorentz invariance constitutes the exact spacetime symmetry of relativistic quantum fields and Einstein tensor.",
        },
      ],
    },
  ],
};

export const SEED_NOTES: FixtureNote[] = [
  {
    id: "note-dna-helicase",
    topicId: "topic-helicase",
    authorId: "user-alice",
    title: "DNA Helicase & Polymerase III Machinery",
    plainText:
      "DNA helicase unwinds the double helix at the replication fork by breaking hydrogen bonds between base pairs. DNA polymerase III synthesizes the leading strand continuously in the 5' to 3' direction.",
    source: "MANUAL",
    templateKind: "lecture",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "note-group-benzene",
    topicId: "topic-benzene",
    authorId: "user-bob",
    title: "Benzene Ring Resonance and Stability",
    plainText:
      "Benzene exhibits remarkable thermodynamic stability due to cyclic delocalized pi electrons. Electrophilic aromatic substitution preserves the aromatic sextet via a resonance-stabilized arenium ion intermediate.",
    source: "MANUAL",
    templateKind: "meeting",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "note-charlie-secret",
    topicId: "topic-lorentz",
    authorId: "user-charlie",
    title: "Charlie Quantum Lorentz Invariance Notes",
    plainText:
      "Lorentz invariance constitutes the exact spacetime symmetry of relativistic quantum fields and Einstein tensor.",
    source: "MANUAL",
    templateKind: null,
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "note-deleted",
    topicId: "topic-helicase",
    authorId: "user-alice",
    title: "Deleted Helicase Experimental Draft",
    plainText: "Draft experiment on helicase kinetics that was discarded.",
    source: "MANUAL",
    templateKind: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-05T00:00:00Z"),
    deletedAt: new Date("2026-01-05T00:00:00Z"),
  },
];

export const SEED_NOTE_BLOCKS: FixtureNoteBlock[] = [
  {
    id: "block-helicase-1",
    noteId: "note-dna-helicase",
    kind: "OVERVIEW",
    heading: "Replication Fork Mechanism",
    content: tiptapHelicaseContent,
    order: 0,
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "block-benzene-1",
    noteId: "note-group-benzene",
    kind: "CORE_CONCEPT",
    heading: "Aromatic Sextet",
    content: tiptapBenzeneContent,
    order: 0,
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "block-charlie-1",
    noteId: "note-charlie-secret",
    kind: "DEFINITION",
    heading: "Spacetime Symmetry",
    content: tiptapCharlieSecretContent,
    order: 0,
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_NOTE_CHUNKS: FixtureNoteChunk[] = [
  {
    id: "nchunk-helicase-1",
    noteId: "note-dna-helicase",
    content:
      "DNA helicase unwinds the double helix at the replication fork by breaking hydrogen bonds between base pairs.",
    order: 0,
    tokenCount: 22,
    embedding: createMockEmbedding("dna-helicase-chunk-1"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "nchunk-helicase-2",
    noteId: "note-dna-helicase",
    content:
      "DNA polymerase III synthesizes the leading strand continuously in the 5' to 3' prime direction.",
    order: 1,
    tokenCount: 20,
    embedding: createMockEmbedding("dna-helicase-chunk-2"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "nchunk-benzene-1",
    noteId: "note-group-benzene",
    content:
      "Benzene exhibits remarkable thermodynamic stability due to cyclic delocalized pi electrons forming an aromatic sextet.",
    order: 0,
    tokenCount: 21,
    embedding: createMockEmbedding("benzene-chunk-1"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "nchunk-charlie-1",
    noteId: "note-charlie-secret",
    content:
      "Lorentz invariance constitutes the exact spacetime symmetry of relativistic quantum fields and Einstein tensor.",
    order: 0,
    tokenCount: 19,
    embedding: createMockEmbedding("charlie-lorentz-chunk-1"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_MATERIALS: FixtureMaterial[] = [
  {
    id: "mat-dna-slides",
    ownerId: "user-alice",
    workspaceId: "ws-alice",
    groupId: null,
    subjectId: "subj-alice-bio",
    chapterId: "chap-dna",
    topicId: "topic-helicase",
    type: "PDF",
    title: "Lecture 04: DNA Replication Fork & Helicase Structure.pdf",
    extractedText:
      "Slide 1: DNA Replication overview. Slide 2: Helicase hexamer enzyme motor unwinding duplex DNA at 1000 bp/sec. Slide 3: Polymerase delta and epsilon coordination.",
    extractedPages: [
      { pageNumber: 1, text: "Slide 1: DNA Replication overview." },
      { pageNumber: 2, text: "Slide 2: Helicase hexamer enzyme motor unwinding duplex DNA at 1000 bp/sec." },
      { pageNumber: 3, text: "Slide 3: Polymerase delta and epsilon coordination." },
    ],
    mimeType: "application/pdf",
    status: "READY",
    visibility: "PRIVATE",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "mat-chem-lecture-audio",
    ownerId: "user-alice",
    workspaceId: null,
    groupId: "group-1",
    subjectId: "subj-group1-chem",
    chapterId: "chap-aromatic",
    topicId: "topic-benzene",
    type: "AUDIO",
    title: "Organic Chem Week 3: Benzene Electrophilic Substitution Lecture.mp3",
    extractedText:
      "Audio recording discussing benzene resonance energy and electrophilic aromatic substitution mechanisms.",
    mimeType: "audio/mpeg",
    status: "READY",
    visibility: "GROUP",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "mat-charlie-paper",
    ownerId: "user-charlie",
    workspaceId: "ws-charlie",
    groupId: null,
    subjectId: "subj-charlie-phys",
    chapterId: "chap-relativity",
    topicId: "topic-lorentz",
    type: "PDF",
    title: "Charlie Advanced Relativity Notes and Tensors.pdf",
    extractedText: "Spacetime interval ds^2 = c^2 dt^2 - dx^2 - dy^2 - dz^2 invariant under Lorentz group.",
    extractedPages: [{ pageNumber: 1, text: "Spacetime interval invariant under Lorentz group." }],
    mimeType: "application/pdf",
    status: "READY",
    visibility: "PRIVATE",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    deletedAt: null,
  },
  {
    id: "mat-deleted",
    ownerId: "user-alice",
    workspaceId: "ws-alice",
    groupId: null,
    subjectId: "subj-alice-bio",
    chapterId: "chap-dna",
    topicId: "topic-helicase",
    type: "PDF",
    title: "Deleted Outdated Replication Notes.pdf",
    extractedText: "Obsolete DNA replication model discarded.",
    status: "READY",
    visibility: "PRIVATE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-05T00:00:00Z"),
    deletedAt: new Date("2026-01-05T00:00:00Z"),
  },
];

export const SEED_MATERIAL_CHUNKS: FixtureMaterialChunk[] = [
  {
    id: "mchunk-slides-1",
    materialId: "mat-dna-slides",
    content: "Slide 1: DNA Replication overview and cellular division cycle timing.",
    order: 0,
    pageNumber: 1,
    startSeconds: null,
    endSeconds: null,
    tokenCount: 15,
    embedding: createMockEmbedding("mat-slides-p1"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "mchunk-slides-2",
    materialId: "mat-dna-slides",
    content: "Slide 2: Helicase hexamer enzyme motor unwinding duplex DNA at 1000 bp/sec rate.",
    order: 1,
    pageNumber: 2,
    startSeconds: null,
    endSeconds: null,
    tokenCount: 18,
    embedding: createMockEmbedding("mat-slides-p2-helicase"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "mchunk-slides-3",
    materialId: "mat-dna-slides",
    content: "Slide 3: Polymerase delta and epsilon coordination with sliding clamp PCNA.",
    order: 2,
    pageNumber: 3,
    startSeconds: null,
    endSeconds: null,
    tokenCount: 16,
    embedding: createMockEmbedding("mat-slides-p3"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "mchunk-audio-1",
    materialId: "mat-chem-lecture-audio",
    content:
      "Professor introduces benzene resonance energy and electrophilic aromatic substitution mechanisms.",
    order: 0,
    pageNumber: null,
    startSeconds: 120,
    endSeconds: 240,
    tokenCount: 17,
    embedding: createMockEmbedding("mat-audio-seg-1"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "mchunk-audio-2",
    materialId: "mat-chem-lecture-audio",
    content:
      "Arenium ion intermediate carbocation stabilization and proton transfer regenerates aromatic sextet.",
    order: 1,
    pageNumber: null,
    startSeconds: 241,
    endSeconds: 480,
    tokenCount: 18,
    embedding: createMockEmbedding("mat-audio-seg-2"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "mchunk-charlie-1",
    materialId: "mat-charlie-paper",
    content:
      "Spacetime interval ds^2 = c^2 dt^2 - dx^2 - dy^2 - dz^2 invariant under Lorentz group transformations.",
    order: 0,
    pageNumber: 1,
    startSeconds: null,
    endSeconds: null,
    tokenCount: 22,
    embedding: createMockEmbedding("mat-charlie-lorentz"),
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_FLASHCARD_DECKS: FixtureFlashcardDeck[] = [
  {
    id: "deck-dna-cards",
    ownerId: "user-alice",
    workspaceId: "ws-alice",
    groupId: null,
    subjectId: "subj-alice-bio",
    chapterId: "chap-dna",
    topicId: "topic-helicase",
    title: "DNA Replication Essentials Deck",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "deck-charlie-cards",
    ownerId: "user-charlie",
    workspaceId: "ws-charlie",
    groupId: null,
    subjectId: "subj-charlie-phys",
    chapterId: "chap-relativity",
    topicId: "topic-lorentz",
    title: "Quantum Relativity Concepts Deck",
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_FLASHCARDS: FixtureFlashcard[] = [
  {
    id: "card-dna-1",
    deckId: "deck-dna-cards",
    front: "What enzyme breaks hydrogen bonds to unwind DNA at the replication fork?",
    back: "DNA Helicase",
    difficulty: "EASY",
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "card-dna-2",
    deckId: "deck-dna-cards",
    front: "In which catalytic direction does DNA polymerase synthesize new DNA strands?",
    back: "5' to 3' direction",
    difficulty: "MEDIUM",
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
  {
    id: "card-charlie-1",
    deckId: "deck-charlie-cards",
    front: "What invariant quantity is conserved under Lorentz transformations?",
    back: "The spacetime interval ds^2",
    difficulty: "HARD",
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_QUIZZES: FixtureQuiz[] = [
  {
    id: "quiz-dna-review",
    ownerId: "user-alice",
    workspaceId: "ws-alice",
    groupId: null,
    subjectId: "subj-alice-bio",
    chapterId: "chap-dna",
    topicId: "topic-helicase",
    title: "DNA Replication Mastery Quiz",
    quizType: "MIXED",
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
];

export const SEED_QUIZ_QUESTIONS: FixtureQuizQuestion[] = [
  {
    id: "qq-dna-1",
    quizId: "quiz-dna-review",
    prompt: "Which enzyme is primarily responsible for unzipping double-stranded DNA?",
    explanation: "DNA helicase unzips DNA using ATP hydrolysis.",
    order: 0,
  },
];

/**
 * Returns a complete, fresh deep copy of all seed data.
 */
export function getFreshFixtureData(): FixtureDataSet {
  return JSON.parse(
    JSON.stringify({
      users: SEED_USERS,
      workspaces: SEED_WORKSPACES,
      workspaceMembers: SEED_WORKSPACE_MEMBERS,
      groups: SEED_GROUPS,
      groupMembers: SEED_GROUP_MEMBERS,
      subjects: SEED_SUBJECTS,
      chapters: SEED_CHAPTERS,
      topics: SEED_TOPICS,
      notes: SEED_NOTES,
      noteBlocks: SEED_NOTE_BLOCKS,
      noteChunks: SEED_NOTE_CHUNKS,
      materials: SEED_MATERIALS,
      materialChunks: SEED_MATERIAL_CHUNKS,
      flashcardDecks: SEED_FLASHCARD_DECKS,
      flashcards: SEED_FLASHCARDS,
      quizzes: SEED_QUIZZES,
      quizQuestions: SEED_QUIZ_QUESTIONS,
    })
  );
}
