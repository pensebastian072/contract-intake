import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchema, verificationFields } from '../src/extract.js';
import { makeDocument } from './helpers.js';

test('executed contract closing date beats an MLS expected closing date without a conflict', () => {
  const contract = makeDocument('executed purchase contract.pdf', 'AS IS Residential Contract for Sale and Purchase\nClosing Date: 10/23/2026');
  const mls = makeDocument('MLS listing.pdf', 'MLS Realtor Information\nExp Clsg Date: 10/30/2026');
  const { schema } = resolveSchema([mls, contract]);
  assert.equal(schema.closing_date.value, '10/23/2026');
  assert.equal(schema.closing_date.status, 'FOUND');
});

test('supplemental verified details have highest precedence', () => {
  const contract = makeDocument('executed purchase contract.pdf', 'AS IS Residential Contract for Sale and Purchase\nClosing Date: 10/23/2026');
  const { schema } = resolveSchema([contract], 'Closing date: 10/24/2026');
  assert.equal(schema.closing_date.value, '10/24/2026');
});

test('same-authority disagreement is exposed as VERIFY and left out of output value', () => {
  const a = makeDocument('executed purchase contract A.pdf', 'AS IS Residential Contract for Sale and Purchase\nClosing Date: 10/23/2026');
  const b = makeDocument('executed purchase contract B.pdf', 'AS IS Residential Contract for Sale and Purchase\nClosing Date: 10/24/2026');
  const { schema } = resolveSchema([a, b]);
  assert.equal(schema.closing_date.status, 'VERIFY');
  assert.equal(schema.closing_date.value, '');
  assert.deepEqual(verificationFields(schema).map((item) => item.field), ['closing_date']);
});

test('latest required signature timestamp determines executed date', () => {
  const contract = makeDocument('executed purchase contract.pdf', 'AS IS Residential Contract for Sale and Purchase', {
    signatureMetadata: [
      { timestamp: "D:20260910103000-04'00'", signer: 'Buyer' },
      { timestamp: "D:20260912124500-04'00'", signer: 'Seller' }
    ]
  });
  const { schema } = resolveSchema([contract]);
  assert.equal(schema.executed_date.value, '09/12/2026');
});

