import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchema } from '../src/extract.js';
import { makeDocument } from './helpers.js';

test('inspection period is not treated as an appointment', () => {
  const documents = [makeDocument('executed purchase contract.pdf', 'AS IS Residential Contract for Sale and Purchase\nInspection Period: 7 days')];
  const { schema } = resolveSchema(documents);
  assert.equal(schema.inspection_period.value, '7 days');
  assert.equal(schema.inspection_appointment.date.status, 'BLANK');
  assert.equal(schema.inspection_appointment.time.status, 'BLANK');
});

test('appointment requires both an actual date and time', () => {
  const incomplete = resolveSchema([], 'Inspection date: 09/18/2026').schema;
  assert.equal(incomplete.inspection_appointment.date.status, 'BLANK');
  const complete = resolveSchema([], 'Inspection date: 09/18/2026\nInspection time: 10:00 AM').schema;
  assert.equal(complete.inspection_appointment.date.value, '09/18/2026');
  assert.equal(complete.inspection_appointment.time.value, '10:00 AM');
});

test('loan amount and seller credit never become lender credit', () => {
  const document = makeDocument('executed purchase contract.pdf', `AS IS Residential Contract for Sale and Purchase
Loan Amount: $248,900
Seller credit: $5,000 toward buyer's closing costs.`);
  const { schema } = resolveSchema([document]);
  assert.equal(schema.loan_amount.value, '$248,900');
  assert.match(schema.seller_credits.value, /^\$5,000/);
  assert.equal(schema.lender_credits.status, 'BLANK');
});

test('broker compensation is not a referral fee', () => {
  const document = makeDocument('buyer brokerage agreement.pdf', 'Exclusive Buyer Brokerage Agreement\nBroker compensation: 3%');
  const { schema } = resolveSchema([document]);
  assert.equal(schema.referral_fee.status, 'BLANK');
});

test('remarks do not establish a transaction coordinator role', () => {
  const document = makeDocument('MLS listing.pdf', 'MLS Realtor Information\nRealtor Remarks: Call/text Morgan Example 321-555-0101 with any questions.');
  const { schema } = resolveSchema([document]);
  assert.equal(schema.transaction_coordinators.length, 0);
});

test('an explicitly identified transaction coordinator is accepted', () => {
  const document = makeDocument('transaction contacts.pdf', 'Transaction Coordinator: Alex Reed\nTransaction Coordinator Email: alex@example.com');
  const { schema } = resolveSchema([document]);
  assert.equal(schema.transaction_coordinators[0].name.value, 'Alex Reed');
  assert.equal(schema.transaction_coordinators[0].email.value, 'alex@example.com');
});

test('an actual inspection confirmation can establish appointment and inspector', () => {
  const document = makeDocument('inspection confirmation.pdf', 'Inspection appointment scheduled for 09/18/2026 at 10:00 AM\nInspector: Ada Lewis\nInspector Phone: 321-555-0100');
  const { schema } = resolveSchema([document]);
  assert.equal(schema.inspection_appointment.date.value, '09/18/2026');
  assert.equal(schema.inspection_appointment.time.value, '10:00 AM');
  assert.equal(schema.inspection_appointment.inspector_name.value, 'Ada Lewis');
});

test('money fields read the amount, never a day count, date part, or trailing digit', () => {
  const read = (line) => resolveSchema([makeDocument('executed purchase contract.pdf',
    `AS IS Residential Contract for Sale and Purchase\n${line}`)]).schema;
  assert.equal(read('Purchase Price: 450,000.00').purchase_price.value, '$450,000');
  assert.equal(read('Purchase Price (U.S. currency) ................ 450,000.00').purchase_price.value, '$450,000');
  assert.equal(read('Initial Deposit: $10,000.00 due within 3 days after Effective Date').initial_deposit.value, '$10,000');
  assert.equal(read('Initial deposit to be made within 3 days').initial_deposit.status, 'BLANK');
  assert.equal(read('Financing: Conventional, loan approval within 30 days').loan_amount.status, 'BLANK');
  assert.equal(read('Financing: approval by 10/23/2026').loan_amount.status, 'BLANK');
  assert.equal(read('Loan Amount: 248,900').loan_amount.value, '$248,900');
  assert.equal(read('Financing: Conventional loan of $360,000').loan_amount.value, '$360,000');
});

test('a $ amount on the line beats a street number or form year; bare years never count', () => {
  const read = (line) => resolveSchema([makeDocument('executed purchase contract.pdf',
    `AS IS Residential Contract for Sale and Purchase\n${line}`)]).schema;
  assert.equal(read('Purchase Price for 1234 Main St: $450,000').purchase_price.value, '$450,000');
  assert.equal(read('Purchase Price (2026 form): $450,000').purchase_price.value, '$450,000');
  assert.equal(read('Purchase Price (2026 form): 450,000').purchase_price.value, '$450,000');
  assert.equal(read('Purchase Price ...........450,000.00').purchase_price.value, '$450,000');
  assert.equal(read('Purchase Price: 450000').purchase_price.value, '$450,000');
  assert.equal(read('Financing: by December 31, 2026').loan_amount.status, 'BLANK');
});
