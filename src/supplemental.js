import { sourceEvidence } from './schema.js';

const LABELS = new Map([
  ['property address', 'property_address'],
  ['buyer', 'client.name'], ['client', 'client.name'], ['buyer name', 'client.name'], ['client name', 'client.name'],
  ['buyer phone', 'client.phone'], ['client phone', 'client.phone'],
  ['buyer email', 'client.email'], ['client email', 'client.email'],
  ['listing agent', 'other_side_agent.name'], ['other side agent', 'other_side_agent.name'], ['cooperating agent', 'other_side_agent.name'],
  ['agent brokerage', 'other_side_agent.brokerage'], ['listing brokerage', 'other_side_agent.brokerage'],
  ['agent phone', 'other_side_agent.phone'], ['listing agent phone', 'other_side_agent.phone'],
  ['agent email', 'other_side_agent.email'], ['listing agent email', 'other_side_agent.email'],
  ['tc', 'tc'], ['transaction coordinator', 'tc'],
  ['lender', 'lender.name'], ['lender name', 'lender.name'], ['loan officer', 'lender.name'],
  ['lender company', 'lender.company'], ['lender phone', 'lender.phone'], ['lender email', 'lender.email'],
  ['title company', 'title.company'], ['title contact', 'title.contact'], ['title phone', 'title.phone'], ['title email', 'title.email'],
  ['inspection date', 'inspection_appointment.date'], ['inspection time', 'inspection_appointment.time'],
  ['inspector', 'inspection_appointment.inspector_name'], ['inspector name', 'inspection_appointment.inspector_name'],
  ['inspector phone', 'inspection_appointment.inspector_phone'],
  ['lead source', 'lead_source'], ['referral fee', 'referral_fee'], ['property access', 'property_access'], ['access', 'property_access'],
  ['executed date', 'executed_date'], ['effective date', 'executed_date'],
  ['purchase price', 'purchase_price'], ['initial deposit', 'initial_deposit'], ['loan amount', 'loan_amount'], ['closing date', 'closing_date'],
  ['inspection period', 'inspection_period'], ['seller credit', 'seller_credits'], ['seller credits', 'seller_credits'],
  ['lender credit', 'lender_credits'], ['lender credits', 'lender_credits'], ['note', 'note'], ['notes', 'note']
]);

export function parseSupplemental(text) {
  const candidates = [];
  const unlabeled = [];
  const source = (quote) => sourceEvidence({ filename: 'Supplemental verified details', page: 1, quote, method: 'supplemental' });

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([^:]{1,40}):\s*(.+)$/);
    const field = match ? LABELS.get(match[1].trim().toLowerCase()) : null;
    if (!field) {
      unlabeled.push(line);
      continue;
    }
    const value = match[2].trim();
    if (field === 'tc') {
      const [name = '', email = ''] = value.split(/\s*[|;,]\s*/, 2);
      candidates.push({ field: 'transaction_coordinators', value: { name, email }, kind: 'supplemental', source: source(line) });
    } else if (field === 'note') {
      candidates.push({ field: 'other_notes', value, kind: 'supplemental', source: source(line) });
    } else {
      candidates.push({ field, value, kind: 'supplemental', source: source(line) });
    }
  }

  if (unlabeled.length) {
    const value = unlabeled.join(' ');
    candidates.push({ field: 'other_notes', value, kind: 'supplemental', source: source(value) });
  }
  return candidates;
}

