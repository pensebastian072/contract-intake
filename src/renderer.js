import { formatDate, parseDate } from './validation.js';

function value(field) {
  return field?.status === 'FOUND' ? field.value : '';
}

function compact(parts, separator = '   ') {
  return parts.map((part) => String(part ?? '').trim()).filter(Boolean).join(separator);
}

function isToday(dateValue, now) {
  const date = parseDate(dateValue);
  return Boolean(date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate());
}

export function buildImportantNotes(schema) {
  const notes = [];
  const ordered = [
    ['Purchase price', schema.purchase_price],
    ['Initial deposit', schema.initial_deposit],
    ['Loan amount', schema.loan_amount],
    ['Closing date', schema.closing_date],
    ['Inspection period', schema.inspection_period],
    ['Seller credit', schema.seller_credits],
    ['Lender credit', schema.lender_credits]
  ];
  for (const [label, field] of ordered) {
    if (field?.status === 'FOUND' && field.value) notes.push(`${label}: ${field.value}`);
  }
  for (const note of schema.other_notes ?? []) {
    if (note?.status === 'FOUND' && note.value) notes.push(note.value.replace(/[.;\s]+$/, ''));
  }
  return notes.length ? `${notes.join('; ')}.` : '';
}

export function renderEmail(schema, now = new Date()) {
  const clientLines = (schema.clients ?? [])
    .map((client) => `  ${compact([value(client.name), value(client.phone), value(client.email)])}`.trimEnd())
    .filter((line) => line.trim());
  if (!clientLines.length) clientLines.push('  ');

  const agentLines = [
    `  ${compact([value(schema.other_side_agent.name), value(schema.other_side_agent.phone), value(schema.other_side_agent.email)])}`.trimEnd()
  ];
  for (const tc of schema.transaction_coordinators ?? []) {
    const name = value(tc.name) || 'TC';
    const email = value(tc.email);
    if (name || email) agentLines.push(`  ${compact([name, email])}`.trimEnd());
  }

  const titleContacts = (schema.title.contacts ?? []).map(value).filter(Boolean).join(', ');
  const titleEmails = (schema.title.emails ?? []).map(value).filter(Boolean).join(', ');
  const appointmentDate = value(schema.inspection_appointment.date);
  const appointmentTime = value(schema.inspection_appointment.time);
  const appointment = appointmentDate && appointmentTime
    ? `${formatDate(appointmentDate)} at ${appointmentTime}${isToday(appointmentDate, now) ? ' (Today)' : ''}`
    : '';

  return [
    'Good Morning Joe,',
    '',
    'A new buyer contract is attached. Thanks in advance!',
    '',
    '- Contracts and any addenda: **Attached**',
    '- Contact information for your clients:',
    ...clientLines,
    '- Contact information for the cooperating agent on the other side:',
    ...agentLines,
    `- Lender info: ${compact([value(schema.lender.name), value(schema.lender.company)], ', ')}${(value(schema.lender.name) || value(schema.lender.company)) && value(schema.lender.phone) ? '  ' : ''}${value(schema.lender.phone)}`.trimEnd(),
    '- Title Info:',
    `  ${compact([value(schema.title.company), titleContacts], '- ')}${(value(schema.title.company) || titleContacts) && value(schema.title.phone) ? ' ' : ''}${value(schema.title.phone)}`.trimEnd(),
    `  ${titleEmails}`.trimEnd(),
    `- If buyer - Inspections scheduled for ${appointment}`.trimEnd(),
    `  Inspector ${compact([value(schema.inspection_appointment.inspector_name), value(schema.inspection_appointment.inspector_phone)], ' ')}`.trimEnd(),
    `- For buyers - Copy of the full MLS listing: ${schema.full_mls_uploaded ? 'included' : 'not included'}`,
    `- Lead source: ${value(schema.lead_source)}`.trimEnd(),
    `- Referral Fee: ${value(schema.referral_fee)}`.trimEnd(),
    `- Property access info: ${value(schema.property_access)}`.trimEnd(),
    `- Executed date: ${value(schema.executed_date)}`.trimEnd(),
    `- Important notes for this transaction: ${buildImportantNotes(schema)}`.trimEnd()
  ].join('\n');
}

