import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractGoogleSlidesPresentation,
  parseGoogleSlidesPresentation,
  MAX_GOOGLE_SLIDES_COUNT,
  MAX_SLIDES_SHAPE_GROUP_DEPTH,
  type GoogleSlidesPageElement,
  type GoogleSlidesPresentationResponse,
} from "../google-slides";
import { GoogleApiError, GOOGLE_RECONNECT_REQUIRED } from "../google-errors";
import { formatDelimitedSourceText, parseExtractedPages } from "@/lib/note-generation";
import { chunkPagedText } from "@/lib/chunking";

describe("google-slides native v1 API parser (Task 14-02)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts multi-slide presentations in 1-based slide order with titles, body shapes, tables, nested groups, and speaker notes", () => {
    const presentation: GoogleSlidesPresentationResponse = {
      presentationId: "pres-123",
      title: "Distributed Systems Lecture",
      revisionId: "rev-42",
      slides: [
        {
          objectId: "slide-1",
          pageElements: [
            {
              objectId: "body-1",
              shape: {
                placeholder: { type: "BODY" },
                text: {
                  textElements: [
                    { textRun: { content: "State machine replication\n" } },
                    { textRun: { content: "Consensus safety vs liveness\n" } },
                  ],
                },
              },
            },
            {
              objectId: "title-1",
              shape: {
                placeholder: { type: "TITLE" },
                text: {
                  textElements: [{ textRun: { content: "Lecture 1: Consensus Overview\n" } }],
                },
              },
            },
          ],
          slideProperties: {
            notesPage: {
              notesProperties: { speakerNotesObjectId: "notes-shape-1" },
              pageElements: [
                {
                  objectId: "notes-shape-1",
                  shape: {
                    placeholder: { type: "BODY" },
                    text: {
                      textElements: [
                        { textRun: { content: "Emphasize FLP impossibility result.\n" } },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
        {
          objectId: "slide-2",
          pageElements: [
            {
              objectId: "title-2",
              shape: {
                placeholder: { type: "CENTERED_TITLE" },
                text: {
                  textElements: [{ textRun: { content: "Protocol Comparison\n" } }],
                },
              },
            },
            {
              objectId: "table-1",
              table: {
                rows: 2,
                columns: 2,
                tableRows: [
                  {
                    tableCells: [
                      { text: { textElements: [{ textRun: { content: "Protocol\n" } }] } },
                      { text: { textElements: [{ textRun: { content: "Fault Model\n" } }] } },
                    ],
                  },
                  {
                    tableCells: [
                      { text: { textElements: [{ textRun: { content: "Raft\n" } }] } },
                      { text: { textElements: [{ textRun: { content: "Crash-recovery\n" } }] } },
                    ],
                  },
                ],
              },
            },
            {
              objectId: "group-1",
              elementGroup: {
                children: [
                  {
                    objectId: "nested-shape-1",
                    shape: {
                      shapeType: "TEXT_BOX",
                      text: {
                        textElements: [{ textRun: { content: "Quorum size: N/2 + 1\n" } }],
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseGoogleSlidesPresentation(presentation);

    expect(result.presentationId).toBe("pres-123");
    expect(result.title).toBe("Distributed Systems Lecture");
    expect(result.revisionId).toBe("rev-42");
    expect(result.pages).toHaveLength(2);

    // Slide 1: TITLE placeholder ordered before BODY, followed by Speaker Notes
    expect(result.pages[0]).toMatchObject({
      pageNumber: 1,
      slideObjectId: "slide-1",
      slideText: "Lecture 1: Consensus Overview\nState machine replication\nConsensus safety vs liveness",
      speakerNotes: "Emphasize FLP impossibility result.",
    });
    expect(result.pages[0]!.text).toContain("Lecture 1: Consensus Overview");
    expect(result.pages[0]!.text).toContain("Speaker Notes:\nEmphasize FLP impossibility result.");

    // Slide 2: Title + TSV table + nested group shape
    expect(result.pages[1]).toMatchObject({
      pageNumber: 2,
      slideObjectId: "slide-2",
    });
    expect(result.pages[1]!.text).toContain("Protocol\tFault Model\nRaft\tCrash-recovery");
    expect(result.pages[1]!.text).toContain("Quorum size: N/2 + 1");

    // Verify downstream compatibility with Phase 11 (AI note generation) and Phase 12 (search chunking)
    const parsedPages = parseExtractedPages(result.pages);
    expect(parsedPages).not.toBeNull();
    const formattedForAiNotes = formatDelimitedSourceText(parsedPages!, "slide");
    expect(formattedForAiNotes.availableUnits).toEqual([1, 2]);
    expect(formattedForAiNotes.formattedText).toContain("--- Slide 1 ---\nLecture 1: Consensus Overview");
    expect(formattedForAiNotes.formattedText).toContain("--- Slide 2 ---\nProtocol Comparison");

    const chunks = chunkPagedText(parsedPages!);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.pageNumber).toBe(1);
    expect(chunks[1]!.pageNumber).toBe(2);
  });

  it("handles empty slides, missing speaker notes, fallback BODY speaker notes, and unsupported shape types gracefully", () => {
    const presentation: GoogleSlidesPresentationResponse = {
      presentationId: "pres-empty",
      slides: [
        {
          objectId: "slide-empty",
          pageElements: [
            { objectId: "img-1", image: { contentUrl: "https://example.com/img.png" } },
            { objectId: "vid-1", video: { id: "yt-123" } },
            { objectId: "line-1", line: {} },
          ],
        },
        {
          objectId: "slide-fallback-notes",
          pageElements: [],
          slideProperties: {
            notesPage: {
              // No speakerNotesObjectId set — parser falls back to BODY placeholder on notesPage
              pageElements: [
                {
                  objectId: "fallback-notes",
                  shape: {
                    placeholder: { type: "BODY" },
                    text: { textElements: [{ textRun: { content: "Fallback speaker note\n" } }] },
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const result = parseGoogleSlidesPresentation(presentation);
    expect(result.title).toBe("Untitled presentation");
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]!.text).toBe("");
    expect(result.pages[1]!.speakerNotes).toBe("Fallback speaker note");
    expect(result.pages[1]!.text).toBe("Speaker Notes:\nFallback speaker note");
  });

  it("enforces bounded recursion on deeply nested elementGroup hierarchies", () => {
    let currentGroup: GoogleSlidesPageElement = {
      shape: {
        text: { textElements: [{ textRun: { content: "Deep leaf\n" } }] },
      },
    };
    for (let i = 0; i <= MAX_SLIDES_SHAPE_GROUP_DEPTH + 1; i++) {
      currentGroup = { elementGroup: { children: [currentGroup] } };
    }

    expect(() =>
      parseGoogleSlidesPresentation({
        presentationId: "pres-deep",
        slides: [{ objectId: "s1", pageElements: [currentGroup] }],
      })
    ).toThrow(/nested deeper than 20 levels/i);
  });

  it("rejects presentations exceeding MAX_GOOGLE_SLIDES_COUNT (250 slides)", () => {
    const slides = Array.from({ length: MAX_GOOGLE_SLIDES_COUNT + 1 }, (_, idx) => ({
      objectId: `s-${idx}`,
      pageElements: [],
    }));

    expect(() =>
      parseGoogleSlidesPresentation({
        presentationId: "pres-too-many",
        slides,
      })
    ).toThrow(/exceeds the 250-slide processing limit/i);
  });

  it("calls the Google Slides v1 REST API directly and maps HTTP 401/404/503 errors to GoogleApiError", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          presentationId: "pres-live",
          title: "API Deck",
          revisionId: "r1",
          slides: [
            {
              objectId: "s1",
              pageElements: [
                {
                  shape: {
                    placeholder: { type: "TITLE" },
                    text: { textElements: [{ textRun: { content: "Hello Slides API\n" } }] },
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const extracted = await extractGoogleSlidesPresentation({
      accessToken: "ya29.test-token",
      presentationId: "pres-live",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://slides.googleapis.com/v1/presentations/pres-live",
      expect.objectContaining({
        headers: { Authorization: "Bearer ya29.test-token" },
      })
    );
    expect(extracted.text).toBe("Hello Slides API");

    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(
      extractGoogleSlidesPresentation({ accessToken: "expired", presentationId: "pres-live" })
    ).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 401,
      publicMessage: GOOGLE_RECONNECT_REQUIRED,
    } satisfies Partial<GoogleApiError>);

    fetchSpy.mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));
    await expect(
      extractGoogleSlidesPresentation({ accessToken: "ya29.ok", presentationId: "pres-live" })
    ).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 503,
      isTransient: true,
    });
  });
});
