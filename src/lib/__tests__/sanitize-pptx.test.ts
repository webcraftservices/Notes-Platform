import { describe, expect, it } from "vitest";
import { sanitizePptxCss, sanitizePptxDomChunk, sanitizePptxHtml } from "@/lib/sanitize-pptx";

describe("sanitize-pptx defense against PPTX stored XSS", () => {
  it("strips script tags, event handlers, javascript: URIs, and dangerous embeds from slide markup", () => {
    const dirty =
      '<section><h1>Slide 1</h1><img src="x" onerror="alert(1)"><svg onload="alert(2)"><circle r="5"/></svg><a href="javascript:alert(3)">click</a><script>alert(4)</script><iframe srcdoc="<script>alert(5)</script>"></iframe></section>';
    const clean = sanitizePptxHtml(dirty);

    expect(clean).toContain("<h1>Slide 1</h1>");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("srcdoc");
  });

  it("neutralizes style-tag breakout, @import, and expression() inside PPTX style chunks", () => {
    const dirtyStyle =
      "<style>body{color:red}@import url(https://evil.example/x.css);div{width:expression(alert(1))}</style><script>alert(9)</script>";
    const cleanChunk = String(sanitizePptxDomChunk(dirtyStyle));

    // Not a pure <style> element (trailing <script>), so routed through HTML sanitizer stripping <style> & <script>
    expect(cleanChunk).not.toContain("<script");
    expect(cleanChunk).not.toContain("alert(9)");

    const cssPayload = sanitizePptxCss(
      "div { color: blue; } </style><img src=x onerror=alert(1)> @import 'https://evil.example'; p { width: expression(alert(2)); background: url('javascript:alert(3)'); }"
    );
    expect(cssPayload).not.toContain("</style");
    expect(cssPayload).not.toContain("<img");
    expect(cssPayload).not.toContain("@import");
    expect(cssPayload).not.toContain("expression(");
    expect(cssPayload).not.toContain("javascript:");
    expect(cssPayload).toContain("color: blue");
  });
});
