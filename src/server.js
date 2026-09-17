import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { processPacket, stopReader } from './worker-host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.CONTRACT_INTAKE_PORT || 4317);
const jobs = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 35, fileSize: 30 * 1024 * 1024, fields: 4, fieldSize: 256 * 1024 }
});

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const remote = req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return res.status(403).send('Local access only.');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.static(PUBLIC, { index: 'index.html', etag: false, maxAge: 0 }));

function sendEvent(res, event) {
  if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, localOnly: true, app: 'contract-intake', version: '1.0.1' }));

app.post('/api/cancel/:jobId', express.json({ limit: '1kb' }), (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (job) job.abort();
  res.json({ cancelled: Boolean(job) });
});

app.post('/api/extract', upload.array('documents', 35), async (req, res) => {
  const jobId = String(req.body.jobId || crypto.randomUUID());
  const job = new AbortController();
  jobs.set(jobId, job);
  res.status(200);
  res.type('application/x-ndjson; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const disconnected = () => { if (!res.writableEnded) job.abort(); };
  res.on('close', disconnected);
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write('\n'); }, 5000);

  try {
    const files = req.files ?? [];
    if (!files.length) throw new Error('Choose at least one PDF or text document.');
    if (files.reduce((sum, file) => sum + file.size, 0) > 120 * 1024 * 1024) throw new Error('This packet is larger than 120 MB. Please use fewer files.');
    sendEvent(res, { type: 'progress', message: `Reading ${files.length} file${files.length === 1 ? '' : 's'}...` });
    const result = await processPacket(files, String(req.body.supplemental ?? ''), event => sendEvent(res, event), job.signal);
    sendEvent(res, { ...result, jobId });
  } catch (error) {
    sendEvent(res, { type: error.code === 'CANCELLED' ? 'cancelled' : 'error', message: error.code === 'CANCELLED' ? 'Extraction cancelled.' : (error.message || 'The packet could not be read.') });
  } finally {
    clearInterval(heartbeat);
    res.off('close', disconnected);
    jobs.delete(jobId);
    res.end();
  }
});

app.use((error, _req, res, _next) => {
  const message = error instanceof multer.MulterError
    ? (error.code === 'LIMIT_FILE_SIZE' ? 'One document is larger than 30 MB.' : 'Too many or invalid uploaded documents.')
    : 'The request could not be processed.';
  if (!res.headersSent) res.status(400).json({ error: message });
  else res.end();
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Contract Intake is ready at http://${HOST}:${server.address().port}`);
});

async function stop() {
  server.close();
  stopReader();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
