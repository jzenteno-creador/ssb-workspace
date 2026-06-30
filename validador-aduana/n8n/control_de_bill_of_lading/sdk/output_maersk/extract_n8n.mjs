// Réplica EXACTA del extractDataFromPDF de n8n-nodes-base (utils/binary.ts):
// pdfjs-dist legacy + parseText (newline cuando cambia transform[5]) + páginas unidas con '\n\n'.
import fs from 'fs';
import { default as DOMMatrix } from '@thednp/dommatrix';
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = DOMMatrix;
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const parseText = (textContent) => {
  let lastY = undefined;
  const text = [];
  for (const item of textContent.items) {
    if ('str' in item) {
      if (lastY == item.transform[5] || !lastY) text.push(item.str);
      else text.push(`\n${item.str}`);
      lastY = item.transform[5];
    }
  }
  return text.join('');
};

const [, , inPdf, outTxt] = process.argv;
const data = new Uint8Array(fs.readFileSync(inPdf));
const doc = await getDocument({ isEvalSupported: false, data }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  pages.push(parseText(await page.getTextContent()));
}
fs.writeFileSync(outTxt, pages.join('\n\n'));
console.log(`${inPdf} → ${outTxt}: ${doc.numPages} páginas, ${pages.join('\n\n').length} chars`);
