export function classifyDocument(filename, firstPageText = '') {
  const name = String(filename).replace(/[_-]+/g, ' ').toLowerCase();
  const text = String(firstPageText).slice(0, 6000).toLowerCase();
  const either = `${name}\n${text}`;

  if (/pre[ -]?approval|prequalified|pre-qualified/.test(either)) return 'preapproval';
  if (/inspection (appointment|confirmation)|appointment confirmation/.test(either)) return 'inspection_confirmation';
  if (/\bmls\b/.test(name) || (text.includes('realtor information') && /list agent|list office/.test(text)) || text.includes('cross property 360 property view')) return 'mls';
  if (/buyer brokerage agreement|exclusive buyer broker/.test(either)) return 'buyer_broker_agreement';
  if (/\bexecuted\b/.test(name) && /contract|purchase/.test(name)) return 'executed_contract';
  if (/\baddendum\b/.test(either)) return 'addendum';
  if (/\bdisclosure\b|\bnotice\b/.test(name) || /lead-based paint disclosure/.test(text)) return 'disclosure';
  if (/\brider\b|buyers broker compensation|buyer broker compensation/.test(either)) return 'rider';
  if (/as is residential contract|contract for sale and purchase/.test(text)) return 'executed_contract';
  if (/title commitment|closing protection letter/.test(either) || (/title (?:&|and) escrow/.test(name) && !/contract/.test(name))) return 'title_document';
  if (/\bdisclosure\b|\bnotice\b/.test(either)) return 'disclosure';
  return 'other';
}

export const BASE_PRIORITY = Object.freeze({
  supplemental: 0,
  executed_contract: 10,
  addendum: 20,
  rider: 20,
  preapproval: 30,
  mls: 40,
  buyer_broker_agreement: 50,
  inspection_confirmation: 50,
  title_document: 50,
  disclosure: 60,
  other: 70
});

export function fieldPriority(kind, field) {
  if (kind === 'supplemental') return 0;
  if (field.startsWith('inspection_appointment.') && kind === 'inspection_confirmation') return 10;
  if (field.startsWith('lender.') && kind === 'preapproval') return 10;
  if ((field.startsWith('title.') || field === 'property_access') && kind === 'mls') return 30;
  if (field.startsWith('title.') && kind === 'title_document') return 10;
  if ((field.startsWith('other_side_agent.phone') || field.startsWith('other_side_agent.email')) && kind === 'mls') return 10;
  if (field === 'other_side_agent.name' && kind === 'executed_contract') return 10;
  if (field === 'property_address' && kind === 'executed_contract') return 10;
  if (['seller_credits', 'closing_date', 'inspection_period'].includes(field) && ['addendum', 'rider'].includes(kind)) return 9;
  return BASE_PRIORITY[kind] ?? 70;
}
