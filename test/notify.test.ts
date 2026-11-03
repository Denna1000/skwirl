import { test } from 'node:test';
import assert from 'node:assert/strict';

// notify.ts gebruikt localStorage en window.setTimeout, zoals in de browser
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
  window: { setTimeout: () => 0 },
});
const { note, flushOutbox, setSender } = await import('../src/notify.ts');

test('wijzigingen worden gebundeld; erop en er weer af heft elkaar op', async () => {
  const sent: unknown[] = [];
  setSender(async (o) => { sent.push(o); });
  note('add', 'Melk'); note('add', 'Bananen (biologisch)'); note('add', 'Melk');
  note('off', 'Kaas'); note('add', 'Brood'); note('off', 'Brood');
  await flushOutbox();
  assert.deepEqual(sent, [{ added: ['Melk', 'Bananen (biologisch)'], removed: ['Kaas'] }]);
  await flushOutbox(); // niets meer klaar: geen tweede melding
  assert.equal(sent.length, 1);
});

test('mislukt versturen: de wijzigingen blijven klaarstaan', async () => {
  setSender(async () => { throw new Error('geen netwerk'); });
  note('add', 'Eieren');
  await flushOutbox();
  const sent: unknown[] = [];
  setSender(async (o) => { sent.push(o); });
  await flushOutbox();
  assert.deepEqual(sent, [{ added: ['Eieren'], removed: [] }]);
});
