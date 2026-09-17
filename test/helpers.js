import { classifyDocument } from '../src/classify.js';

export function makeDocument(filename, pages, options = {}) {
  const pageList = (Array.isArray(pages) ? pages : [pages]).map((text, index) => ({
    number: index + 1,
    text,
    nativeText: text,
    words: [],
    forms: [],
    formEntries: [],
    signatures: [],
    ocr: { used: false, reason: '' }
  }));
  return {
    filename,
    hash: options.hash ?? filename,
    size: options.size ?? pageList.reduce((sum, page) => sum + page.text.length, 0),
    pages: pageList,
    pageCount: pageList.length,
    hasAcroForm: false,
    signatureMetadata: options.signatureMetadata ?? [],
    kind: options.kind ?? classifyDocument(filename, pageList[0]?.text),
    cacheHit: false
  };
}

