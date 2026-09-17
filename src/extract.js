import { createSchema, foundField, sourceEvidence, verifyField } from './schema.js';
import { fieldPriority } from './classify.js';
import { parseSupplemental } from './supplemental.js';
import { cleanMoney, formatDate, latestDate, normalizeComparable, normalizePhone, validEmail, validPhone } from './validation.js';

function candidate(field, value, document, page, quote, method) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim().replace(/^[-–—]\s*/, '').replace(/\s*[|]+\s*$/, '');
  if (!cleaned || /^_+$/.test(cleaned)) return null;
  const firstWord = cleaned.split(/\s+/).find((part) => part.length > 2)?.toLowerCase();
  const word = firstWord ? page.words?.find((item) => item.text.toLowerCase().includes(firstWord)) : null;
  const form = page.formEntries?.find((entry) => entry.value.includes(cleaned) || cleaned.includes(entry.value));
  const bbox = form?.rect
    ? { x: form.rect[0], y: form.rect[1], width: form.rect[2] - form.rect[0], height: form.rect[3] - form.rect[1] }
    : word ? { x: word.x, y: word.y, width: word.width, height: word.height } : null;
  return {
    field,
    value: cleaned,
    kind: document.kind,
    priority: fieldPriority(document.kind, field),
    source: sourceEvidence({
      filename: document.filename,
      page: page.number,
      quote: quote || cleaned,
      bbox,
      method: method || (form ? 'form_field' : page.nativeText?.includes(cleaned) ? 'native_text' : page.ocr?.used ? 'ocr' : 'native_text')
    })
  };
}

function addMatch(list, field, document, page, regex, transform = (value) => value) {
  const match = page.text.match(regex);
  if (!match?.[1]) return;
  const value = transform(match[1], match);
  const item = candidate(field, value, document, page, match[0]);
  if (item) list.push(item);
}

function addAllMatches(list, field, document, page, regex, transform = (value) => value) {
  for (const match of page.text.matchAll(regex)) {
    if (!match[1]) continue;
    const item = candidate(field, transform(match[1], match), document, page, match[0]);
    if (item) list.push(item);
  }
}

function lineBefore(text, needle) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => line.includes(needle));
  if (index <= 0) return '';
  for (let i = index - 1; i >= Math.max(0, index - 4); i -= 1) {
    if (/^[A-Z][A-Za-z.' -]+(?:\s+[A-Z][A-Za-z.' -]+)+$/.test(lines[i]) && !/software|realtors|brokerage/i.test(lines[i])) return lines[i];
  }
  return '';
}

function pdfTimestampToDate(value) {
  const match = String(value).match(/^D:(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

function extractExecutedContract(document, list) {
  if (/FloridaRealtors\/FloridaBar-ASIS/i.test(document.pages[0]?.nativeText ?? '') && document.pages[0]?.words?.length) {
    extractFarBar(document, list);
    return;
  }
  for (const page of document.pages) {
    addMatch(list, 'property_address', document, page, /(?:Property Address|Real Property(?: located at)?):?\s*([^\n]+)/i);
    addMatch(list, 'client.name', document, page, /(?:Buyer(?:'s)? Name|Buyer):[ \t]*([A-Z][^\n]{2,80})/i, (value) => value.split(/\s{2,}|\bDate:/i)[0]);
    addMatch(list, 'other_side_agent.name', document, page, /(?:Listing Sales Associate|Listing Agent):[ \t]*([^\n]+)/i);
    addMatch(list, 'other_side_agent.brokerage', document, page, /(?:Listing Broker|Listing Office):[ \t]*([^\n]+)/i);
    addMatch(list, 'purchase_price', document, page, /Purchase Price(?:\s*\(U\.S\. currency\))?[^\n$]{0,120}\$?\s*([\d,]+(?:\.\d{1,2})?)/i, cleanMoney);
    addMatch(list, 'initial_deposit', document, page, /Initial deposit[^\n$]{0,140}\$?\s*([\d,]+(?:\.\d{1,2})?)/i, cleanMoney);
    addMatch(list, 'loan_amount', document, page, /(?:Loan Amount|Financing)[^\n$]{0,120}\$?\s*([\d,]+(?:\.\d{1,2})?)/i, cleanMoney);
    addMatch(list, 'closing_date', document, page, /Closing Date\)?\s*(?::|is|of)?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i, formatDate);
    addMatch(list, 'executed_date', document, page, /(?:Executed|Effective) Date:[ \t]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i, formatDate);
    addMatch(list, 'inspection_period', document, page, /(?:Inspection Period|inspection period)(?:\s*(?:is|of|:))?\s*(\d{1,2})\s*(?:calendar\s*)?days?/i, (value) => `${Number(value)} days`);
    addMatch(list, 'title.company', document, page, /Title Company:[ \t]*([^\n]+)/i);
    addMatch(list, 'title.contact', document, page, /Title Contact:[ \t]*([^\n]+)/i);
    addMatch(list, 'title.email', document, page, /Title E-?mail:[ \t]*([^\s\n]+@[^\s\n]+)/i);

    const titlePair = page.text.match(/\b([A-Z][A-Za-z.' -]{2,60}),\s{2,}([A-Z][A-Za-z&.' -]{2,80}(?:Agency|Company|LLC|Inc\.?))\b/);
    if (titlePair) {
      list.push(candidate('title.contact', titlePair[1], document, page, titlePair[0]));
      list.push(candidate('title.company', titlePair[2], document, page, titlePair[0]));
      const titleEmail = page.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      if (titleEmail) list.push(candidate('title.email', titleEmail, document, page, titleEmail));
    }

    addAllMatches(list, 'seller_credits', document, page, /(?:Seller(?: agrees)?(?: shall)?\s+(?:to\s+)?credit|seller credit(?:s)?(?: of|:)?)[^$\n]{0,80}(\$\s*[\d,]+(?:\.\d{1,2})?[^.\n]*)/gi, (value) => value.replace(/\btowards\b/i, 'toward').replace(/\band or\b/i, 'and/or').trim());
    addAllMatches(list, 'lender_credits', document, page, /(?:lender credit(?:s)?(?: of|:)?)[^$\n]{0,50}(\$\s*[\d,]+(?:\.\d{1,2})?[^.\n]*)/gi);

    const roof = page.text.match(/(?:Seller agrees to |seller (?:shall|to) )(install (?:a )?new roof (?:before|prior to) closing)/i);
    if (roof) list.push(candidate('other_notes', `Seller to ${roof[1].replace(/^install/, 'install')}`, document, page, roof[0]));
  }

  const signatureDates = document.signatureMetadata.map((signature) => pdfTimestampToDate(signature.timestamp)).filter(Boolean);
  if (signatureDates.length) {
    const value = formatDate(latestDate(signatureDates));
    const page = document.pages.at(-1);
    list.push(candidate('executed_date', value, document, page, `Latest PDF signature timestamp: ${value}`, 'signature_metadata'));
  } else {
    const first = document.pages[0];
    const dates = [...first.text.matchAll(/(?:^|\n)(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})(?=\n|$)/g)].map((match) => match[1]);
    if (dates.length) {
      const value = formatDate(latestDate(dates));
      list.push(candidate('executed_date', value, document, first, value));
    }
  }

  // Fallback for common Florida FAR/BAR flattened form values.
  const first = document.pages[0];
  if (first && /PURCHASE PRICE AND CLOSING/i.test(first.text)) {
    const afterLicense = first.text.split(/This software is licensed[^\n]*\n/i).at(-1) ?? '';
    const amounts = [...afterLicense.matchAll(/(?:^|\n)(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)(?=\n|$)/g)].map((match) => cleanMoney(match[1]));
    if (amounts[0]) list.push(candidate('purchase_price', amounts[0], document, first, amounts[0]));
    if (amounts[1]) list.push(candidate('initial_deposit', amounts[1], document, first, amounts[1]));
    if (amounts[2]) list.push(candidate('loan_amount', amounts[2], document, first, amounts[2]));
  }
  const second = document.pages[1];
  if (second && /Closing Date/i.test(second.text)) {
    const dates = [...second.text.matchAll(/(?:^|\n)(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})(?=\n|$)/g)].map((match) => match[1]);
    if (dates.length) list.push(candidate('closing_date', formatDate(dates[0]), document, second, dates[0]));
  }
  for (const page of document.pages) {
    if (/PROPERTY INSPECTION; RIGHT TO CANCEL/i.test(page.text)) {
      const tail = page.text.split(/This software is licensed[^\n]*\n/i).at(-1) ?? '';
      const standalone = [...tail.matchAll(/(?:^|\n)(\d{1,2})(?=\n|$)/g)].map((match) => Number(match[1])).find((number) => number >= 1 && number <= 30);
      if (standalone) list.push(candidate('inspection_period', `${standalone} days`, document, page, `${standalone}`));
    }
  }
}

// This form's flattened fill-ins and printed labels have different baselines.
// Restrict retrieval to the actual form section and use geometry for broker names.
function extractFarBar(document, list) {
  for (const original of document.pages) {
    const page = { ...original, text: original.nativeText };
    addMatch(list, 'property_address', document, page, /Street address, city, zip:[ \t]*([^\n]+)/i);
    addMatch(list, 'client.name', document, page, /^\d*[ \t]*and[ \t]+(.+?)[ \t]*\(["“]Buyer["”]\)/im);
    addMatch(list, 'purchase_price', document, page, /PURCHASE PRICE \(U\.S\. currency\):[^\n$]*\$[ \t]*([\d,]+\.\d{2})/i, cleanMoney);
    addMatch(list, 'initial_deposit', document, page, /Initial deposit[^\n$]*\$[ \t]*([\d,]+\.\d{2})/i, cleanMoney);
    addMatch(list, 'loan_amount', document, page, /\(c\) Financing:[^\n]*?[ \t]([\d,]+\.\d{2})[ \t]*$/im, cleanMoney);
    addMatch(list, 'closing_date', document, page, /Closing shall occur on[^\n]*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i, formatDate);
    addMatch(list, 'inspection_period', document, page, /Buyer shall have[^\n]*?\(if left blank, then \d+\)[ \t]+(\d+)[ \t]*$/im, value => `${value} days`);
    const escrow = page.text.match(/Escrow Agent Name:[ _\t]*([^\n]+),[ \t]+([^\n]+)/i);
    if (escrow) {
      list.push(candidate('title.contact', escrow[1], document, page, escrow[0]));
      list.push(candidate('title.company', escrow[2], document, page, escrow[0]));
      const region = page.text.slice(escrow.index, escrow.index + 550);
      const email = region.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      if (email) list.push(candidate('title.email', email, document, page, email));
    }
    for (const [label, field] of [['Listing Sales Associate','other_side_agent.name'],['Listing Broker','other_side_agent.brokerage']]) {
      const anchor = page.words.find(word => word.text.trim() === label);
      if (!anchor) continue;
      const tokens = page.words.filter(word => word.x >= anchor.x-1 && word.y > anchor.y+2 && word.y < anchor.y+20 && /[A-Za-z]/.test(word.text)).sort((a,b) => a.x-b.x);
      const name = tokens.map(word => word.text).join(' ');
      if (name) list.push(candidate(field, name, document, page, `${name} | ${label}`));
    }
    // Only date stamps beside populated Buyer/Seller signature rows count.
    const dates = (page.signatureDates ?? []).filter(entry => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(entry.text));
    if (dates.length && dates.length === page.signatureDates.length && dates.some(entry => entry.role === 'Buyer') && dates.some(entry => entry.role === 'Seller')) {
      const latest = latestDate(dates.map(entry => entry.text));
      const selected = dates.find(entry => entry.text === latest);
      const item = candidate('executed_date', formatDate(latest), document, page, `${selected.role}: ${selected.signer} | ${selected.text}`, 'ocr');
      item.source.bbox = { x:selected.rect[0], y:selected.rect[1], width:selected.rect[2]-selected.rect[0], height:selected.rect[3]-selected.rect[1] };
      list.push(item);
    }
  }
}

function extractMls(document, list) {
  for (const page of document.pages) {
    addMatch(list, 'property_address', document, page, /(?:^|\n)\s*(\d{1,6}\s+[A-Z0-9 .'-]+(?:STREET|ST|ROAD|RD|AVENUE|AVE|DRIVE|DR|LANE|LN|COURT|CT)[, ]+[^\n]{3,80})/im, (value) => value.replace(/\s+/g, ' '));
    addMatch(list, 'other_side_agent.name', document, page, /List Agent:[ \t]*(.+?)[ \t]+List Agent ID:/i);
    addMatch(list, 'other_side_agent.phone', document, page, /List Agent Direct:[ \t]*([^\s\n]+)/i);
    addMatch(list, 'other_side_agent.email', document, page, /List Agent E-?mail:[ \t]*([^\s\n]+)/i);
    addMatch(list, 'other_side_agent.brokerage', document, page, /List Office:[ \t]*(.+?)[ \t]+List Office ID:/i);
    addMatch(list, 'property_access', document, page, /Showing Instructions:[ \t]*([^\n]+)/i);
    addMatch(list, 'title.contact', document, page, /Closing Agent Name:[ \t]*(.+?)(?:[ \t]+Phone:|\n)/i);
    addMatch(list, 'title.email', document, page, /(?:Closing Agent[\s\S]{0,250}?)Email:[ \t]*([^\s\n]+)/i);
    addMatch(list, 'title.phone', document, page, /Closing Agent Name:[^\n]*?Phone:[ \t]*([^\s\n]+)/i);
    addMatch(list, 'title.company', document, page, /Closing Company Name:[ \t]*([^\n]+)/i);
    addMatch(list, 'closing_date', document, page, /Exp Clsg Date:[ \t]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i, formatDate);
  }
}

function extractBuyerBroker(document, list) {
  for (const page of document.pages) {
    addMatch(list, 'client.name', document, page, /Consumer Name:[ \t]*([^\n]+)/i, (value) => value.replace(/_+/g, '').trim());
    addMatch(list, 'client.phone', document, page, /(?:Telephone|Consumer Phone):[ \t]*([()+.\-\d \t]{7,25})/i);
    addMatch(list, 'client.email', document, page, /(?:Consumer Email|Email):[ \t]*([^\s\n]+@[^\s\n]+)/i);
    const emails = [...page.text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]);
    for (const email of emails) {
      if (!/floridarealtors|transactiondesk/i.test(email)) {
        list.push(candidate('client.email', email, document, page, email));
        const possibleName = lineBefore(page.text, email);
        if (possibleName) list.push(candidate('client.name', possibleName, document, page, possibleName));
      }
    }
  }
}

function extractPreapproval(document, list) {
  for (const page of document.pages) {
    addMatch(list, 'lender.name', document, page, /(?:Loan Officer|Lender(?: Name)?|Mortgage Consultant):[ \t]*([^\n]+)/i);
    addMatch(list, 'lender.company', document, page, /(?:Lender Company|Company):[ \t]*([^\n]+)/i);
    addMatch(list, 'lender.phone', document, page, /(?:Loan Officer Phone|Lender Phone|Phone):[ \t]*([()+.\-\d \t]{7,25})/i);
    addMatch(list, 'lender.email', document, page, /(?:Loan Officer Email|Lender Email|Email):[ \t]*([^\s\n]+@[^\s\n]+)/i);
    addMatch(list, 'lender_credits', document, page, /Lender Credit(?:s)?(?: of|:)?\s*(\$\s*[\d,]+(?:\.\d{1,2})?[^.\n]*)/i);
  }
}

function extractInspection(document, list) {
  for (const page of document.pages) {
    const appointment = page.text.match(/(?:inspection )?(?:appointment|scheduled)(?:\s+for|:)?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|AM|PM)?)/i);
    if (appointment) {
      list.push(candidate('inspection_appointment.date', formatDate(appointment[1]), document, page, appointment[0]));
      list.push(candidate('inspection_appointment.time', appointment[2].trim(), document, page, appointment[0]));
    }
    addMatch(list, 'inspection_appointment.inspector_name', document, page, /Inspector(?: Name)?:[ \t]*([^\n]+)/i);
    addMatch(list, 'inspection_appointment.inspector_phone', document, page, /Inspector Phone:[ \t]*([()+.\-\d \t]{7,25})/i);
  }
}

function extractTitle(document, list) {
  for (const page of document.pages) {
    addMatch(list, 'title.company', document, page, /(?:Title Company|Closing Company):[ \t]*([^\n]+)/i);
    addMatch(list, 'title.contact', document, page, /(?:Title Contact|Closing Agent):[ \t]*([^\n]+)/i);
    addMatch(list, 'title.phone', document, page, /(?:Title Phone|Closing Agent Phone):[ \t]*([()+.\-\d \t]{7,25})/i);
    addMatch(list, 'title.email', document, page, /(?:Title Email|Closing Agent Email):[ \t]*([^\s\n]+@[^\s\n]+)/i);
  }
}

function extractOtherDocument(document, list) {
  for (const page of document.pages) {
    addMatch(list, 'referral_fee', document, page, /Referral Fee:[ \t]*([^\n]+)/i);
    addMatch(list, 'lead_source', document, page, /Lead Source:[ \t]*([^\n]+)/i);
    if (['addendum', 'rider'].includes(document.kind)) {
      addMatch(list, 'closing_date', document, page, /Closing Date(?: is|:)[ \t]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i, formatDate);
      addMatch(list, 'inspection_period', document, page, /Inspection Period(?: is|:)[ \t]*(\d{1,2})[ \t]*(?:calendar[ \t]*)?days?/i, (value) => `${Number(value)} days`);
    }
    const tcName = page.text.match(/Transaction Coordinator(?: Name)?:[ \t]*([^\n]+)/i)?.[1]?.trim() ?? '';
    const tcEmail = page.text.match(/Transaction Coordinator Email:[ \t]*([^\s\n]+@[^\s\n]+)/i)?.[1]?.trim() ?? '';
    if (tcName || tcEmail) {
      const quote = [tcName && `Transaction Coordinator: ${tcName}`, tcEmail && `Transaction Coordinator Email: ${tcEmail}`].filter(Boolean).join(' | ');
      list.push({
        field: 'transaction_coordinators',
        value: { name: tcName, email: tcEmail },
        kind: document.kind,
        priority: fieldPriority(document.kind, 'transaction_coordinators'),
        source: sourceEvidence({ filename: document.filename, page: page.number, quote, method: page.ocr?.used && !page.nativeText?.includes(tcName || tcEmail) ? 'ocr' : 'native_text' })
      });
    }
    const roof = page.text.match(/Seller agrees to (install (?:a )?new roof (?:before|prior to) closing)/i);
    if (roof) list.push(candidate('other_notes', `Seller to ${roof[1]}`, document, page, roof[0]));
    addAllMatches(list, 'seller_credits', document, page, /Seller(?: agrees)?(?: shall)?\s+(?:to\s+)?credit[^$\n]{0,80}(\$\s*[\d,]+(?:\.\d{1,2})?[^.\n]*)/gi, (value) => value.replace(/\btowards\b/i, 'toward').replace(/\band or\b/i, 'and/or').trim());
    addAllMatches(list, 'lender_credits', document, page, /Lender Credit(?:s)?(?: of|:)?[ \t]*(\$\s*[\d,]+(?:\.\d{1,2})?[^.\n]*)/gi);
  }
}

export function collectCandidates(documents, supplemental = '') {
  const list = parseSupplemental(supplemental).map((item) => ({ ...item, priority: fieldPriority('supplemental', item.field) }));
  for (const document of documents) {
    if (document.kind === 'executed_contract') extractExecutedContract(document, list);
    if (document.kind === 'mls') extractMls(document, list);
    if (document.kind === 'buyer_broker_agreement') extractBuyerBroker(document, list);
    if (document.kind === 'preapproval') extractPreapproval(document, list);
    if (document.kind === 'inspection_confirmation') extractInspection(document, list);
    if (document.kind === 'title_document') extractTitle(document, list);
    extractOtherDocument({ ...document, pages: document.pages.map(page => ({ ...page, text: page.nativeText || page.text })) }, list);
  }
  return list.filter(Boolean);
}

function fieldNormalizer(field, value) {
  if (/email/.test(field)) return String(value).toLowerCase();
  if (/phone/.test(field)) return normalizePhone(value);
  if (/_date$|executed_date|closing_date/.test(field)) return formatDate(value);
  if (/price|deposit|amount/.test(field)) return cleanMoney(value);
  return normalizeComparable(value);
}

function cleanFieldValue(field, value) {
  if (/email/.test(field)) return validEmail(value) ? String(value).trim() : '';
  if (/phone/.test(field)) return validPhone(value) ? String(value).trim() : '';
  if (/_date$|executed_date|closing_date/.test(field)) return formatDate(value);
  if (['purchase_price', 'initial_deposit', 'loan_amount'].includes(field)) return cleanMoney(value);
  return String(value).trim();
}

function resolveOne(field, candidates) {
  const matching = candidates.filter((item) => item.field === field && cleanFieldValue(field, item.value));
  if (!matching.length) return null;
  const bestPriority = Math.min(...matching.map((item) => item.priority));
  let best = matching.filter((item) => item.priority === bestPriority);
  if (field === 'executed_date' && bestPriority > 0) {
    const latest = formatDate(latestDate(best.map((item) => item.value)));
    best = best.filter((item) => formatDate(item.value) === latest);
  }
  const groups = new Map();
  for (const item of best) {
    const normalized = fieldNormalizer(field, item.value);
    if (!normalized) continue;
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(item);
  }
  if (groups.size > 1) return verifyField(best.map((item) => item.source));
  const selected = best[0];
  return foundField(cleanFieldValue(field, selected.value), best.map((item) => item.source)[0]);
}

function applyResolved(schema, candidates, path, target, key) {
  const resolved = resolveOne(path, candidates);
  if (resolved) target[key] = resolved;
}

function distinctFoundItems(candidates, field, mapping) {
  const matching = candidates.filter((item) => item.field === field).sort((a, b) => a.priority - b.priority);
  const seen = new Set();
  const result = [];
  for (const item of matching) {
    const mapped = mapping(item);
    const identity = mapped?.value !== undefined
      ? mapped.value
      : [mapped?.name?.value ?? '', mapped?.email?.value ?? ''].join('|');
    const normalized = normalizeComparable(identity);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(mapped);
  }
  return result;
}

export function resolveSchema(documents, supplemental = '') {
  const schema = createSchema();
  const candidates = collectCandidates(documents, supplemental);

  const simple = ['property_address', 'lead_source', 'referral_fee', 'property_access', 'executed_date', 'purchase_price', 'initial_deposit', 'loan_amount', 'closing_date', 'inspection_period', 'seller_credits', 'lender_credits'];
  for (const field of simple) applyResolved(schema, candidates, field, schema, field);

  for (const key of ['name', 'brokerage', 'phone', 'email']) applyResolved(schema, candidates, `other_side_agent.${key}`, schema.other_side_agent, key);
  for (const key of ['name', 'company', 'phone', 'email']) applyResolved(schema, candidates, `lender.${key}`, schema.lender, key);
  for (const key of ['company', 'phone']) applyResolved(schema, candidates, `title.${key}`, schema.title, key);
  for (const key of ['date', 'time', 'inspector_name', 'inspector_phone']) applyResolved(schema, candidates, `inspection_appointment.${key}`, schema.inspection_appointment, key);

  const client = { name: resolveOne('client.name', candidates) ?? createSchema().property_address, phone: resolveOne('client.phone', candidates) ?? createSchema().property_address, email: resolveOne('client.email', candidates) ?? createSchema().property_address };
  if ([client.name, client.phone, client.email].some((field) => field.status !== 'BLANK')) schema.clients.push(client);

  schema.title.contacts = distinctFoundItems(candidates, 'title.contact', (item) => foundField(item.value, item.source));
  schema.title.emails = distinctFoundItems(candidates.filter((item) => validEmail(item.value)), 'title.email', (item) => foundField(item.value, item.source));
  schema.transaction_coordinators = distinctFoundItems(candidates, 'transaction_coordinators', (item) => ({
    name: item.value.name ? foundField(item.value.name, item.source) : createSchema().property_address,
    email: item.value.email && validEmail(item.value.email) ? foundField(item.value.email, item.source) : createSchema().property_address
  }));
  schema.other_notes = distinctFoundItems(candidates, 'other_notes', (item) => foundField(item.value.replace(/[.\s]+$/, ''), item.source));

  schema.full_mls_uploaded = documents.some((document) => document.kind === 'mls');
  schema.preapproval_uploaded = documents.some((document) => document.kind === 'preapproval');
  schema._presence_evidence.mls = documents.filter((document) => document.kind === 'mls').map((document) => sourceEvidence({ filename: document.filename, page: 1, quote: 'MLS document uploaded', method: 'document_presence' }));
  schema._presence_evidence.preapproval = documents.filter((document) => document.kind === 'preapproval').map((document) => sourceEvidence({ filename: document.filename, page: 1, quote: 'Preapproval document uploaded', method: 'document_presence' }));

  // Semantic guard: an appointment is emitted only when both date and time survive validation.
  if (schema.inspection_appointment.date.status !== 'FOUND' || schema.inspection_appointment.time.status !== 'FOUND') {
    schema.inspection_appointment.date = createSchema().property_address;
    schema.inspection_appointment.time = createSchema().property_address;
  }
  return { schema, candidates };
}

export function verificationFields(schema) {
  const results = [];
  function visit(value, path = '') {
    if (!value || typeof value !== 'object') return;
    if (value.status === 'VERIFY') {
      results.push({ field: path, sources: value.sources });
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else for (const [key, child] of Object.entries(value)) if (!key.startsWith('_')) visit(child, path ? `${path}.${key}` : key);
  }
  visit(schema);
  return results;
}
