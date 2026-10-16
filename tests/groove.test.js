import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Groove } from '../src/groove.js';
import { Sequencer, layout } from '../src/sequencer.js';
import { parseChord } from '../src/theory.js';
import { generateCycle } from '../src/ireal.js';

function rng(seed = 1) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function render(style, harmony, meter = { num: 4, den: 4 }, bars = 1) {
  const g = generateCycle(['^9', '7', '-9', 'h7', 'o7', '7alt'], 5, 0, bars, meter);
  const song = { meter, events: layout(g.events.map(e => ({ ...e, chord: parseChord(e.label) })), meter) };
  const seq = new Sequencer(song, () => ({ loop: 'off', change: 'chord', every: 1, laps: 'new' }));
  const gr = new Groove(rng(11));
  const notes = []; let t = 0;
  while (!seq.done) { const b = seq.step(t, 0.5); notes.push(...gr.beat(b, { style, meter, harmony, tempo: 120 }).map(n => ({ ...n, b }))); t += 0.5; }
  return notes;
}

for (const style of ['swing', 'bossa', 'even', 'ballad']) {
  for (const harmony of ['piano', 'rhodes', 'guitar']) {
    test(`${style}/${harmony}: bass in range, chord notes belong to the chord, nothing rings past its chord`, () => {
      const notes = render(style, harmony);
      const bass = notes.filter(n => n.kind === 'bass');
      assert.ok(bass.length > 0);
      for (const n of bass) assert.ok(n.midi >= 28 && n.midi <= 50, `bass ${n.midi}`);
      for (const n of notes.filter(x => x.kind === 'chord')) {
        const ch = n.b.ev.chord;
        const pcs = Object.values(ch.iv).map(i => (ch.root + i) % 12);
        for (const m of n.midis) assert.ok(pcs.includes(m % 12), `${ch.label}: ${m}`);
        const chordEnd = (n.b.ev.start + n.b.ev.beats) * 0.5;
        assert.ok(n.t + n.dur <= chordEnd + 0.12, `${style} ${ch.label} rings past chord`);
      }
    });
  }
}
test('walking bass starts each chord on its root (or slash bass)', () => {
  const notes = render('swing', 'piano');
  for (const n of notes.filter(x => x.kind === 'bass' && x.b.chordStart)) assert.equal(n.midi % 12, n.b.ev.chord.root);
});
test('walking bass approaches the next root by step or fifth', () => {
  const notes = render('swing', 'piano').filter(x => x.kind === 'bass');
  for (let i = 1; i < notes.length; i++) {
    if (!notes[i].b.chordStart) continue;
    const d = Math.abs(notes[i].midi - notes[i - 1].midi);
    assert.ok([1, 5, 7].includes(d) || d === 0, `leap of ${d}`);
  }
});
test('odd and compound meters produce notes', () => {
  for (const m of [{ num: 3, den: 4 }, { num: 5, den: 4 }, { num: 6, den: 8 }, { num: 7, den: 4 }]) {
    const n = render('swing', 'piano', m);
    assert.ok(n.some(x => x.kind === 'drum') && n.some(x => x.kind === 'bass'));
  }
});
