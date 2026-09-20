import { describe, expect, it } from "vitest";
import { z } from "zod";
import { rejectPrototypePollution } from "@/lib/validation/safe-json";

const schema = rejectPrototypePollution(z.record(z.any()));

describe("rejectPrototypePollution", () => {
  it("accepts an ordinary nested Tiptap/ProseMirror-shaped document", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "hello" }] },
      ],
    };

    expect(schema.safeParse(doc).success).toBe(true);
  });

  it("never leaves a literal top-level __proto__ key in a successfully parsed result", () => {
    // zod's own z.record() parsing already drops a literal top-level
    // __proto__ key before our superRefine even runs (verified directly
    // against the installed zod version) — so this specific shape never
    // reaches our check at all. That's fine: what matters is the actual
    // result is safe either way. The realistic exploit shape (a __proto__
    // key nested inside a node's `attrs`, at least one level down — see
    // the next test) is NOT touched by that same zod behavior, which is
    // exactly why our explicit guard exists.
    const malicious = JSON.parse('{"__proto__": {"onerror": "alert(1)"}, "type": "doc"}');
    const result = schema.safeParse(malicious);
    if (result.success) {
      expect(Object.prototype.hasOwnProperty.call(result.data as object, "__proto__")).toBe(false);
    }
  });

  it("rejects __proto__ nested inside a node's attrs (the actual Tiptap CVE shape)", () => {
    const malicious = JSON.parse(
      '{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":{"onerror":"alert(document.cookie)"}}}]}'
    );
    expect(schema.safeParse(malicious).success).toBe(false);
  });

  it("rejects __proto__ nested inside an array", () => {
    const malicious = JSON.parse('{"content":[{"attrs":{"__proto__":{"src":"x"}}}]}');
    expect(schema.safeParse(malicious).success).toBe(false);
  });

  it("rejects a 'constructor' key", () => {
    const malicious = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    expect(schema.safeParse(malicious).success).toBe(false);
  });

  it("rejects a 'prototype' key", () => {
    const malicious = JSON.parse('{"attrs":{"prototype":{"polluted":true}}}');
    expect(schema.safeParse(malicious).success).toBe(false);
  });

  it("does not hang or throw on a deeply nested but otherwise ordinary document", () => {
    let doc: Record<string, unknown> = { type: "text" };
    for (let i = 0; i < 200; i += 1) {
      doc = { type: "node", content: [doc] };
    }
    expect(() => schema.safeParse(doc)).not.toThrow();
    expect(schema.safeParse(doc).success).toBe(true);
  });

  it("handles a self-referential object without infinite-looping", () => {
    const circular: Record<string, unknown> = { type: "doc" };
    circular.self = circular;
    expect(() => schema.safeParse(circular)).not.toThrow();
  });
});
