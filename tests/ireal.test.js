import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIReal, parseMusic, scramble, unscramble, parseTextChords, eventsToText, generateCycle } from '../src/ireal.js';

const song = (title, music, style = 'Medium Swing', bpm = 140) =>
  `${title}=Composer==${style}=C==1r34LbKcu7${scramble(music)}=Medium Swing=${bpm}=3`;
const link = (...songs) => 'irealb://' + encodeURIComponent(songs.join('===') + '===Playlist');

test('scramble/unscramble round trip on long strings', () => {
  const m = '{*AT44C^9 | x |F^9 |Bb^9 |N1Eb7 |Ab7 }N2Db-7 Gb7 |B-7 E7 Z'.repeat(3);
  assert.equal(unscramble(scramble(m)), m);
});
test('repeats, 1st/2nd endings, bar repeat, two chords per bar', () => {
  const html = `<a href="${link(song('Test, The', '{*AT44C^9 | x |F^9 |Bb^9 |N1Eb7 |Ab7 }N2Db-7 Gb7 |B-7 E7 Z'))}">x</a>`;
  const [s] = parseIReal(html);
  assert.equal(s.title, 'The Test');
  assert.equal(s.bpm, 140);
  assert.equal(s.style, 'swing');
  assert.deepEqual(s.events.map(e => `${e.label}:${e.bars}`),
    ['C^9:2', 'F^9:1', 'Bb^9:1', 'Eb7:1', 'Ab7:1', 'C^9:2', 'F^9:1', 'Bb^9:1', 'Db-7:0.5', 'Gb7:0.5', 'B-7:0.5', 'E7:0.5']);
});
test('playlist with several songs, styles and meters', () => {
  const songs = parseIReal(link(song('Uno', '[T44C-7 |F7 |Bb^7 Z', 'Bossa Nova', 0), song('Waltz', '[T34D-7 |G7 |C^7 |C^7 Z', 'Jazz Waltz')));
  assert.equal(songs.length, 2);
  assert.equal(songs[0].style, 'bossa');
  assert.equal(songs[0].bpm, 120);
  assert.deepEqual(songs[1].meter, { num: 3, den: 4 });
  assert.deepEqual(songs[1].events.map(e => e.label), ['D-7', 'G7', 'C^7']);
  assert.equal(songs[1].events[2].bars, 2);
});
test('reports unrecognised chord symbols', () => {
  const [s] = parseIReal(link(song('X', '[T44C^7 |Hmm |G7 Z')));
  assert.ok(Array.isArray(s.unknown));
});
test('time signatures', () => {
  assert.deepEqual(parseMusic('[T54C^7 Z').meter, { num: 5, den: 4 });
  assert.deepEqual(parseMusic('[T68C^7 Z').meter, { num: 6, den: 8 });
  assert.deepEqual(parseMusic('[T12C^7 Z').meter, { num: 12, den: 8 });
});
test('hand-written chords', () => {
  const s = parseTextChords('Cmaj9 | F9 | Bb-7 Eb7 | %');
  assert.deepEqual(s.events.map(e => `${e.label}:${e.bars}`), ['Cmaj9:1', 'F9:1', 'Bb-7:0.5', 'Eb7:1.5']);
  assert.deepEqual(parseTextChords('C^7 F7 Bb^7').events.length, 3);
  assert.deepEqual(parseTextChords('C^7 | Blah7x | G7').unknown, ['Blah7x']);
});
test('events back to text and re-parsed give the same progression', () => {
  const s = parseTextChords('C^7 | % | D-7 G7 | C^7');
  const again = parseTextChords(eventsToText(s.events));
  assert.deepEqual(again.events, s.events);
});
test('cycle generator', () => {
  const s = generateCycle(['^9', '7'], 5, 0, 1);
  assert.equal(s.events.length, 24);
  assert.deepEqual(s.events.slice(0, 4).map(e => e.label), ['C^9', 'F^9', 'Bb^9', 'Eb^9']);
  const wt = generateCycle(['7'], 10, 0, 1).events.map(e => e.label);
  assert.equal(new Set(wt).size, 12);
});
test('every movement covers the twelve roots exactly once', async () => {
  const { cycleRoots, CYCLES } = await import('../src/ireal.js');
  for (const [step] of CYCLES) {
    const r = cycleRoots(step, 0);
    assert.equal(r.length, 12, `step ${step}`);
    assert.equal(new Set(r).size, 12, `step ${step}`);
    assert.equal(r[0], 0);
    assert.equal(r[1], step % 12, `step ${step}`);
  }
  assert.deepEqual(CYCLES.slice(0, 6).map(c => c[0]), [5, 7, 1, 11, 2, 10]);
});
