import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { classifyDocument } from './classify.js';
import { isLikelyGarbled } from './validation.js';

globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// Session-only cache: transaction text must not be persisted into the Desktop's
// OneDrive folder. Clearing/restarting the service releases the cache.
const cache = new Map();
const CACHE_LIMIT = 64;
setInterval(() => {
  for (const [key, entry] of cache) if (Date.now() - entry.time > 30 * 60 * 1000) cache.delete(key);
}, 60_000).unref();
const MAX_OCR_PAGES_PER_FILE = 30;
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'application/json']);

let pdfjsPromise;
let ocrWorkerPromise;
let ocrQueue = Promise.resolve();

function pdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function ocrWorker() {
  if (!ocrWorkerPromise) {
    const languagePath = path.join(ROOT, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0');
    ocrWorkerPromise = createWorker('eng', 1, {
      langPath: languagePath,
      cacheMethod: 'readOnly',
      gzip: true,
      logger: () => {}
    });
  }
  return ocrWorkerPromise;
}

export async function shutdownOcr() {
  if (!ocrWorkerPromise) return;
  const worker = await ocrWorkerPromise;
  await worker.terminate();
  ocrWorkerPromise = null;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function readCache(hash) {
  const entry = cache.get(hash);
  if (!entry || Date.now() - entry.time > 30 * 60 * 1000) { cache.delete(hash); return null; }
  return structuredClone(entry.document);
}

async function writeCache(hash, document) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(hash, { time: Date.now(), document: structuredClone(document) });
}

function textItemsToPage(items) {
  const words = items
    .filter((item) => typeof item.str === 'string' && item.str.trim())
    .map((item) => ({
      text: item.str,
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
      width: Number(item.width ?? 0),
      height: Math.abs(Number(item.height ?? item.transform?.[3] ?? 0)),
      hasEOL: Boolean(item.hasEOL)
    }));

  const rows = [];
  for (const word of words.sort((a, b) => (b.y - a.y) || (a.x - b.x))) {
    let row = rows.find((candidate) => Math.abs(candidate.y - word.y) <= Math.max(2.5, word.height * 0.45));
    if (!row) {
      row = { y: word.y, words: [] };
      rows.push(row);
    }
    row.words.push(word);
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((row) => row.words.sort((a, b) => a.x - b.x).map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim());
  return { text: lines.filter(Boolean).join('\n'), words };
}

function formEntry(annotation) {
  const value = Array.isArray(annotation.fieldValue) ? annotation.fieldValue.join(', ') : annotation.fieldValue;
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return { fieldName: annotation.fieldName || 'unnamed', value: String(value).trim(), rect: annotation.rect ?? null };
}

function signatureMetadata(buffer) {
  const raw = buffer.toString('latin1');
  const results = [];
  const signatureObjects = raw.match(/\/Type\s*\/Sig\b[\s\S]{0,2500}/g) ?? [];
  for (const object of signatureObjects) {
    const timestamp = object.match(/\/M\s*\((D:[^)]*)\)/)?.[1] ?? '';
    const signer = object.match(/\/Name\s*\(([^)]*)\)/)?.[1] ?? '';
    if (timestamp || signer) results.push({ timestamp, signer });
  }
  return results;
}

function shouldOcr(page, pageNumber, pageCount) {
  const text = page.text.trim();
  if (/Listing Sales Associate/i.test(text) && /Buyer:|B\s*uyer:/i.test(text)) return 'final_contract_signatures';
  if (text.length < 80) return 'little_native_text';
  if (isLikelyGarbled(text)) return 'garbled_native_text';
  const signatureLike = /\b(signature|signed by|buyer:\s*date|seller:\s*date)\b/i.test(text);
  if (signatureLike && pageNumber >= Math.max(1, pageCount - 2) && !/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(text)) return 'signature_confirmation';
  return '';
}

async function renderPage(page, scale = 2) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return { canvas, viewport };
}

async function readSignatureDates(pdfPage, extracted, worker) {
  const { canvas, viewport } = await renderPage(pdfPage, 4);
  const entries = [];
  const labels = extracted.words.filter(word => /^Date:$/.test(word.text));
  for (const label of labels) {
    const role = extracted.words.find(word => /^(Buyer|Seller):$/.test(word.text) && Math.abs(word.y - label.y) < 3);
    if (!role) continue;
    const signer = extracted.words.filter(word => word.x > role.x + role.width && word.x < label.x && Math.abs(word.y - role.y) < 4 && /[A-Za-z]/.test(word.text)).sort((a,b) => a.x-b.x).map(word => word.text).join(' ');
    if (!signer) continue;
    const rect = [label.x + label.width + 1, label.y + 4, pdfPage.view[2] - 32, label.y + 24];
    const [a,b,c,d,e,f] = viewport.transform;
    const transform = (x,y) => [a*x+c*y+e,b*x+d*y+f];
    const corners = [transform(rect[0],rect[1]),transform(rect[2],rect[3])];
    const left = Math.min(...corners.map(point=>point[0]));
    const right = Math.max(...corners.map(point=>point[0]));
    const top = Math.min(...corners.map(point=>point[1]));
    const bottom = Math.max(...corners.map(point=>point[1]));
    const crop = createCanvas(Math.ceil(right-left), Math.ceil(bottom-top));
    const context = crop.getContext('2d');
    context.drawImage(canvas,left,top,right-left,bottom-top,0,0,crop.width,crop.height);
    // Form underlines overlap the scanned date stamps. Remove only long rules
    // spanning most of the crop; date glyphs never span this width.
    const pixels = context.getImageData(0,0,crop.width,crop.height);
    for (let y=0;y<crop.height;y++) {
      let dark=0;
      for(let x=0;x<crop.width;x++) if(pixels.data[(y*crop.width+x)*4]<150) dark++;
      if(dark>crop.width*0.8) for(let x=0;x<crop.width;x++) {
        const offset=(y*crop.width+x)*4;
        pixels.data[offset]=pixels.data[offset+1]=pixels.data[offset+2]=255;
      }
    }
    context.putImageData(pixels,0,0);
    const result = await worker.recognize(crop.toBuffer('image/png'), { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789/' });
    entries.push({ role: role.text.slice(0,-1), signer, text: result.data.text.trim(), rect });
  }
  return entries;
}

async function extractPdf(buffer, onProgress) {
  const { getDocument } = await pdfjs();
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  let ocrCount = 0;
  try {
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.({ stage: 'native_text', page: pageNumber, pages: pdf.numPages });
    const page = await pdf.getPage(pageNumber);
    const [content, annotations] = await Promise.all([
      page.getTextContent({ disableNormalization: false }),
      page.getAnnotations({ intent: 'display' }).catch(() => [])
    ]);
    const extracted = textItemsToPage(content.items);
    const formEntries = annotations.map(formEntry).filter(Boolean);
    const forms = formEntries.map((entry) => `[Form field ${entry.fieldName}]: ${entry.value}`);
    const signatures = annotations
      .filter((annotation) => annotation.fieldType === 'Sig' || /signature/i.test(annotation.fieldName ?? ''))
      .map((annotation) => ({ fieldName: annotation.fieldName ?? '', value: annotation.fieldValue ?? '', rect: annotation.rect ?? null }));
    if (forms.length) extracted.text = `${extracted.text}\n${forms.join('\n')}`.trim();
    extracted.nativeText = extracted.text;
    const reason = shouldOcr(extracted, pageNumber, pdf.numPages);
    if (reason && ocrCount < MAX_OCR_PAGES_PER_FILE) {
      onProgress?.({ stage: 'ocr', page: pageNumber, pages: pdf.numPages });
      // A Tesseract worker accepts one job at a time; serialize rendering too
      // to bound native image memory when several PDFs need OCR together.
      const operation = ocrQueue.then(async () => {
        const worker = await ocrWorker();
        if (reason === 'final_contract_signatures') {
          extracted.signatureDates = await readSignatureDates(page, extracted, worker);
          return { data: { text: '' } };
        }
        const { canvas } = await renderPage(page);
        return worker.recognize(canvas.toBuffer('image/png'), { tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
      });
      ocrQueue = operation.catch(() => {});
      const result = await operation;
      const ocrText = String(result.data?.text ?? '').trim();
      extracted.ocrText = ocrText;
      if (ocrText) extracted.text = extracted.text ? `${extracted.text}\n${ocrText}` : ocrText;
      extracted.ocr = { used: true, reason };
      ocrCount += 1;
    } else {
      extracted.ocr = { used: false, reason };
    }
    extracted.number = pageNumber;
    extracted.forms = forms;
    extracted.formEntries = formEntries;
    extracted.signatures = signatures;
    pages.push(extracted);
    page.cleanup();
  }
  return { pages, pageCount: pdf.numPages, hasAcroForm: pages.some((page) => page.forms.length), signatureMetadata: signatureMetadata(buffer) };
  } finally { await loadingTask.destroy(); }
}

function extractTextFile(buffer) {
  const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const pageParts = raw.split(/^=== PAGE \d+ ===\s*$/m);
  const pages = (pageParts.length > 1 ? pageParts.slice(1) : [raw]).map((text, index) => ({
    number: index + 1,
    text: text.trim(),
    nativeText: text.trim(),
    words: [],
    forms: [],
    formEntries: [],
    signatures: [],
    ocr: { used: false, reason: '' }
  }));
  return { pages, pageCount: pages.length, hasAcroForm: /=== ACROFORM FIELDS ===[\s\S]*?\S/.test(raw), signatureMetadata: [] };
}

export async function ingestFile(file, onProgress) {
  const hash = hashBuffer(file.buffer);
  const cached = await readCache(hash);
  if (cached) return { ...cached, filename: file.originalname, kind: classifyDocument(file.originalname, cached.pages[0]?.text ?? ''), cacheHit: true };

  const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
  const isText = TEXT_TYPES.has(file.mimetype) || /\.(txt|md|json)$/i.test(file.originalname);
  if (!isPdf && !isText) throw new Error(`${file.originalname}: only PDF and text files are supported.`);

  const extracted = isPdf ? await extractPdf(file.buffer, onProgress) : extractTextFile(file.buffer);
  const document = {
    filename: file.originalname,
    hash,
    size: file.buffer.length,
    ...extracted,
    kind: classifyDocument(file.originalname, extracted.pages[0]?.text ?? ''),
    cacheHit: false
  };
  await writeCache(hash, document);
  return document;
}

export async function ingestFiles(files, onProgress) {
  let completed = 0;
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(2, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      const document = await ingestFile(file, (event) => onProgress?.({ ...event, filename: file.originalname, completed, total: files.length }));
      completed += 1;
      onProgress?.({ stage: 'file_complete', filename: file.originalname, completed, total: files.length });
      results.push(document);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(item => item.status === 'rejected');
  if (failure) throw failure.reason;
  return results.sort((a, b) => a.filename.localeCompare(b.filename, 'en-US'));
}
