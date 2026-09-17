import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDocument } from '../src/classify.js';

test('an intake email mentioning MLS is not classified as an MLS document', () => {
  assert.equal(classifyDocument('email.txt', '- For buyers - Copy of the full MLS listing: included'), 'other');
});

test('MLS classification requires filename or characteristic page content', () => {
  assert.equal(classifyDocument('MLS-123 Example St.pdf', 'Property view'), 'mls');
  assert.equal(classifyDocument('listing.pdf', 'Realtor Information\nList Agent: Jane Doe'), 'mls');
});
