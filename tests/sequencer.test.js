import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sequencer, layout } from '../src/sequencer.js';

const mk = (bars, meter = { num: 4, den: 4 }) => ({ meter, events: layout(bars.map((b, i) => ({ label: 'C' + i, bars: b })), meter) });
function run(seq, beats, tempos = [120]) {
  const out = []; let t = 0;
  for (let i = 0; i < beats && !seq.done; i++) {
    const spb = 60 / tempos[Math.min(i, tempos.length - 1)];
    out.push(seq.step(t, spb)); t += spb;
  }
  return out;
}
const base = { loop: 'off', range: null, change: 'chord', every: 2, seconds: 4, syncChord: false, laps: 'new' };

test('plays every chord once and stops at the end', () => {
  const cfg = { ...base };
  const s = new Sequencer(mk([1, 1, 2]), () => cfg);
  const r = run(s, 100);
  assert.equal(r.length, 16);
  assert.deepEqual([...new Set(r.map(b => b.evIdx))], [0, 1, 2]);
  assert.equal(r.at(-1).done, true);
});
test('new arpeggio at each chord (chord mode)', () => {
  const s = new Sequencer(mk([1, 2, 1]), () => ({ ...base }));
  const r = run(s, 16);
  const ch = r.filter(b => b.changes.length);
  assert.deepEqual(ch.map(b => [b.evIdx, b.changes[0].k, b.changes[0].len]), [[0, 0, 4], [1, 1, 8], [2, 2, 4]]);
});
test('every N beats, independent of chords', () => {
  const s = new Sequencer(mk([1, 1, 1]), () => ({ ...base, change: 'beats', every: 3 }));
  const r = run(s, 12);
  assert.deepEqual(r.map((b, i) => b.changes.length ? i : -1).filter(i => i >= 0), [0, 3, 6, 9]);
});
test('every N bars, restarted at chord changes when synced', () => {
  const s = new Sequencer(mk([3, 1]), () => ({ ...base, change: 'bars', every: 2, syncChord: true }));
  const r = run(s, 16);
  // slot 0: bars 1-2 (8 beats), slot 1: bar 3 only (cut by the chord change), slot 2: chord 2
  assert.deepEqual(r.map((b, i) => b.changes.length ? [i, b.changes[0].len] : null).filter(Boolean), [[0, 8], [8, 4], [12, 4]]);
});
test('every N seconds follows the clock, not the beat', () => {
  const s = new Sequencer(mk([4]), () => ({ ...base, change: 'seconds', seconds: 1.25 }));
  const r = run(s, 16, [120]);
  const times = r.flatMap(b => b.changes.map(c => +c.t.toFixed(3)));
  assert.deepEqual(times.slice(0, 5), [0, 1.25, 2.5, 3.75, 5]);
});
test('loop the whole progression; laps counted; wrap flagged', () => {
  const s = new Sequencer(mk([1, 1]), () => ({ ...base, loop: 'all' }));
  const r = run(s, 20);
  assert.equal(r.at(-1).lap, 3);
  assert.equal(r.filter(b => b.wrapped).length, 2);
  assert.equal(r.at(-1).done, false);
});
test('loop a range; start outside the range jumps into it', () => {
  const cfg = { ...base, loop: 'range', range: [1, 2] };
  const s = new Sequencer(mk([1, 1, 1, 1]), () => cfg);
  s.reset(0);
  const r = run(s, 24);
  assert.deepEqual([...new Set(r.map(b => b.evIdx))], [1, 2]);
});
test('repeat the same arpeggios each lap: slot numbers restart at 0, and the last slot previews 0', () => {
  const s = new Sequencer(mk([1, 1, 1]), () => ({ ...base, loop: 'all', laps: 'repeat' }));
  const r = run(s, 24);
  const ks = r.filter(b => b.changes.length).map(b => b.changes[0].k);
  assert.deepEqual(ks, [0, 1, 2, 0, 1, 2]);
  const lastOfLap = r.filter(b => b.changes.length)[2].changes[0];
  assert.equal(lastOfLap.nextK, 0);
});
test('new arpeggios each lap: slot numbers keep growing', () => {
  const s = new Sequencer(mk([1, 1, 1]), () => ({ ...base, loop: 'all', laps: 'new' }));
  const ks = run(s, 24).filter(b => b.changes.length).map(b => b.changes[0].k);
  assert.deepEqual(ks, [0, 1, 2, 3, 4, 5]);
});
test('jumping to another chord while playing starts a new arpeggio there', () => {
  const s = new Sequencer(mk([2, 1, 1]), () => ({ ...base, change: 'bars', every: 4 }));
  run(s, 2);
  s.jump(2);
  const b = s.step(10, 0.5);
  assert.equal(b.evIdx, 2);
  assert.equal(b.chordStart, true);
  assert.equal(b.changes.length, 1);
});
test('tempo changes only change spacing; chord order and beat count stay exact', () => {
  const s = new Sequencer(mk([1, 1, 1]), () => ({ ...base }));
  const r = run(s, 100, [60, 60, 90, 120, 200, 200, 200, 80, 80, 80, 80, 80, 80]);
  assert.equal(r.length, 12);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].t > r[i - 1].t);
});
test('odd meters: bar numbers and beat-in-bar', () => {
  const s = new Sequencer(mk([1, 1], { num: 5, den: 4 }), () => ({ ...base }));
  const r = run(s, 10);
  assert.deepEqual(r.map(b => b.bib), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
  assert.equal(r[5].barNo, 2);
});
