import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMoney, formatDate, latestDate, normalizePhone, validEmail, validPhone } from '../src/validation.js';

test('date selection picks the last valid signature date', () => {
  assert.equal(formatDate(latestDate(['9/10/26', '09/12/2026', '9/11/2026'])), '09/12/2026');
});

test('email and phone validators compare normalized values', () => {
  assert.equal(validEmail('agent@example.com'), true);
  assert.equal(validEmail('not an email'), false);
  assert.equal(normalizePhone('+1 (321) 555-0100'), '3215550100');
  assert.equal(validPhone('321-555-0100'), true);
});

test('amount parsing preserves a deterministic currency representation', () => {
  assert.equal(cleanMoney('249,900.00'), '$249,900');
  assert.equal(cleanMoney('$5,000.50'), '$5,000.50');
});
