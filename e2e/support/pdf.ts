/**
 * A real, minimal, one-page PDF — built here rather than committed as a binary.
 *
 * The upload flow has to move actual bytes: `complete` verifies the object's size against storage
 * and refuses a mismatch, and the viewer has to hand something to pdf.js that parses. A fixture
 * file checked into the repo would do, but generating it means each test can vary the size and the
 * visible text, which is how the suite tells three simultaneous uploads apart on screen.
 *
 * The cross-reference table is written with real byte offsets. pdf.js will happily rebuild a broken
 * one, so a sloppy generator would pass the viewer test while producing a file no other reader
 * accepts — and "our own tests are the only thing that opens it" is not a property worth having.
 */

export function makePdf(text: string, padToBytes = 0): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const content = `BT /F1 18 Tf 24 120 Td (${escaped}) Tj ET\n`;

  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ` +
      `/Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];

  const header = '%PDF-1.4\n';
  const chunks: string[] = [header];
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, 'latin1');

  objects.forEach((body, index) => {
    const serialized = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(cursor);
    chunks.push(serialized);
    cursor += Buffer.byteLength(serialized, 'latin1');
  });

  // Padding lives in a comment so the file stays valid at any requested size — useful for the
  // over-the-cap rejection test, which needs a big file and does not care what is in it.
  if (padToBytes > 0) {
    const tail = 120 + offsets.length * 20; // rough size of xref + trailer, recomputed below anyway
    const padding = padToBytes - cursor - tail;
    if (padding > 0) {
      const comment = `%${'p'.repeat(padding - 2)}\n`;
      chunks.push(comment);
      cursor += Buffer.byteLength(comment, 'latin1');
    }
  }

  const xrefOffset = cursor;
  const entries = ['0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)];
  chunks.push(`xref\n0 ${objects.length + 1}\n${entries.join('')}`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(''), 'latin1');
}

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const pdfFile = (name: string, text = name, padToBytes = 0): UploadFile => ({
  name,
  mimeType: 'application/pdf',
  buffer: makePdf(text, padToBytes),
});

/** Not previewable, and deliberately so: the viewer must degrade, not embed something broken. */
export const textFile = (name: string, body = 'hello'): UploadFile => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(body, 'utf8'),
});
