import { describe, expect, it } from "vitest";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";

describe("sanitizeDocumentHtml", () => {
  it("removes <script> tags entirely", () => {
    const dirty = "<p>Hello</p><script>alert(document.cookie)</script>";
    const clean = sanitizeDocumentHtml(dirty);

    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert(document.cookie)");
    expect(clean).toContain("<p>Hello</p>");
  });

  it("strips event-handler attributes such as onerror and onclick", () => {
    const dirty = '<img src="x" onerror="alert(1)"><button onclick="doHarm()">Click</button>';
    const clean = sanitizeDocumentHtml(dirty);

    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("doHarm");
  });

  it("strips javascript: URLs from href/src attributes", () => {
    const dirty = '<a href="javascript:alert(1)">bad link</a>';
    const clean = sanitizeDocumentHtml(dirty);

    expect(clean).not.toContain("javascript:");
  });

  it("removes embedded SVG-based attack surfaces (e.g. onload)", () => {
    const dirty = '<svg onload="alert(1)"><circle r="5"/></svg><p>after</p>';
    const clean = sanitizeDocumentHtml(dirty);

    expect(clean).not.toContain("<svg");
    expect(clean).not.toContain("onload");
    expect(clean).toContain("<p>after</p>");
  });

  it("removes iframe/object/embed elements", () => {
    const dirty = '<iframe src="javascript:alert(1)"></iframe><object data="evil.swf"></object>';
    const clean = sanitizeDocumentHtml(dirty);

    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<object");
  });

  it("preserves normal document formatting: headings, paragraphs, emphasis, links, lists, tables", () => {
    const legit =
      "<h1>Chapter Title</h1>" +
      "<h2>Section</h2>" +
      "<p>Some <strong>bold</strong> and <em>italic</em> text.</p>" +
      '<a href="https://example.com">a real link</a>' +
      "<ul><li>one</li><li>two</li></ul>" +
      "<ol><li>first</li></ol>" +
      "<table><tr><th>Col</th></tr><tr><td>Val</td></tr></table>" +
      "<blockquote>quoted text</blockquote>";

    const clean = sanitizeDocumentHtml(legit);

    expect(clean).toContain("<h1>Chapter Title</h1>");
    expect(clean).toContain("<h2>Section</h2>");
    expect(clean).toContain("<strong>bold</strong>");
    expect(clean).toContain("<em>italic</em>");
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain("<li>one</li>");
    expect(clean).toContain("<li>first</li>");
    expect(clean).toContain("<td>Val</td>");
    expect(clean).toContain("quoted text");
  });

  it("does not choke on plain text with no markup", () => {
    expect(sanitizeDocumentHtml("just plain text")).toBe("just plain text");
  });
});
