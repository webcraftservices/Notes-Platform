import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import _JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";

// jszip ships an old UMD declaration resolving default import to unknown under moduleResolution: "bundler"
const JSZip = _JSZip as any;

const FIXTURES_DIR = path.resolve(__dirname, "../src/lib/services/__tests__/fixtures");

export async function generateFixtures(targetDir = FIXTURES_DIR) {
  await fs.mkdir(targetDir, { recursive: true });

  // =========================================================================
  // 1. PDF FIXTURES
  // =========================================================================

  // A. Single-page PDF with known text
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.drawText("Zenote Lecture Intelligence: Introduction to Thermodynamics and Energy Conservation.", {
      x: 50,
      y: 350,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });
    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "single-page.pdf"), bytes);
  }

  // B. Multi-page PDF with distinct text on each page
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    // Page 1
    const page1 = pdf.addPage([800, 400]);
    page1.drawText("First Law of Thermodynamics: Energy cannot be created or destroyed, only transformed.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Page 2
    const page2 = pdf.addPage([800, 400]);
    page2.drawText("Second Law of Thermodynamics: The entropy of an isolated system always increases over time.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Page 3
    const page3 = pdf.addPage([800, 400]);
    page3.drawText("Third Law of Thermodynamics: As temperature approaches absolute zero, entropy approaches a constant minimum.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "multi-page.pdf"), bytes);
  }

  // C. PDF with empty second page
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    const page1 = pdf.addPage([600, 400]);
    page1.drawText("Content on page one before empty page.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Page 2: empty (no text drawn)
    pdf.addPage([600, 400]);

    const page3 = pdf.addPage([600, 400]);
    page3.drawText("Content on page three after empty page.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "empty-page.pdf"), bytes);
  }

  // D. 11-page PDF for cooperative yielding verification (yields at page 10)
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 11; i += 1) {
      const page = pdf.addPage([600, 400]);
      page.drawText(`Lecture Module Section ${i}: Real Yielding Test Content.`, {
        x: 50,
        y: 350,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
    }
    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "eleven-pages.pdf"), bytes);
  }

  // E. 401-page PDF for page-boundary ceiling verification (MAX_PDF_PAGES = 400)
  {
    const pdf = await PDFDocument.create();
    for (let i = 1; i <= 401; i += 1) {
      pdf.addPage([100, 100]);
    }
    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "over-limit-pages.pdf"), bytes);
  }

  // F. Corrupt PDF
  {
    const corruptBytes = Buffer.from("%PDF-1.4\n%corrupted-zenote-test-data-not-a-valid-structure\n%%EOF");
    await fs.writeFile(path.join(targetDir, "corrupt.pdf"), corruptBytes);
  }

  // G. Multi-paragraph PDF with distinct paragraphs separated by vertical space
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    // Paragraph 1 (lines at y=350, 334; line spacing = 16)
    page.drawText("Thermodynamics is a branch of physics that deals with heat,", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("work, and temperature, and their relation to energy, radiation,", {
      x: 50,
      y: 334,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("and physical properties of matter.", {
      x: 50,
      y: 318,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Paragraph 2 (gap = 32 from y=318 -> y=286; paragraph break)
    page.drawText("The behavior of these quantities is governed by the four laws", {
      x: 50,
      y: 286,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("of thermodynamics which convey a quantitative description.", {
      x: 50,
      y: 270,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "multi-paragraph.pdf"), bytes);
  }

  // H. Split text items and kerning (PDF.js emits adjacent separate items on same line)
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    // Line 1: 'Ther' + 'modynamics' drawn as adjacent items (gap = 0)
    const wTher = font.widthOfTextAtSize("Ther", 12);
    page.drawText("Ther", { x: 50, y: 350, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText("modynamics", { x: 50 + wTher, y: 350, size: 12, font, color: rgb(0, 0, 0) });

    // Line 2: 'Photo' + 'synthesis' drawn with small negative kerning (-0.5pt)
    const wPhoto = font.widthOfTextAtSize("Photo", 12);
    page.drawText("Photo", { x: 50, y: 330, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText("synthesis", { x: 50 + wPhoto - 0.5, y: 330, size: 12, font, color: rgb(0, 0, 0) });

    // Line 3: 'Multi' + 'cellular' (split word) then ' organisms' (separate word)
    const wMulti = font.widthOfTextAtSize("Multi", 12);
    const wCell = font.widthOfTextAtSize("cellular", 12);
    const wSpace = font.widthOfTextAtSize(" ", 12);
    page.drawText("Multi", { x: 50, y: 310, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText("cellular", { x: 50 + wMulti, y: 310, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText("organisms", { x: 50 + wMulti + wCell + wSpace, y: 310, size: 12, font, color: rgb(0, 0, 0) });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "split-kerning.pdf"), bytes);
  }

  // I. Multiple lines in a single compact block without paragraph breaks
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("First consecutive line of continuous lecture notes without break.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Second consecutive line following normal line spacing interval.", {
      x: 50,
      y: 334,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Third consecutive line completing the compact single block.", {
      x: 50,
      y: 318,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "multi-line.pdf"), bytes);
  }

  // J. Bulleted and indented lines
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("Key Principles of Modern Computing:", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    // Paragraph gap to first item (delta = 28)
    page.drawText("- Abstraction layers separate interface from implementation", {
      x: 70,
      y: 322,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("- Concurrency requires synchronization and mutual exclusion", {
      x: 70,
      y: 306,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("- Caching exploits spatial and temporal locality", {
      x: 70,
      y: 290,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "bullet-list.pdf"), bytes);
  }

  // K. Superscripts and subscripts mixed with ordinary text
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    // Line 1: E = mc2
    const wE = font.widthOfTextAtSize("Einstein formulated E = mc", 12);
    page.drawText("Einstein formulated E = mc", { x: 50, y: 350, size: 12, font, color: rgb(0, 0, 0) });
    const wTwo = font.widthOfTextAtSize("2", 8);
    page.drawText("2", { x: 50 + wE, y: 354, size: 8, font, color: rgb(0, 0, 0) });
    page.drawText(" in 1905.", { x: 50 + wE + wTwo, y: 350, size: 12, font, color: rgb(0, 0, 0) });

    // Line 2: H2O
    const wH = font.widthOfTextAtSize("Water consists of H", 12);
    page.drawText("Water consists of H", { x: 50, y: 330, size: 12, font, color: rgb(0, 0, 0) });
    const wSubTwo = font.widthOfTextAtSize("2", 8);
    page.drawText("2", { x: 50 + wH, y: 327, size: 8, font, color: rgb(0, 0, 0) });
    page.drawText("O molecules.", { x: 50 + wH + wSubTwo, y: 330, size: 12, font, color: rgb(0, 0, 0) });

    // Line 3: Footnote / citation marker
    const wRef = font.widthOfTextAtSize("Reference note on quantum mechanics", 12);
    page.drawText("Reference note on quantum mechanics", { x: 50, y: 310, size: 12, font, color: rgb(0, 0, 0) });
    const wOne = font.widthOfTextAtSize("1", 8);
    page.drawText("1", { x: 50 + wRef, y: 314, size: 8, font, color: rgb(0, 0, 0) });
    page.drawText(" shows theoretical convergence.", { x: 50 + wRef + wOne, y: 310, size: 12, font, color: rgb(0, 0, 0) });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "superscript-subscript.pdf"), bytes);
  }

  // L. Double-spaced document with distinct paragraphs
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    // Paragraph 1: 3 lines, line spacing 26pt (y=350, 324, 298)
    page.drawText("This is the first line of a double-spaced academic paper draft.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("This is the second consecutive line of the first paragraph.", {
      x: 50,
      y: 324,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("This is the third concluding line of the first paragraph.", {
      x: 50,
      y: 298,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Paragraph 2: paragraph gap 50pt (from y=298 to y=248), line spacing 26pt (y=248, 222)
    page.drawText("This begins the second distinct paragraph after a larger vertical gap.", {
      x: 50,
      y: 248,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("This is the final line of the second double-spaced paragraph.", {
      x: 50,
      y: 222,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "double-spaced.pdf"), bytes);
  }

  // M. 1.5-spaced document with distinct paragraphs
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    // Paragraph 1: 3 lines, line spacing 20pt (y=350, 330, 310)
    page.drawText("First line of a standard one-point-five spaced lecture note.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Second line following normal one-point-five spacing.", {
      x: 50,
      y: 330,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Third line completing the initial one-point-five paragraph.", {
      x: 50,
      y: 310,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Paragraph 2: paragraph gap 38pt (y=310 -> y=272), line spacing 20pt (y=272, 252)
    page.drawText("Second paragraph begins here with clearly elevated paragraph margin.", {
      x: 50,
      y: 272,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Concluding line of the second one-point-five spaced block.", {
      x: 50,
      y: 252,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "one-point-five-spaced.pdf"), bytes);
  }

  // N. Faux-bold duplicate text items (double-strike runs with 0.3pt offset)
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    // Heading 1 drawn twice with 0.3pt horizontal offset
    page.drawText("Introduction to Advanced Quantum Mechanics", {
      x: 50.0,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Introduction to Advanced Quantum Mechanics", {
      x: 50.3,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    // Subheading drawn twice with 0.3pt horizontal offset
    page.drawText("Section 1: Fundamentals of Wave Functions", {
      x: 50.0,
      y: 320,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Section 1: Fundamentals of Wave Functions", {
      x: 50.3,
      y: 320,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "faux-bold.pdf"), bytes);
  }

  // O. Legitimate adjacent repeated words that must NOT be deduplicated
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("It is true that that decision had had positive results.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Never never assume the outcome without empirical verification.", {
      x: 50,
      y: 334,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "repeated-words.pdf"), bytes);
  }

  // P. Three-line page with deltas [26, 50] (Line 1 to 2 = 26pt, Line 2 to 3 = 50pt)
  // Proves Case B conservative min delta preserves paragraph break without median inflation.
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("First line of the introduction section.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Second line continuing the introduction section.", {
      x: 50,
      y: 324,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("New paragraph starting after a distinct vertical gap.", {
      x: 50,
      y: 274,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "three-line-paragraph.pdf"), bytes);
  }

  // Q. Three-line page with same geometry [26, 50] drawn in reversed stream order (bottom-to-top)
  // Proves that item arrival order in content stream does not affect line reconstruction or paragraph classification.
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("New paragraph starting after a distinct vertical gap.", {
      x: 50,
      y: 274,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Second line continuing the introduction section.", {
      x: 50,
      y: 324,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("First line of the introduction section.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "three-line-reversed.pdf"), bytes);
  }

  // R. Two-line double-spaced page with exactly one 26pt delta
  // Proves Case C conservative fallback emits \n instead of an invented paragraph break.
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("First line of a two-line double-spaced note.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Second line of a two-line double-spaced note.", {
      x: 50,
      y: 324,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "two-line-double-spaced.pdf"), bytes);
  }

  // S. Four-line page with three deltas [26, 26, 50]
  // Proves Case A adaptive median behavior remains intact for N >= 3 deltas.
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);

    page.drawText("First line of initial paragraph block.", {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Second line of initial paragraph block.", {
      x: 50,
      y: 324,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Third line of initial paragraph block.", {
      x: 50,
      y: 298,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText("Concluding separate paragraph following elevated delta.", {
      x: 50,
      y: 248,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const bytes = await pdf.save();
    await fs.writeFile(path.join(targetDir, "four-line-adaptive.pdf"), bytes);
  }

  // =========================================================================
  // 2. DOCX FIXTURES
  // =========================================================================

  // A. Paragraphs DOCX
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );

    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    );

    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Chapter 1: Overview of Distributed Systems Architecture.</w:t></w:r></w:p>
    <w:p><w:r><w:t>CAP Theorem states that a distributed data store can only provide two of Consistency, Availability, and Partition tolerance.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Modern cloud databases make explicit tradeoffs between strong consistency and low latency.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    );

    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "paragraphs.docx"), bytes);
  }

  // B. Table DOCX
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );

    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    );

    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Comparison Table of Database Guarantees:</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Model</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Consistency</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Availability</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>ACID</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Immediate</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Limited</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>BASE</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Eventual</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>High</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`
    );

    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "table.docx"), bytes);
  }

  // C. Corrupt DOCX
  {
    const corruptBytes = Buffer.from("PK\x03\x04corrupted-not-a-valid-zip-archive-for-word");
    await fs.writeFile(path.join(targetDir, "corrupt.docx"), corruptBytes);
  }

  // =========================================================================
  // 3. PPTX FIXTURES
  // =========================================================================

  // A. Two-slides PPTX
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );

    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );

    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );

    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
    );

    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Lecture 1: Quantum Foundations</a:t></a:r></a:p>
          <a:p><a:r><a:t>Overview of wave-particle duality and Schrödinger equation.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );

    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Heisenberg Uncertainty Principle</a:t></a:r></a:p>
          <a:p><a:r><a:t>Cannot simultaneously measure position and momentum with arbitrary precision.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );

    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "two-slides.pptx"), bytes);
  }

  // B. Multiple paragraphs / bullet points PPTX
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );

    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );

    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );

    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );

    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Quantum Core Principles</a:t></a:r></a:p>
          <a:p><a:r><a:t>First Principle: Superposition</a:t></a:r></a:p>
          <a:p><a:r><a:t>Second Principle: Entanglement</a:t></a:r></a:p>
          <a:p><a:r><a:t>Third Principle: Interference</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );

    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "multiple-paragraphs.pptx"), bytes);
  }

  // C. 11-slide PPTX for cooperative yielding verification (yields at slide 10)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${Array.from(
        { length: 11 },
        (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`
      ).join("")}</p:sldIdLst></p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from(
        { length: 11 },
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
      ).join("")}</Relationships>`
    );

    for (let i = 1; i <= 11; i += 1) {
      zip.file(
        `ppt/slides/slide${i}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide ${i} Content for Yielding Test</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
      );
    }
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "eleven-slides.pptx"), bytes);
  }

  // D. 251-slide PPTX for slide-boundary ceiling verification (MAX_PPTX_SLIDES = 250)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`
    );
    for (let i = 1; i <= 251; i += 1) {
      zip.file(
        `ppt/slides/slide${i}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide ${i}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
      );
    }
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "over-limit-slides.pptx"), bytes);
  }

  // E. Oversized slide XML PPTX (> 2 MB uncompressed XML on slide 1)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`
    );
    // 2 MB + 100 KB slide XML
    const largePadding = "A".repeat(2 * 1024 * 1024 + 100 * 1024);
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Oversized slide: ${largePadding}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      { compression: "DEFLATE" }
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await fs.writeFile(path.join(targetDir, "oversized-slide.pptx"), bytes);
  }

  // F. Corrupt PPTX
  {
    const corruptBytes = Buffer.from("PK\x03\x04corrupted-not-a-valid-zip-archive-for-powerpoint");
    await fs.writeFile(path.join(targetDir, "corrupt.pptx"), corruptBytes);
  }

  // G. Runs and Attributes PPTX (styled runs, xml:space="preserve", attributes, XML entities, soft breaks)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r><a:t>electro</a:t></a:r>
            <a:r><a:rPr b="1"/><a:t>magnetism</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t>Quantum </a:t></a:r>
            <a:r><a:t>Mechanics</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t xml:space="preserve">  Leading and trailing spaces  </a:t></a:r>
            <a:r><a:t>Follow-up</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t dirty="0" err="1" lang="en-US">Attribute-decorated text run</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t>Salt &amp; Pepper: &lt;tag&gt; &quot;quoted&quot; &apos;single&apos;</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t>Break before</a:t></a:r>
            <a:br/>
            <a:r><a:t>Break after</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "runs-and-attributes.pptx"), bytes);
  }

  // H. Multi-shapes PPTX (multiple text boxes on a single slide)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Lecture 5: Thermodynamics</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Professor Davis — Fall 2026</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Overview of heat engines</a:t></a:r></a:p>
          <a:p><a:r><a:t>Carnot cycle efficiency</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "multi-shapes.pptx"), bytes);
  }

  // I. Grouped shapes PPTX (nested group shape hierarchy)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Architecture Overview</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:grpSp>
        <p:sp>
          <p:txBody>
            <a:p><a:r><a:t>Frontend Service</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
        <p:sp>
          <p:txBody>
            <a:p><a:r><a:t>API Gateway</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
        <p:grpSp>
          <p:sp>
            <p:txBody>
              <a:p><a:r><a:t>Auth Database</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
          <p:sp>
            <p:txBody>
              <a:p><a:r><a:t>Cache Cluster</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:grpSp>
      </p:grpSp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "grouped-shapes.pptx"), bytes);
  }

  // J. Table PPTX (multi-row and multi-column table in graphicFrame)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:graphicFrame>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Target</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Status</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>Latency</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>&lt; 50ms</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Passing</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>Availability</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>99.99%</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Nominal</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>Notes</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc>
                  <a:txBody>
                    <a:p><a:r><a:t>Review weekly</a:t></a:r></a:p>
                    <a:p><a:r><a:t>Escalate P1</a:t></a:r></a:p>
                  </a:txBody>
                </a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Logged</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "table.pptx"), bytes);
  }

  // K. Reordered slides PPTX (presentation.xml order differs deliberately from numeric filename order)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    // presentation.xml lists rId2 (slide2) -> rId3 (slide3) -> rId1 (slide1)
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="258" r:id="rId3"/>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Physical Slide 1: Conclusion</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Physical Slide 2: Introduction</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    );
    zip.file(
      "ppt/slides/slide3.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Physical Slide 3: Methodology</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "reordered-slides.pptx"), bytes);
  }

  // L. Fallback order PPTX (missing presentation.xml falls back to numeric filename ordering)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Fallback Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Fallback Slide 2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "fallback-order.pptx"), bytes);
  }

  // M. Malformed slide XML PPTX (unclosed tag in slide XML fails safely)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><unclosed-tag></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "malformed-slide.pptx"), bytes);
  }

  // Helper to build nested group shapes for testing group depth
  function buildNestedGroupSlideXml(levels: number, innermostText: string): string {
    let openTags = "";
    let closeTags = "";
    for (let i = 0; i < levels; i++) {
      openTags += `<p:grpSp>`;
      closeTags += `</p:grpSp>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      ${openTags}
        <p:sp>
          <p:txBody>
            <a:p><a:r><a:t>${innermostText}</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      ${closeTags}
    </p:spTree>
  </p:cSld>
</p:sld>`;
  }

  // N. Group depth 20 (exactly 20 levels deep, boundary allowed)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file("ppt/slides/slide1.xml", buildNestedGroupSlideXml(20, "Innermost depth 20 text"));
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "group-depth-20.pptx"), bytes);
  }

  // O. Group depth 21 (21 levels deep, exceeds MAX_SHAPE_GROUP_DEPTH = 20)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file("ppt/slides/slide1.xml", buildNestedGroupSlideXml(21, "Innermost depth 21 text"));
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "group-depth-21.pptx"), bytes);
  }

  // P. Relationship missing ID: presentation.xml declares rId1 & rId2, but .rels only defines rId1
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-missing-id.pptx"), bytes);
  }

  // Q. Relationship missing target: rId2 points to a slide that does not exist in the archive
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/missing-slide2.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-missing-target.pptx"), bytes);
  }

  // R. Duplicate relationship ID in .rels
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-duplicate-id.pptx"), bytes);
  }

  // S. Duplicate slide reference in presentation.xml <p:sldIdLst>
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-duplicate-slide.pptx"), bytes);
  }

  // T. External relationship target
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="https://example.com/slides/slide2.xml" TargetMode="External"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-external-target.pptx"), bytes);
  }

  // U. Partially valid relationship map: target points outside ppt/slides/ (e.g. path traversal)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../outside.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-partially-valid.pptx"), bytes);
  }

  // V. Orphaned relationships file (presentation.xml.rels is present but presentation.xml is missing)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "orphaned-rels.pptx"), bytes);
  }

  // W. Duplicate slide targets (two different relationship IDs point to the same slide target)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-duplicate-targets.pptx"), bytes);
  }

  // X. Invalid relationship type (rId2 points to a theme relationship instead of a slide relationship)
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "rel-invalid-type.pptx"), bytes);
  }

  // Y. Malformed presentation.xml
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><unclosed-presentation></p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "malformed-presentation-xml.pptx"), bytes);
  }

  // Z. Malformed presentation.xml.rels
  {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    );
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><unclosed-rels></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(targetDir, "malformed-rels-xml.pptx"), bytes);
  }

  console.log(`Successfully generated 39 test fixtures in ${targetDir}`);
}

if (require.main === module) {
  generateFixtures().catch((err) => {
    console.error("Fixture generation failed:", err);
    process.exit(1);
  });
}
