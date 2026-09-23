import { describe, expect, it } from "vitest";
import { DIALOG_CONTENT_VIEWPORT_SAFE_CLASSES } from "@/components/ui/dialog";

// Phase 9.7 — P2 audit finding: DialogContent had no shared max-height /
// vertical-overflow safeguard, so a tall dialog (e.g. the Google Drive tab
// of "Add material") could be centered off the top of a short viewport
// with no way to scroll up to its title or close button. This asserts the
// actual constant the component's className is built from, rather than
// duplicating the component's rendered output (which this repo's node-only
// Vitest environment has no way to render).
describe("DIALOG_CONTENT_VIEWPORT_SAFE_CLASSES", () => {
  it("caps dialog height to fit within the viewport", () => {
    expect(DIALOG_CONTENT_VIEWPORT_SAFE_CLASSES).toContain("max-h-[90vh]");
  });

  it("allows the dialog chrome to scroll vertically when content exceeds that height", () => {
    expect(DIALOG_CONTENT_VIEWPORT_SAFE_CLASSES).toContain("overflow-y-auto");
  });
});
