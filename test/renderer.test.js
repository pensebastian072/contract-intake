import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchema } from '../src/extract.js';
import { renderEmail } from '../src/renderer.js';

test('Today appears only when a complete appointment matches local date', () => {
  const { schema } = resolveSchema([], 'Inspection date: 09/16/2026\nInspection time: 2:30 PM\nInspector: Sam Rivera');
  const output = renderEmail(schema, new Date(2026, 8, 16, 9, 0));
  assert.match(output, /Inspections scheduled for 09\/16\/2026 at 2:30 PM \(Today\)/);
});

test('renderer never emits diagnostic markers or citations', () => {
  const { schema } = resolveSchema([], 'Buyer: Jane Doe\nBuyer email: jane@example.com');
  const output = renderEmail(schema);
  assert.doesNotMatch(output, /\[VERIFY\]|confidence|sources:/i);
  assert.ok(output.startsWith('Good Morning Joe,'));
});
