import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArpEngine, parsePatterns } from '../src/arps.js';
import { parseChord } from '../src/theory.js';

function rng(seed = 1) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

test('pattern parsing, including 11 and 13 with separators', () => {
  assert.deepEqual(parsePatterns('13579, 53971; 1-3-11-7\n9.7.13'), [[1, 3, 5, 7, 9], [5, 3, 9, 7, 1], [1, 3, 11, 7], [9, 7, 13]]);
});
test('random arpeggios use only the chosen degrees, right length, no immediate repeats', () => {
  const s = { source: 'random', degrees: [1, 3, 5, 7, 9], len: 5 };
  const e = new ArpEngine(() => s, rng(3));
  for (let k = 0; k < 200; k++) {
    const a = e.at(k);
    assert.equal(a.length, 5);
    assert.deepEqual([...a].sort((x, y) => x - y), [1, 3, 5, 7, 9]);
    if (k > 0) assert.notDeepEqual(a, e.at(k - 1));
  }
});
test('shorter arpeggios pick a subset', () => {
  const e = new ArpEngine(() => ({ source: 'random', degrees: [1, 3, 5, 7, 9, 11, 13], len: 4 }), rng(5));
  for (let k = 0; k < 50; k++) assert.equal(new Set(e.at(k)).size, 4);
});
test('slots are cached: asking twice returns the same pattern', () => {
  const e = new ArpEngine(() => ({ source: 'random', degrees: [1, 3, 5, 7], len: 4 }), rng(9));
  const a = e.at(7);
  assert.deepEqual(e.at(7), a);
  e.reset(3);
  assert.equal(e.list.length, 4);
});
test('own list in order and shuffled', () => {
  const s = { source: 'list', patterns: '13579, 53971, 97531', order: 'seq' };
  const e = new ArpEngine(() => s, rng(2));
  assert.deepEqual([0, 1, 2, 3].map(k => e.at(k).join('')), ['13579', '53971', '97531', '13579']);
  s.order = 'shuffle';
  const e2 = new ArpEngine(() => s, rng(2));
  for (let k = 1; k < 60; k++) assert.notDeepEqual(e2.at(k), e2.at(k - 1));
});
test('only written degrees restricts to the chord symbol', () => {
  const e = new ArpEngine(() => ({ source: 'random', degrees: [1, 3, 5, 7, 9, 13], len: 6, onlyWritten: true }), rng(4));
  const c = parseChord('C^7');
  for (let k = 0; k < 30; k++) assert.ok(e.at(k, () => c).every(d => [1, 3, 5, 7].includes(d)));
});
