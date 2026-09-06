import { GoogleDriveService } from "./google-drive";

/**
 * Extracts a Google Doc's text content via the real Google Docs export
 * mechanism (Drive's `files.export` with `mimeType=text/plain`) — this is
 * Google's own supported operation for turning a Google Doc into plain
 * text, not a webpage scrape (spec §13).
 *
 * This deliberately does not use the Google Docs v1 API's structured JSON
 * body (headings, lists, tables as a tree of `StructuralElement`s). Parsing
 * that into rich structure would only pay off if something downstream (e.g.
 * NoteBlocks) consumed it — Phase 7 only needs to get a Google Doc into the
 * existing Material + chunk/embed pipeline (spec §22), which works on plain
 * text either way. Preserving heading/table structure is a real gap, noted
 * in docs/google-setup.md, not something quietly worked around here.
 */
export async function extractGoogleDocText(input: {
  accessToken: string;
  documentId: string;
}): Promise<string> {
  const drive = new GoogleDriveService();
  const buffer = await drive.exportFile({
    accessToken: input.accessToken,
    fileId: input.documentId,
    mimeType: "text/plain",
  });
  return buffer.toString("utf8");
}
