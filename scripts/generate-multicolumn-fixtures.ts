import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";

async function main() {
  const dir = path.resolve(__dirname, "../src/lib/services/__tests__/fixtures");
  await fs.mkdir(dir, { recursive: true });

  // 1. two-column-symmetric.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    // Left column: x=50, w ~ 120
    page.drawText("Left column line one.", { x: 50, y: 350, size: 12, font });
    page.drawText("Left column line two.", { x: 50, y: 330, size: 12, font });
    page.drawText("Left column line three.", { x: 50, y: 310, size: 12, font });

    // Right column: x=320, w ~ 120 (gutter on [200, 320], width ~120)
    page.drawText("Right column line one.", { x: 320, y: 350, size: 12, font });
    page.drawText("Right column line two.", { x: 320, y: 330, size: 12, font });
    page.drawText("Right column line three.", { x: 320, y: 310, size: 12, font });

    await fs.writeFile(path.join(dir, "two-column-symmetric.pdf"), await pdf.save());
  }

  // 2. two-column-staggered.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    // Left: y = 360, 320, 280
    page.drawText("Staggered left line one.", { x: 50, y: 360, size: 12, font });
    page.drawText("Staggered left line two.", { x: 50, y: 320, size: 12, font });
    page.drawText("Staggered left line three.", { x: 50, y: 280, size: 12, font });

    // Right: y = 340, 300, 260 (no shared baselines!)
    page.drawText("Staggered right line one.", { x: 320, y: 340, size: 12, font });
    page.drawText("Staggered right line two.", { x: 320, y: 300, size: 12, font });
    page.drawText("Staggered right line three.", { x: 320, y: 260, size: 12, font });

    await fs.writeFile(path.join(dir, "two-column-staggered.pdf"), await pdf.save());
  }

  // 3. three-column-unequal.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.drawText("Col one line one.", { x: 50, y: 350, size: 12, font });
    page.drawText("Col one line two.", { x: 50, y: 320, size: 12, font });
    page.drawText("Col one line three.", { x: 50, y: 290, size: 12, font });

    page.drawText("Col two line one.", { x: 230, y: 350, size: 12, font });
    page.drawText("Col two line two.", { x: 230, y: 320, size: 12, font });
    page.drawText("Col two line three.", { x: 230, y: 290, size: 12, font });

    page.drawText("Col three line one.", { x: 410, y: 350, size: 12, font });
    page.drawText("Col three line two.", { x: 410, y: 320, size: 12, font });
    page.drawText("Col three single line.", { x: 410, y: 290, size: 12, font });

    await fs.writeFile(path.join(dir, "three-column-unequal.pdf"), await pdf.save());
  }

  // 4. crossing-gutter-ambiguous.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.drawText("Left side line one.", { x: 50, y: 350, size: 12, font });
    page.drawText("Left side line two.", { x: 50, y: 320, size: 12, font });
    page.drawText("Right side line one.", { x: 320, y: 350, size: 12, font });
    page.drawText("Right side line two.", { x: 320, y: 320, size: 12, font });
    // Wide line invading the gutter on [180, 320]
    page.drawText("This wide line crosses across the entire page gutter horizontally.", { x: 50, y: 280, size: 12, font });

    await fs.writeFile(path.join(dir, "crossing-gutter-ambiguous.pdf"), await pdf.save());
  }

  // 5. heading-spanning.pdf (Bands -> Columns XY-cut)
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([600, 400]);
    // Full-width title spanning Band 0
    page.drawText("Full-Width Document Title Heading Spanning Content Width", { x: 50, y: 360, size: 16, font: boldFont });

    // Multi-column body in Band 1
    page.drawText("Column one text line one.", { x: 50, y: 300, size: 12, font });
    page.drawText("Column one text line two.", { x: 50, y: 270, size: 12, font });
    page.drawText("Column one text line three.", { x: 50, y: 240, size: 12, font });

    page.drawText("Column two text line one.", { x: 320, y: 300, size: 12, font });
    page.drawText("Column two text line two.", { x: 320, y: 270, size: 12, font });
    page.drawText("Column two text line three.", { x: 320, y: 240, size: 12, font });

    await fs.writeFile(path.join(dir, "heading-spanning.pdf"), await pdf.save());
  }

  // 6. cropbox-offset.pdf (Non-zero page view bounds)
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.setCropBox(50, 50, 500, 300); // [minX: 50, minY: 50, width: 500, height: 300] -> [50, 50, 550, 350]

    page.drawText("Offset col one line one.", { x: 80, y: 280, size: 12, font });
    page.drawText("Offset col one line two.", { x: 80, y: 250, size: 12, font });
    page.drawText("Offset col one line three.", { x: 80, y: 220, size: 12, font });

    page.drawText("Offset col two line one.", { x: 320, y: 280, size: 12, font });
    page.drawText("Offset col two line two.", { x: 320, y: 250, size: 12, font });
    page.drawText("Offset col two line three.", { x: 320, y: 220, size: 12, font });

    await fs.writeFile(path.join(dir, "cropbox-offset.pdf"), await pdf.save());
  }

  // 7. ambiguous-multicol-insufficient-evidence.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    // Line 1: multi-column evidence with gap on [170, 320]
    page.drawText("Left header text.", { x: 50, y: 350, size: 12, font });
    page.drawText("Right header text.", { x: 320, y: 350, size: 12, font });

    // Lines 2-4: single-column body text (occupies the width, but only 1 line above had gap)
    page.drawText("This is regular body text line one spanning across the middle.", { x: 50, y: 310, size: 12, font });
    page.drawText("This is regular body text line two spanning across the middle.", { x: 50, y: 280, size: 12, font });
    page.drawText("This is regular body text line three spanning across the middle.", { x: 50, y: 250, size: 12, font });

    await fs.writeFile(path.join(dir, "ambiguous-multicol-insufficient-evidence.pdf"), await pdf.save());
  }

  // 8. heading-between-multicolumn-bands.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([600, 500]);

    // Band 0: Multi-column intro (3 lines each)
    page.drawText("Intro col one line one.", { x: 50, y: 450, size: 12, font });
    page.drawText("Intro col one line two.", { x: 50, y: 430, size: 12, font });
    page.drawText("Intro col one line three.", { x: 50, y: 410, size: 12, font });

    page.drawText("Intro col two line one.", { x: 320, y: 450, size: 12, font });
    page.drawText("Intro col two line two.", { x: 320, y: 430, size: 12, font });
    page.drawText("Intro col two line three.", { x: 320, y: 410, size: 12, font });

    // Band 1: Spanning heading with large vertical clearance (y: 340 vs 410 = 70pt > 3 * 12pt)
    page.drawText("Intermediate Full-Width Section Header", { x: 50, y: 340, size: 16, font: boldFont });

    // Band 2: Multi-column body (3 lines each) with large clearance below header (y: 260 vs 340 = 80pt)
    page.drawText("Body col one line one.", { x: 50, y: 260, size: 12, font });
    page.drawText("Body col one line two.", { x: 50, y: 240, size: 12, font });
    page.drawText("Body col one line three.", { x: 50, y: 220, size: 12, font });

    page.drawText("Body col two line one.", { x: 320, y: 260, size: 12, font });
    page.drawText("Body col two line two.", { x: 320, y: 240, size: 12, font });
    page.drawText("Body col two line three.", { x: 320, y: 220, size: 12, font });

    await fs.writeFile(path.join(dir, "heading-between-multicolumn-bands.pdf"), await pdf.save());
  }

  // 9. rotated-90.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.setRotation(degrees(90));

    page.drawText("Rotated90 col one line one.", { x: 50, y: 350, size: 12, font });
    page.drawText("Rotated90 col one line two.", { x: 50, y: 330, size: 12, font });
    page.drawText("Rotated90 col one line three.", { x: 50, y: 310, size: 12, font });

    page.drawText("Rotated90 col two line one.", { x: 320, y: 350, size: 12, font });
    page.drawText("Rotated90 col two line two.", { x: 320, y: 330, size: 12, font });
    page.drawText("Rotated90 col two line three.", { x: 320, y: 310, size: 12, font });

    await fs.writeFile(path.join(dir, "rotated-90.pdf"), await pdf.save());
  }

  // 10. rotated-180.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.setRotation(degrees(180));

    page.drawText("Rotated180 col one line one.", { x: 50, y: 350, size: 12, font });
    page.drawText("Rotated180 col one line two.", { x: 50, y: 330, size: 12, font });
    page.drawText("Rotated180 col one line three.", { x: 50, y: 310, size: 12, font });

    page.drawText("Rotated180 col two line one.", { x: 320, y: 350, size: 12, font });
    page.drawText("Rotated180 col two line two.", { x: 320, y: 330, size: 12, font });
    page.drawText("Rotated180 col two line three.", { x: 320, y: 310, size: 12, font });

    await fs.writeFile(path.join(dir, "rotated-180.pdf"), await pdf.save());
  }

  // 11. rotated-270.pdf
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.setRotation(degrees(270));

    page.drawText("Rotated270 col one line one.", { x: 50, y: 350, size: 12, font });
    page.drawText("Rotated270 col one line two.", { x: 50, y: 330, size: 12, font });
    page.drawText("Rotated270 col one line three.", { x: 50, y: 310, size: 12, font });

    page.drawText("Rotated270 col two line one.", { x: 320, y: 350, size: 12, font });
    page.drawText("Rotated270 col two line two.", { x: 320, y: 330, size: 12, font });
    page.drawText("Rotated270 col two line three.", { x: 320, y: 310, size: 12, font });

    await fs.writeFile(path.join(dir, "rotated-270.pdf"), await pdf.save());
  }

  console.log("Successfully generated multi-column PDF fixtures");
}

main().catch((err) => {
  console.error("Fixture generation failed:", err);
  process.exit(1);
});

