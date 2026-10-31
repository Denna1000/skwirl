import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry } from '../src/parse.ts';

test('eigenschap na een komma', () => assert.deepEqual(parseEntry('chiazaad, bio'), { name: 'Chiazaad', spec: 'bio', qty: 1 }));
test('maat achteraan', () => assert.deepEqual(parseEntry('melk 500 ml'), { name: 'Melk', spec: '500 ml', qty: 1 }));
test('maat vooraan', () => assert.deepEqual(parseEntry('2 kg jonagold'), { name: 'Jonagold', spec: '2 kg', qty: 1 }));
test('aantal', () => assert.deepEqual(parseEntry('3x yoghurt'), { name: 'Yoghurt', spec: null, qty: 3 }));
test('aantal zonder x', () => assert.deepEqual(parseEntry('2 komkommers'), { name: 'Komkommers', spec: null, qty: 2 }));
test('bio in de naam', () => assert.deepEqual(parseEntry('bio eieren'), { name: 'Eieren', spec: 'bio', qty: 1 }));
test('meerdere eigenschappen', () => assert.deepEqual(parseEntry('havermout 1 kg, bio'), { name: 'Havermout', spec: '1 kg · bio', qty: 1 }));
