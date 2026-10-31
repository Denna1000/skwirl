import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPurchase, learnedInterval } from '../src/rhythm.ts';

const D = 864e5, t0 = Date.UTC(2026, 9, 1);
test('één aankoop: nog geen ritme', () => assert.equal(learnedInterval([t0]), null));
test('mediaan van de tussenpozen', () => assert.equal(learnedInterval([t0, t0 + 7 * D, t0 + 13 * D, t0 + 30 * D]), 7));
test('twee keer aftikken op één dag telt één keer', () => assert.deepEqual(addPurchase([t0], t0 + 3600e3), [t0 + 3600e3]));
test('bewaart de laatste 12', () => assert.equal(addPurchase(Array.from({ length: 12 }, (_, i) => t0 + i * D), t0 + 20 * D).length, 12));
