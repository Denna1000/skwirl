import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountOf, unitPrice, unitLabel } from '../src/unit.ts';

test('stuk kaas in gram', () => assert.deepEqual(amountOf('Beemster jong belegen stuk 500 g'), { amount: 0.5, unit: 'kg' }));
test('fles in liter met komma', () => assert.deepEqual(amountOf('Coca-Cola 1,5 L'), { amount: 1.5, unit: 'l' }));
test('multipack', () => assert.deepEqual(amountOf('Coca-Cola 2 x 1,5 liter'), { amount: 3, unit: 'l' }));
test('centiliter', () => assert.deepEqual(amountOf('Hertog Jan krat 24 × 30 cl'), { amount: 7.2, unit: 'l' }));
test('zonder inhoud', () => assert.equal(amountOf('Jonagold appels'), null));
test('prijs per kilo', () => assert.equal(unitLabel(unitPrice({ title: 'Beemster stuk 500 g', price: 5.49 })!).replace(/\s/g, ' '), '€ 10,98 per kilo'));
test('effectieve prijs gaat voor', () => assert.equal(unitPrice({ title: 'Cola 1 l', price: 2, effPrice: 1.5 })!.value, 1.5));
test('opgegeven inhoud gaat voor de titel', () => assert.equal(unitPrice({ title: 'Kaas stuk', price: 9.99, amount: 1, unit: 'kg' })!.value, 9.99));
