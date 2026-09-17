import { ingestFiles } from './ingest.js';
import { resolveSchema, verificationFields } from './extract.js';
import { renderEmail } from './renderer.js';

process.on('message', async ({ files, supplemental }) => {
  try {
    const documents = await ingestFiles(files.map(file => ({ ...file, buffer: Buffer.from(file.buffer) })), event => {
      process.send?.({ type: 'progress', message: event.stage === 'ocr'
        ? `Reading scanned text in ${event.filename}, page ${event.page}...`
        : `Reading documents (${event.completed} of ${event.total})...` });
    });
    process.send?.({ type: 'progress', message: 'Checking signatures and source precedence...' });
    const { schema } = resolveSchema(documents, supplemental);
    process.send?.({ type: 'result', email: renderEmail(schema), schema, verification: verificationFields(schema), summary: {
      documents: documents.length, pages: documents.reduce((sum, doc) => sum + doc.pageCount, 0),
      cacheHits: documents.filter(doc => doc.cacheHit).length,
      ocrPages: documents.flatMap(doc => doc.pages).filter(page => page.ocr?.used).length
    } });
  } catch {
    process.send?.({ type: 'error', message: 'A document could not be read. Check that the PDFs open normally and are not password protected, then retry.' });
  }
});
process.on('disconnect', () => process.exit(0));
