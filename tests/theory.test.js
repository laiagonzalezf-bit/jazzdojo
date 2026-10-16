import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, pretty, degreeInterval, family } from '../src/theory.js';

const iv = (label, d, o) => degreeInterval(parseChord(label), d, o);

test('major 9 in text and iReal notation', () => {
  for (const l of ['Cmaj9', 'C^9', 'CΔ9', 'CM9']) {
    const c = parseChord(l);
    assert.equal(c.root, 0, l);
    assert.deepEqual([1, 3, 5, 7, 9].map(d => degreeInterval(c, d)), [0, 4, 7, 11, 2], l);
  }
});
test('minor, half-diminished, diminished', () => {
  assert.deepEqual([3, 5, 7].map(d => iv('D-7', d)), [3, 7, 10]);
  assert.deepEqual([3, 5, 7].map(d => iv('Dm7', d)), [3, 7, 10]);
  for (const l of ['Bh7', 'Bm7b5', 'Bø7']) assert.deepEqual([3, 5, 7].map(d => iv(l, d)), [3, 6, 10], l);
  assert.deepEqual([3, 5, 7].map(d => iv('Fo7', d)), [3, 6, 9]);
  assert.deepEqual([3, 5, 7].map(d => iv('Fdim7', d)), [3, 6, 9]);
});
test('dominants and alterations', () => {
  assert.equal(iv('G7', 7), 10);
  assert.equal(iv('G7b9', 9), 1);
  assert.equal(iv('E7#9', 9), 3);
  assert.equal(iv('G7alt', 9), 1);
  assert.equal(iv('G7alt', 13), 8);
  assert.equal(iv('G13', 13), 9);
  assert.equal(iv('A7sus', 3), 5);
  assert.equal(iv('C7#11', 11), 6);
});
test('11 on major/dominant: ♯11 by default, natural 11 when configured; minor keeps natural 11', () => {
  assert.equal(iv('C^7', 11), 6);
  assert.equal(iv('C^7', 11, { sharp11: false }), 5);
  assert.equal(iv('D-11', 11), 5);
  assert.equal(iv('D-7', 11, { sharp11: false }), 5);
});
test('6 chords map degree 7 to the 6th', () => {
  assert.equal(iv('F69', 7), 9);
  assert.equal(iv('C-6', 7), 9);
});
test('flats, sharps and slash chords', () => {
  assert.equal(parseChord('Bb-7').root, 10);
  assert.equal(parseChord('F#h7').root, 6);
  const c = parseChord('C^7/E');
  assert.equal(c.bass, 4);
  assert.equal(pretty('C^7/E'), 'CΔ7/E');
});
test('written degrees', () => {
  assert.deepEqual(parseChord('C^7').written, [1, 3, 5, 7]);
  assert.deepEqual(parseChord('C^9').written, [1, 3, 5, 7, 9]);
  assert.deepEqual(parseChord('G13').written, [1, 3, 5, 7, 9, 13]);
});
test('rejects garbage', () => {
  assert.equal(parseChord('Hello'), null);
  assert.equal(parseChord('C<foo>'), null);
  assert.equal(parseChord(''), null);
});
test('pretty names', () => {
  assert.equal(pretty('Bh7'), 'Bø7');
  assert.equal(pretty('Eb-^7'), 'E♭mΔ7');
  assert.equal(pretty('Fo7'), 'F°7');
  assert.equal(pretty(null), 'N.C.');
});
test('families', () => {
  assert.equal(family(parseChord('C^9')), 'major');
  assert.equal(family(parseChord('G13')), 'dominant');
  assert.equal(family(parseChord('D-9')), 'menor');
  assert.equal(family(parseChord('Bh7')), 'm7♭5');
});
