import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Groove } from '../src/groove.js';
import { Sequencer, layout } from '../src/sequencer.js';
import { parseChord } from '../src/theory.js';
import { generateCycle } from '../src/ireal.js';

function rng(seed = 1) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function render(style, harmony, meter = { num: 4, den: 4 }, bars = 1, seed = 11) {
  const g = generateCycle(['^9', '7', '-9', 'h7', 'o7', '7alt'], 5, 0, bars, meter);
  const song = { meter, events: layout(g.events.map(e => ({ ...e, chord: parseChord(e.label) })), meter) };
  const seq = new Sequencer(song, () => ({ loop: 'off', change: 'chord', every: 1, laps: 'new' }));
  const gr = new Groove(rng(seed));
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
        const ch = n.ant ? n.b.nextEv.chord : n.b.ev.chord; // anticipations belong to the next chord
        const pcs = Object.values(ch.iv).map(i => (ch.root + i) % 12);
        for (const m of n.midis) assert.ok(pcs.includes(m % 12), `${ch.label}: ${m}`);
        const chordEnd = (n.b.ev.start + n.b.ev.beats) * 0.5;
        if (!n.ant) assert.ok(n.t + n.dur <= chordEnd + 0.12, `${style} ${ch.label} rings past chord`);
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
test('harmony stays in a middle register over a long progression', () => {
  for (const harmony of ['piano', 'rhodes', 'guitar']) {
    const notes = render('swing', harmony).filter(n => n.kind === 'chord').flatMap(n => n.midis);
    assert.ok(Math.max(...notes) <= 74, `${harmony} top ${Math.max(...notes)}`);
    assert.ok(Math.min(...notes) >= 50, `${harmony} bottom ${Math.min(...notes)}`);
  }
});

import { meterGrid } from '../src/meter.js';
const MET = [{ num: 3, den: 4 }, { num: 3, den: 4, groups: [3, 3] }, { num: 5, den: 4, groups: [6, 4] }, { num: 5, den: 4, groups: [3, 3, 2, 2] },
  { num: 5, den: 8, groups: [2, 3] }, { num: 7, den: 8, groups: [2, 2, 3] }, { num: 7, den: 4, groups: [6, 8] }, { num: 4, den: 4, groups: [3, 3, 2] }, { num: 6, den: 8 }];
for (const m of MET) for (const style of ['swing', 'bossa', 'even', 'ballad']) {
  test(`${m.num}/${m.den} ${(m.groups || []).join('+')} ${style}: notes in range, in the chord, inside the bar grid`, () => {
    const notes = render(style, 'piano', m);
    const g = meterGrid(m);
    for (const n of notes.filter(x => x.kind === 'bass')) assert.ok(n.midi >= 28 && n.midi <= 50);
    for (const n of notes.filter(x => x.kind === 'chord')) {
      const ch = n.ant ? n.b.nextEv.chord : n.b.ev.chord;
      const pcs = Object.values(ch.iv).map(i => (ch.root + i) % 12);
      for (const mm of n.midis) assert.ok(pcs.includes(mm % 12));
    }
    // every bar starts with a bass note (unless the chord began in the previous bar)
    const firstBeats = notes.filter(x => x.kind === 'bass' && x.b.chordStart);
    assert.ok(firstBeats.length > 0);
    assert.ok(g.E > 0);
  });
}
test('straight styles put the kick on the group starts of the grouping (7/8 = 2+2+3)', () => {
  const m = { num: 7, den: 8, groups: [2, 2, 3] };
  const kicks = render('even', 'piano', m).filter(n => n.kind === 'drum' && n.name === 'kick').map(n => n.b.bib);
  assert.ok(kicks.length > 0);
  for (const b of kicks) assert.ok([0, 4].includes(b), `kick on eighth ${b}`);
  const snares = render('even', 'piano', m).filter(n => n.kind === 'drum' && n.name === 'snare' && Math.abs(n.t - n.b.t) < 0.02).map(n => n.b.bib);
  for (const b of snares) assert.ok([2, 6].includes(b), `snare on eighth ${b}`);
});
test('5/4 in 3+2 and 2+3 accent different beats', () => {
  const hh = gr => render('swing', 'piano', { num: 5, den: 4, groups: gr }).filter(n => n.kind === 'drum' && n.name === 'hhpedal').map(n => n.b.bib);
  assert.deepEqual([...new Set(hh([6, 4]))], [3]);
  assert.deepEqual([...new Set(hh([4, 6]))], [2]);
});
test('jazz waltz: hi-hat on 2 and 3, sometimes a 6/8 hemiola', () => {
  let hem = 0;
  for (let seed = 1; seed < 6; seed++) {
    const n = render('swing', 'piano', { num: 3, den: 4 }, 1, seed);
    const hh = n.filter(x => x.kind === 'drum' && x.name === 'hhpedal').map(x => x.b.bib);
    for (const b of hh) assert.ok([1, 2].includes(b));
    hem += n.filter(x => x.kind === 'drum' && x.name === 'snare' && x.b.bib === 1 && x.v > 0.3).length;
  }
  assert.ok(hem > 0, 'no hemiola heard');
});
test('harmony sometimes anticipates the next chord by an eighth, and then skips the downbeat', () => {
  for (const style of ['swing', 'bossa']) {
    const n = render(style, 'piano', { num: 4, den: 4 }, 1, 7);
    const ants = n.filter(x => x.kind === 'chord' && x.ant);
    assert.ok(ants.length > 2, `${style}: ${ants.length} anticipations`);
    for (const a of ants) {
      assert.equal(a.b.bi, a.b.ev.beats - 1);                       // on the last beat of the chord
      const nextStart = (a.b.ev.start + a.b.ev.beats) * 0.5;
      assert.ok(a.t < nextStart && a.t > nextStart - 0.5);            // an eighth before the next chord
      const downbeat = n.filter(x => x.kind === 'chord' && !x.ant && Math.abs(x.t - nextStart) < 0.03);
      assert.equal(downbeat.length, 0, 'anticipated chord hit again on the downbeat');
    }
  }
});
