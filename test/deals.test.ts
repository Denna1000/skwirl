import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealWhen } from '../src/deals.ts';

const sat = new Date(2026, 9, 31, 10); // za 31 okt 2026

test('folder van volgende week komt eraan', () => {
  const w = dealWhen({ from: '2026-11-02', until: '2026-11-08', span: 'week' }, sat);
  assert.equal(w.state, 'soon'); assert.equal(w.startsIn, 2);
  assert.equal(w.label, 'Vanaf ma 2 nov t/m zo 8 nov'); assert.equal(w.short, 'vanaf ma');
});
test('weekendactie loopt nu', () => {
  const w = dealWhen({ from: '2026-10-31', until: '2026-11-01', span: 'weekend' }, sat);
  assert.equal(w.state, 'now'); assert.equal(w.label, 'Weekendactie, nog t/m zo 1 nov');
});
test('dagactie vandaag', () => assert.equal(dealWhen({ from: '2026-10-31', until: '2026-10-31', span: 'dag' }, sat).label, 'Alleen vandaag'));
test('dagactie morgen', () => assert.equal(dealWhen({ from: '2026-11-01', until: '2026-11-01', span: 'dag' }, sat).short, 'vanaf morgen'));
test('verlopen actie', () => assert.equal(dealWhen({ from: '2026-10-26', until: '2026-10-30', span: 'week' }, sat).state, 'expired'));
test('oude vrije tekst blijft leesbaar', () => assert.equal(dealWhen({ from: null, until: 'zo 9 nov', span: null }, sat).label, 't/m zo 9 nov'));
