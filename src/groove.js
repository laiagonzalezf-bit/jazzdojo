// Accompaniment generator: turns one beat of the sequencer into note events for bass, drums and harmony.
// Pure apart from the injectable RNG; the audio engine plays what it returns.
import { degreeInterval } from './theory.js';
import { meterGrid } from './meter.js';

export const STYLES = ['swing', 'bossa', 'even', 'ballad'];
export const HARMONY = ['piano', 'rhodes', 'guitar'];
const BASS_LO = 28, BASS_HI = 50;

export function swingRatio(style, tempo) {
  if (style !== 'swing' && style !== 'ballad') return 0.5;
  return Math.max(0.55, Math.min(0.68, 0.68 - (tempo - 90) * 0.0008));
}

export class Groove {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.reset();
  }
  reset() {
    this.lastBass = 36;
    this.lastVoicing = null;
    this.line = null;
    this.voice = null;
    this.compPlan = [];
    this.bassPlan = null;
    this.bar = null;
    this.antNext = false;
    this.antSkip = false;
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rng(); }
  pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }
  hum(ms) { return (this.rng() - 0.5) * 2 * ms / 1000; }

  /** Nearest MIDI note with pitch class `pc` to `near`, inside [lo, hi]. */
  nearest(pc, near, lo = BASS_LO, hi = BASS_HI) {
    let best = null, bd = 1e9;
    for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === ((pc % 12) + 12) % 12) {
      const d = Math.abs(m - near);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /** Walking line for a whole chord: root on beat 1, chord/scale tones in between, approach note into the next chord. */
  walk(ch, n, nextCh) {
    const rootPc = ch.bass ?? ch.root;
    const root = this.nearest(rootPc, Math.min(Math.max(this.lastBass, 31), 45), 28, 47);
    const pcs = [0, ch.iv[3], ch.iv[5], ch.iv[7], ch.iv[9]].map(i => (ch.root + i) % 12);
    const cands = [];
    for (let m = BASS_LO; m <= BASS_HI; m++) if (pcs.includes(m % 12)) cands.push(m);
    const nextPc = nextCh ? (nextCh.bass ?? nextCh.root) : rootPc;
    const out = [root];
    if (n === 1) { this.lastBass = root; return out; }
    // segments of up to 4 beats; each segment heads for the next segment's first note
    const segs = [];
    for (let s = 0; s < n; s += 4) segs.push([s, Math.min(4, n - s)]);
    let cur = root;
    segs.forEach(([s, len], si) => {
      if (si > 0) {
        const opts = [ch.iv[5], 0, ch.iv[3]].map(i => this.nearest((ch.root + i) % 12, cur, 28, 47));
        cur = this.pick(opts.filter(m => m !== cur)) ?? opts[0];
        out.push(cur);
      }
      const last = si === segs.length - 1;
      const targetPc = last ? nextPc : (ch.root + ch.iv[5]) % 12;
      const target = this.nearest(targetPc, cur + (this.rng() < 0.5 ? 3 : -3), 28, 47);
      const r = this.rng();
      let appr = r < 0.45 ? target - 1 : r < 0.8 ? target + 1 : (target + 7 <= BASS_HI ? target + 7 : target - 5);
      if (appr < BASS_LO) appr = target + 1;
      if (appr > BASS_HI) appr = target - 1;
      const mids = len - 2;
      let prev = cur;
      for (let j = 0; j < mids; j++) {
        const want = cur + (appr - cur) * (j + 1) / (mids + 1) + this.r(-2, 2);
        const c = cands.filter(m => m !== prev && Math.abs(m - prev) <= 7).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
        prev = c[0] ?? prev;
        out.push(prev);
      }
      if (len >= 2) out.push(appr);
      cur = target;
    });
    this.lastBass = out[out.length - 1];
    return out.slice(0, n);
  }

  /** Close rootless voicing with smooth voice leading. */
  voicing(ch, lo, hi, maxNotes = 4, center = (lo + hi) / 2) {
    const pcs = ch.tones.slice(0, maxNotes).map(i => (ch.root + i) % 12);
    const target = this.lastVoicing ? this.lastVoicing.reduce((a, b) => a + b, 0) / this.lastVoicing.length : center;
    let best = null, bestScore = 1e9;
    for (let r = 0; r < pcs.length; r++) {
      const order = pcs.slice(r).concat(pcs.slice(0, r));
      for (let base = lo; base < lo + 12; base++) {
        if (base % 12 !== order[0]) continue;
        const notes = [base];
        for (let k = 1; k < order.length; k++) { let m = notes[k - 1] + 1; while (m % 12 !== order[k]) m++; notes.push(m); }
        if (notes[notes.length - 1] > hi) continue;
        const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
        // follow the previous voicing, but keep pulling towards the middle so the comping doesn't creep upwards
        const score = Math.abs(avg - target) + Math.abs(avg - center) * 0.7 + Math.max(0, notes[notes.length - 1] - (hi - 3)) * 1.5;
        if (score < bestScore) { bestScore = score; best = notes; }
      }
    }
    if (!best && hi < lo + 30) return this.voicing(ch, lo, hi + 3, maxNotes, center); // wide voicing: allow a little more room
    this.lastVoicing = best || [lo + 10, lo + 14, lo + 17];
    return this.lastVoicing;
  }

  /**
   * @param info  one beat from Sequencer.step()
   * @param o     { style, meter:{num,den,groups?}, harmony:'piano'|'rhodes'|'guitar', tempo }
   * @returns note events: {kind:'drum', name, t, v} | {kind:'bass', midi, t, dur, v}
   *          | {kind:'chord', inst, midis, t, dur, v, roll, ant?}  (ant: anticipates the next chord)
   */
  beat(info, o) {
    const g = meterGrid(o.meter);
    const out = [];
    const ctx = this.setup(info, o, g, out);
    if (g.standard) this.beat44(info, o, ctx);
    else this.beatGrid(info, o, g, ctx);
    if (info.ev.chord) this.anticipate(info, o, g, ctx);
    return out;
  }

  setup(info, o, g, out) {
    const { t, spb, ev } = info;
    const style = o.style;
    const jazz = style === 'swing' || style === 'ballad';
    // swung eighths only for jazz styles counted in quarters with even groups (jazz waltz included)
    const straight = !jazz || g.perBeat === 1 || g.oddGroups;
    const sw = straight ? 0.5 : swingRatio(style, o.tempo);
    const D = (name, tt, v) => out.push({ kind: 'drum', name, t: tt + this.hum(5), v: Math.max(0.05, Math.min(1, v * this.r(0.88, 1.08))) });
    const B = (midi, tt, dur, v) => out.push({ kind: 'bass', midi, t: tt + this.hum(4), dur, v: v * this.r(0.9, 1.05) });
    const ch = ev.chord;
    const inst = o.harmony || 'piano';
    let antSkip = false;
    if (ch && info.chordStart) {
      if (this.antNext) { antSkip = true; this.voice = this.antVoice; }
      else this.voice = inst === 'guitar' ? this.voicing(ch, 52, 70, 3, 59) : this.voicing(ch, 50, 72, 4, 60);
      this.antNext = false;
      this.compPlan = [];
    }
    this.antSkip = info.chordStart ? antSkip : this.antSkip;
    const chordEnd = t + (ev.beats - info.bi) * spb; // never ring past the chord
    const C = (tt, durSec, vel, roll = 0, midis = this.voice) => {
      tt += this.hum(6);
      out.push({ kind: 'chord', inst, midis, t: tt, dur: Math.max(0.05, Math.min(durSec, chordEnd - tt + 0.03)), v: vel * this.r(0.9, 1.08), roll });
    };
    return { out, t, spb, off: t + sw * spb, sw, style, jazz, straight, D, B, C, ch, inst, chordEnd };
  }

  /* ================= 4/4 in quarters: hand-tuned grooves ================= */
  beat44(info, o, x) {
    const { t, spb, ev, bi } = info;
    const { D, B, C, off, style, ch, inst } = x;
    const num = 4, b = info.bib;
    const lastBeatOfPhrase = b === num - 1 && info.barNo % 4 === 0;

    if (style === 'swing') {
      const back = b % 2 === 1;
      D('ride', t, (b === 0 ? 0.62 : back ? 0.78 : 0.66));
      if (back) D('ride', off, 0.42);
      if (back) D('hhpedal', t, 0.75);
      if (this.rng() < 0.55) D('kick', t, 0.18);
      if (this.rng() < 0.16) D('snare', off, 0.2);
      else if (this.rng() < 0.06) D('snare', t, 0.45);
      if (lastBeatOfPhrase && this.rng() < 0.7) { D('snare', t, 0.5); D('snare', t + spb / 3, 0.3); D('snare', off, 0.6); if (this.rng() < 0.4) D('kick', off, 0.6); }
      if (b === 0 && info.barNo % 8 === 1 && info.barNo > 1) D('kick', t, 0.55);
    } else if (style === 'ballad') {
      D('ride', t, b === 0 ? 0.42 : 0.34);
      if (b % 2 === 1) { D('hhpedal', t, 0.6); if (this.rng() < 0.5) D('ride', off, 0.25); }
      if (b === 0) D('kick', t, 0.3);
      if (b === 2 && this.rng() < 0.3) D('xstick', t, 0.35);
    } else if (style === 'bossa') {
      D('hhclosed', t, b === 0 ? 0.55 : 0.45); D('hhclosed', off, 0.3);
      if (b % 2 === 0) { D('kick', t, 0.62); D('kick', t + 1.5 * spb, 0.35); }
      const e = (((info.barNo - 1) % 2) * num + b) * 2 % 16;
      const clave = [0, 3, 6, 10, 12];
      if (clave.includes(e)) D('xstick', t, 0.7);
      if (clave.includes(e + 1)) D('xstick', off, 0.7);
    } else {
      D('hhclosed', t, 0.6); D('hhclosed', off, 0.38);
      if (b % 2 === 0) D('kick', t, 0.85); else D('snare', t, 0.8);
      if (b === num - 2 && this.rng() < 0.45) D('kick', off, 0.6);
      if (lastBeatOfPhrase) { D('snare', off, 0.55); D('snare', t + 0.75 * spb, 0.4); }
    }
    if (!ch) return;

    // bass
    if (info.chordStart) this.line = this.walk(ch, ev.beats, info.nextEv && info.nextEv.chord);
    const line = this.line || [this.nearest(ch.root, 36)];
    const root = line[0];
    const fifth = this.nearest((ch.root + ch.iv[5]) % 12, root + 5, 28, 47);
    if (style === 'swing') B(line[Math.min(bi, line.length - 1)], t, spb * 0.88, bi === 0 ? 1 : 0.85);
    else if (style === 'ballad') {
      if (bi === 0) B(root, t, spb * Math.min(ev.beats, 2) * 0.95, 0.9);
      else if (bi % 2 === 0) B(line[Math.min(bi, line.length - 1)], t, spb * 1.9, 0.75);
    } else if (style === 'bossa') {
      if (b % 2 === 0) B(b % 4 === 0 || bi === 0 ? root : fifth, t, spb * 1.4, 0.95);
      else B(b % 4 === 1 ? fifth : root, t + spb * 0.5, spb * 0.45, 0.6);
    } else {
      const n = b % 4 === 2 ? fifth : root;
      B(n, t, spb * 0.45, b % 2 === 0 ? 1 : 0.75);
      B(n, t + spb * 0.5, spb * 0.4, 0.6);
    }

    // harmony
    const skip0 = bi === 0 && this.antSkip; // the chord was already anticipated: don't hit it again on the downbeat
    const planBar = () => {
      const left = Math.min(num, ev.beats - bi);
      const opts = left >= 4 ? [[0, 1.5], [1.5], [0, 2.5], [0.5, 2], [1.5, 3], [0], [2.5], [0, 2]]
        : left === 3 ? [[0], [0, 1.5], [1.5], [0.5, 2]]
          : left === 2 ? [[0], [0.5], [0, 1.5]] : [[0]];
      let p = this.pick(opts);
      if (bi === 0 && !p.some(q => q < 1) && this.rng() < 0.6) p = [0, ...p];
      if (bi === 0 && this.antSkip) p = p.filter(q => q !== 0);
      this.compPlan = p.map(q => q + bi);
    };
    if (style === 'swing') {
      if (inst === 'guitar') { if (!skip0) C(t, 0.5 * spb, b % 2 === 1 ? 0.6 : 0.5, 0.01); }
      else {
        if (bi === 0 || b === 0) planBar();
        for (const pos of this.compPlan) {
          if (Math.floor(pos) !== bi) continue;
          const tt = pos - bi === 0 ? t : off;
          const nextHit = this.compPlan.find(q => q > pos);
          const dur = nextHit !== undefined && nextHit - pos < 1.2 ? 0.45 : this.pick([0.5, 1, 1.5]);
          C(tt, (inst === 'rhodes' ? dur * 1.4 : dur) * spb, (pos === 0 ? 0.8 : 0.68) * (inst === 'rhodes' ? 0.85 : 1));
        }
      }
    } else if (style === 'ballad') {
      if (inst === 'guitar') {
        const v = this.voice, notes = v.concat(v.slice(1, -1).reverse());
        for (let h = 0; h < 2; h++) C(h ? off : t, 1.5 * spb, 0.5, 0, [notes[(bi * 2 + h) % notes.length]]);
      } else if (bi === 0 && !skip0) C(t, Math.min(ev.beats, num) * 0.98 * spb, 0.65, 0.03);
      else if (bi === 2 && ev.beats >= 4 && this.rng() < 0.35) C(off, 1.5 * spb, 0.4);
    } else if (style === 'bossa') {
      const e = (((info.barNo - 1) % 2) * num + b) * 2 % 16;
      const pat = [0, 3, 6, 10, 13];
      const roll = inst === 'guitar' ? 0.012 : 0;
      let hit = false;
      if (pat.includes(e) && !skip0) { C(t, 0.9 * spb, 0.62, roll); hit = true; }
      if (pat.includes(e + 1)) { C(off, 0.9 * spb, 0.58, roll); hit = true; }
      if (bi === 0 && !hit && !skip0) C(t, 0.9 * spb, 0.6, roll);
    } else if (inst === 'guitar') C(off, 0.25 * spb, 0.55, 0.008);
    else {
      if (bi === 0 && !skip0) C(t, Math.min(ev.beats, num) * 0.9 * spb, 0.5);
      if (b % 2 === 1) C(off, 0.3 * spb, 0.55);
    }
  }

  /* ================= any other meter / grouping: groove built from the eighth-note grid ================= */
  beatGrid(info, o, g, x) {
    const { t, spb, ev, bi } = info;
    const { D, B, C, off, style, jazz, straight, ch, inst } = x;
    const pb = g.perBeat;
    const barStartBeat = info.bib === 0;
    // eighths that fall inside this beat, with their bar position and time
    const es = pb === 2 ? [{ j: 0, e: info.bib * 2, tt: t }, { j: 1, e: info.bib * 2 + 1, tt: off }] : [{ j: 0, e: info.bib, tt: t }];
    const eighth = pb === 2 ? spb / 2 : spb;
    if (barStartBeat || !this.bar || this.bar.no !== info.barNo) {
      // per-bar choices: a 6/8 hemiola over 3/4 (accents on 1 and the "and" of 2), fills
      const waltz = o.meter.num === 3 && o.meter.den === 4 && !g.oddGroups;
      this.bar = { no: info.barNo, hemiola: waltz && this.rng() < 0.35, fill: info.barNo % 4 === 0 && this.rng() < 0.6 };
    }
    const hem = this.bar.hemiola;
    const lastBeat = info.bib === (g.E / pb) - 1;

    /* drums */
    for (const { j, e, tt } of es) {
      const start = g.startSet.has(e), gi = g.groupOf[e];
      if (jazz && !straight) {
        if (j === 0) D('ride', tt, (e === 0 ? 0.64 : start ? 0.72 : 0.62) * (style === 'ballad' ? 0.6 : 1));
        else if (info.bib % 2 === 1 && !hem) D('ride', tt, 0.4 * (style === 'ballad' ? 0.7 : 1));
        if (start && e !== 0 && !(hem && e === 2)) D('hhpedal', tt, 0.72);
        if (hem && (e === 0 || e === 3)) { D(e === 0 ? 'kick' : 'snare', tt, e === 0 ? 0.4 : 0.42); if (e === 3) D('ride', tt, 0.55); }
        else if (start && this.rng() < 0.5) D('kick', tt, e === 0 ? 0.3 : 0.18);
        if (j === 1 && this.rng() < 0.14) D('snare', tt, 0.2);
      } else if (jazz) {
        // jazz with odd groupings or eighth-note meters: ride on every eighth, accents on the groups
        D('ride', tt, start ? 0.7 : 0.4);
        if (start && e !== 0) D('hhpedal', tt, 0.65);
        if (e === 0) D('kick', tt, 0.4);
        if (start && gi === g.groups.length - 1 && this.rng() < 0.4) D('xstick', tt, 0.35);
        if (!start && this.rng() < 0.1) D('snare', tt, 0.18);
      } else {
        D('hhclosed', tt, start ? 0.58 : 0.34);
        if (start) {
          if (gi % 2 === 0) D('kick', tt, e === 0 ? 0.8 : 0.65);
          else D(style === 'bossa' ? 'xstick' : 'snare', tt, style === 'bossa' ? 0.7 : 0.78);
        }
      }
      if (this.bar.fill && lastBeat && j === pb - 1) { D('snare', tt, 0.5); if (pb === 2) D('snare', tt - eighth / 2, 0.3); }
    }
    if (!ch) return;

    /* bass and harmony are planned once per chord, eighth by eighth */
    const startE = ev.start * pb, lenE = ev.beats * pb;
    const barE = k => (startE + k) % g.E;
    if (info.chordStart) {
      const nextCh = info.nextEv && info.nextEv.chord;
      // bass hits
      let hits = [];
      const waltz = o.meter.num === 3 && o.meter.den === 4 && !g.oddGroups;
      const walkAll = jazz && style === 'swing' && !straight && this.rng() < (waltz ? 0.35 : 0.5);
      for (let k = 0; k < lenE; k++) {
        const be = barE(k);
        if (k === 0) { hits.push(k); continue; }
        if (walkAll) { if (k % 2 === 0) hits.push(k); continue; }
        if (waltz && jazz) { if (be === 4 || (be === 0)) hits.push(k); continue; } // "1 . 3"
        if (g.startSet.has(be)) { hits.push(k); continue; }
        if (!jazz && g.startSet.has((be + 1) % g.E) && this.rng() < 0.35) hits.push(k); // pickup into a group
      }
      const notes = jazz ? this.walk(ch, hits.length, nextCh)
        : hits.map((k, i) => {
          const root = this.nearest(ch.bass ?? ch.root, Math.min(Math.max(this.lastBass, 31), 45), 28, 47);
          if (i === 0) return root;
          if (i === hits.length - 1 && nextCh && hits.length > 2) { const tg = this.nearest(nextCh.bass ?? nextCh.root, root, 28, 47); return tg + (this.rng() < 0.5 ? 1 : -1); }
          return i % 2 ? this.nearest((ch.root + ch.iv[5]) % 12, root + 5, 28, 47) : root;
        });
      if (!jazz) this.lastBass = notes[notes.length - 1];
      this.bassPlan = new Map(hits.map((k, i) => [k, { midi: notes[i], len: (hits[i + 1] ?? lenE) - k }]));
      // harmony hits
      const comp = [];
      for (let k = 0; k < lenE; k++) {
        const be = barE(k), start = g.startSet.has(be);
        let p;
        if (k === 0) p = this.antSkip ? 0 : (style === 'ballad' ? 1 : 0.62);
        else if (inst === 'guitar' && jazz && !straight) p = k % 2 === 0 ? 1 : 0;  // four (three, five…) to the bar
        else if (inst === 'guitar' && style === 'even') p = start ? 0.3 : 0.6;
        else if (style === 'ballad') p = start ? 0.2 : 0;
        else if (waltz && this.bar.hemiola) p = be === 3 ? 0.7 : 0;
        else if (start) p = 0.4;
        else if (g.startSet.has((be + 1) % g.E)) p = 0.22;               // just before a group: syncopation
        else p = pb === 2 && k % 2 === 1 ? 0.12 : 0.06;
        if (this.rng() < p) comp.push(k);
      }
      if (!comp.length && !this.antSkip) comp.push(0);
      this.compPlan = comp;
    }
    for (const { j, tt } of es) {
      const k = bi * pb + j;
      const bh = this.bassPlan && this.bassPlan.get(k);
      if (bh) B(bh.midi, tt, bh.len * eighth * 0.92, k === 0 ? 1 : 0.85);
      if (this.compPlan.includes(k)) {
        const nxt = this.compPlan.find(q => q > k);
        const lenEighths = nxt !== undefined ? nxt - k : lenE - k;
        const long = style === 'ballad' || inst === 'rhodes';
        const dur = (nxt !== undefined && lenEighths <= 2 && !long) ? lenEighths * eighth * 0.8 : Math.min(lenEighths, long ? 6 : 3) * eighth;
        const roll = style === 'ballad' && k === 0 ? 0.03 : inst === 'guitar' ? 0.01 : 0;
        C(tt, dur, k === 0 ? 0.75 : 0.62, roll);
      }
    }
  }

  /* An eighth note before the next chord, the harmony sometimes plays it early (very common in jazz and bossa). */
  anticipate(info, o, g, x) {
    const { ev, bi, spb, t } = info;
    const nextCh = info.nextEv && info.nextEv.chord;
    if (bi !== ev.beats - 1 || !nextCh || info.nextEv.label === ev.label) return;
    // only into a chord that lands on a strong point (a beat in 4/4, a group start otherwise)
    const nextBarE = ((ev.start + ev.beats) * g.perBeat) % g.E;
    if (!g.standard && !g.startSet.has(nextBarE)) return;
    const p = { swing: 0.3, bossa: 0.25, even: 0.15, ballad: 0.1 }[x.style] * (x.inst === 'guitar' && x.style === 'swing' ? 0.3 : 1);
    if (this.rng() >= p) return;
    const antT = g.perBeat === 2 ? x.off : t;
    // the anticipation replaces any hit of the old chord at that moment
    for (let i = x.out.length - 1; i >= 0; i--) if (x.out[i].kind === 'chord' && x.out[i].t >= antT - 0.03) x.out.splice(i, 1);
    const inst = x.inst;
    const nv = inst === 'guitar' ? this.voicing(nextCh, 52, 70, 3, 59) : this.voicing(nextCh, 50, 72, 4, 60);
    x.out.push({ kind: 'chord', inst, midis: nv, t: antT + this.hum(5), dur: spb * (x.style === 'ballad' ? 2 : 1.1), v: 0.72 * this.r(0.9, 1.08), roll: x.style === 'ballad' ? 0.03 : 0, ant: true });
    this.antNext = true;
    this.antVoice = nv;
  }
}

/** Arpeggio degrees → note names, for the help view. */
export function arpNoteNames(chord, arp, opts, noteName) {
  if (!chord) return '';
  return arp.map(d => noteName(chord.root + degreeInterval(chord, d, opts), chord.flat)).join(' ');
}
