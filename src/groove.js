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

  /**
   * Walking line for a whole chord: root on beat 1, chord tones in between, and a diatonic approach
   * (a chord tone near the target, the next chord's 5th, or a whole step) into the next chord.
   * Chromatic notes are only ever eighth notes: with `pairs`, a beat may become a swung pair of eighths
   * ({a, b}: b on the swung "and"), either a skip/ghost figure or a chromatic leading note into the next chord.
   * @param o { pairs:boolean, pChrom:number, pSkip:number }
   */
  walk(ch, n, nextCh, o = {}) {
    const pairs = !!o.pairs, pChrom = o.pChrom || 0, pSkip = o.pSkip || 0;
    const rootPc = ch.bass ?? ch.root;
    const root = this.nearest(rootPc, Math.min(Math.max(this.lastBass, 31), 45), 28, 47);
    const pcs = [0, ch.iv[3], ch.iv[5], ch.iv[7], ch.iv[9]].map(i => (ch.root + i) % 12);
    const cands = [];
    for (let m = BASS_LO; m <= BASS_HI; m++) if (pcs.includes(m % 12)) cands.push(m);
    const nextPc = nextCh ? (nextCh.bass ?? nextCh.root) : rootPc;
    const out = [root];
    if (n === 1) { this.lastBass = root; return out; }
    const segs = [];
    for (let s = 0; s < n; s += 4) segs.push([s, Math.min(4, n - s)]);
    let cur = root;
    const clamp = m => Math.max(BASS_LO, Math.min(BASS_HI, m));
    segs.forEach(([s, len], si) => {
      if (si > 0) {
        const opts = [ch.iv[5], 0, ch.iv[3]].map(i => this.nearest((ch.root + i) % 12, cur, 28, 47));
        cur = this.pick(opts.filter(m => m !== cur)) ?? opts[0];
        out.push(cur);
      }
      const last = si === segs.length - 1;
      const targetPc = last ? nextPc : (ch.root + ch.iv[5]) % 12;
      const target = this.nearest(targetPc, cur + (this.rng() < 0.5 ? 3 : -3), 28, 47);
      // a non-chromatic approach that can last a whole beat
      const near = cands.filter(m => m !== target && Math.abs(m - target) <= 2);
      const fifthOfTarget = [target + 7, target - 5].filter(m => m >= BASS_LO && m <= BASS_HI);
      const r = this.rng();
      let appr;
      if (near.length && r < 0.5) appr = this.pick(near);
      else if (fifthOfTarget.length && r < 0.8) appr = fifthOfTarget.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur))[0];
      else { // otherwise the chord tone closest to the target (never a chromatic note on a full beat)
        const ct = cands.filter(m => m !== target && Math.abs(m - target) >= 2).sort((x, y) => Math.abs(x - target) - Math.abs(y - target));
        appr = ct[0] ?? clamp(target + 7 <= BASS_HI ? target + 7 : target - 5);
      }
      const mids = len - 2;
      let prev = cur;
      for (let j = 0; j < mids; j++) {
        const want = cur + (appr - cur) * (j + 1) / (mids + 1) + this.r(-2, 2);
        const c = cands.filter(m => m !== prev && Math.abs(m - prev) <= 7).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
        prev = c[0] ?? prev;
        out.push(prev);
      }
      if (len >= 2) {
        if (pairs && this.rng() < pChrom) {
          // chord tone on the beat, chromatic leading note on the swung "and" (an eighth, never longer)
          const lead = clamp(appr >= target ? target + 1 : target - 1);
          out.push({ a: appr, b: lead });
        } else out.push(appr);
      }
      cur = target;
    });
    // occasional swung eighths inside the line (skip notes): the second eighth repeats the note or steps to a chord tone
    if (pairs) {
      for (let i = 1; i < out.length - 1; i++) {
        if (typeof out[i] !== 'number' || this.rng() >= pSkip) continue;
        const a = out[i], nx = typeof out[i + 1] === 'number' ? out[i + 1] : out[i + 1].a;
        const step = cands.filter(m => m !== a && Math.abs(m - a) <= 4).sort((x, y) => Math.abs(x - nx) - Math.abs(y - nx))[0];
        out[i] = { a, b: this.rng() < 0.4 || step === undefined ? a : step };
      }
    }
    const lastNote = out[out.length - 1];
    this.lastBass = typeof lastNote === 'number' ? lastNote : lastNote.b;
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
    // complexity 0…1 (fader): 0.5 is the default groove; probabilities of extra hits scale ×0.3 … ×1.7
    const cx = o.complexity ?? 0.5;
    return { out, t, spb, off: t + sw * spb, sw, style, jazz, straight, D, B, C, ch, inst, chordEnd, cx, m: 0.3 + 1.4 * cx };
  }

  /* ================= 4/4 in quarters: hand-tuned grooves ================= */
  beat44(info, o, x) {
    const { t, spb, ev, bi } = info;
    const { D, B, C, off, sw, style, ch, inst, cx, m: busy } = x;
    const num = 4, b = info.bib;
    const lastBeatOfPhrase = b === num - 1 && info.barNo % 4 === 0;

    if (style === 'swing') {
      const back = b % 2 === 1;
      D('ride', t, (b === 0 ? 0.62 : back ? 0.78 : 0.66));
      if (back) D('ride', off, 0.42);
      if (back) D('hhpedal', t, 0.75);
      if (this.rng() < 0.55) D('kick', t, 0.18);
      if (this.rng() < 0.16 * busy) D('snare', off, 0.2);
      else if (this.rng() < 0.06 * busy) D('snare', t, 0.45);
      if (cx > 0.7 && !back && this.rng() < 0.15 * busy) D('kick', off, 0.3);          // busier: kick/snare chatter
      if (lastBeatOfPhrase && this.rng() < Math.min(0.95, 0.7 * busy)) { D('snare', t, 0.5); D('snare', t + spb / 3, 0.3); D('snare', off, 0.6); if (this.rng() < 0.4) D('kick', off, 0.6); }
      if (b === 0 && info.barNo % 8 === 1 && info.barNo > 1 && this.rng() < busy) D('kick', t, 0.55);
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
      if (b === num - 2 && this.rng() < 0.45 * busy) D('kick', off, 0.6);
      if (lastBeatOfPhrase && this.rng() < Math.min(1, busy)) { D('snare', off, 0.55); D('snare', t + 0.75 * spb, 0.4); }
    }
    if (!ch) return;

    // bass
    if (info.chordStart) {
      this.line = this.walk(ch, ev.beats, info.nextEv && info.nextEv.chord,
        style === 'swing' && cx >= 0.2 ? { pairs: true, pChrom: 0.25 * busy, pSkip: 0.07 * busy } : {});
    }
    const line = this.line || [this.nearest(ch.root, 36)];
    const val = n => (typeof n === 'number' ? n : n.a);
    const root = line[0];
    const fifth = this.nearest((ch.root + ch.iv[5]) % 12, root + 5, 28, 47);
    if (style === 'swing' && cx < 0.2) {
      // simple: two-feel, half notes
      if (bi % 2 === 0) B(val(line[Math.min(bi, line.length - 1)]), t, spb * Math.min(2, ev.beats - bi) * 0.92, bi === 0 ? 1 : 0.85);
    } else if (style === 'swing') {
      const n = line[Math.min(bi, line.length - 1)];
      if (typeof n === 'number') B(n, t, spb * 0.88, bi === 0 ? 1 : 0.85);
      else { B(n.a, t, sw * spb * 0.92, 0.88); B(n.b, off, (1 - sw) * spb * 0.9, 0.72); } // swung pair of eighths
    } else if (style === 'ballad') {
      if (bi === 0) B(root, t, spb * Math.min(ev.beats, 2) * 0.95, 0.9);
      else if (bi % 2 === 0) B(val(line[Math.min(bi, line.length - 1)]), t, spb * 1.9, 0.75);
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
      const opts = left >= 4 && cx < 0.3 ? [[0], [0, 2], [1.5], [0, 2.5]]
        : left >= 4 && cx > 0.7 ? [[0, 1.5, 3], [0.5, 2, 3.5], [1.5, 2.5], [0, 1.5, 2.5], [0, 1, 2.5], [0.5, 1.5, 3]]
        : left >= 4 ? [[0, 1.5], [1.5], [0, 2.5], [0.5, 2], [1.5, 3], [0], [2.5], [0, 2]]
        : left === 3 ? [[0], [0, 1.5], [1.5], [0.5, 2]]
          : left === 2 ? [[0], [0.5], [0, 1.5]] : [[0]];
      let p = this.pick(opts);
      if (bi === 0 && !p.some(q => q < 1) && this.rng() < 0.6) p = [0, ...p];
      p = p.filter(q => q < left - 0.5 || q === 0 || left < 4);
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
    const { D, B, C, off, sw, style, jazz, straight, ch, inst, m: busy } = x;
    const pb = g.perBeat;
    // eighths that fall inside this beat, with their bar position and time
    const es = pb === 2 ? [{ j: 0, e: info.bib * 2, tt: t }, { j: 1, e: info.bib * 2 + 1, tt: off }] : [{ j: 0, e: info.bib, tt: t }];
    const eighth = pb === 2 ? spb / 2 : spb;
    // time from eighth a to eighth b inside a chord (swung offbeats are later than half a beat)
    const span = (a, b) => { const at = k => (pb === 2 ? Math.floor(k / 2) * spb + (k % 2 ? sw * spb : 0) : k * spb); return at(b) - at(a); };
    if (info.bib === 0 || !this.bar || this.bar.no !== info.barNo) {
      // per-bar choices: a 6/8 hemiola over 3/4 (accents on 1 and the "and" of 2), fills
      const waltz = o.meter.num === 3 && o.meter.den === 4 && !g.oddGroups;
      this.bar = { no: info.barNo, hemiola: waltz && this.rng() < 0.35 * busy, fill: info.barNo % 4 === 0 && this.rng() < 0.6 * busy };
    }
    const hem = this.bar.hemiola;
    const lastBeat = info.bib === (g.E / pb) - 1;

    /* drums */
    for (const { j, e, tt } of es) {
      const start = g.startSet.has(e), major = g.majorSet.has(e), mi = g.majorOf[e];
      if (jazz && !straight) {
        // swung quarters (3/4, 5/4 in 3+2, 7/4 in 4+3…): steady ride, hi-hat on the felt groups
        if (j === 0) D('ride', tt, (e === 0 ? 0.64 : major ? 0.72 : 0.62) * (style === 'ballad' ? 0.6 : 1));
        else if (info.bib % 2 === 1 && !hem) D('ride', tt, 0.4 * (style === 'ballad' ? 0.7 : 1));
        if (major && e !== 0 && !(hem && e === 2)) D('hhpedal', tt, 0.72);
        if (hem && (e === 0 || e === 3)) { D(e === 0 ? 'kick' : 'snare', tt, e === 0 ? 0.4 : 0.42); if (e === 3) D('ride', tt, 0.55); }
        else if (major && this.rng() < 0.5) D('kick', tt, e === 0 ? 0.3 : 0.18);
        if (j === 1 && this.rng() < 0.14 * busy) D('snare', tt, 0.2);
      } else if (jazz) {
        // odd groupings or x/8: the ride keeps flowing in eighths whatever the grouping; the groups only shape its
        // dynamics. Very fast tempos drop to quarter-note pulses (every 2 eighths, or the group starts in x/8).
        const fast = eighth < 0.15;
        const plays = !fast || (pb === 2 ? j === 0 : start);
        if (plays) {
          const base = major ? 0.74 : start ? 0.6 : 0.42;
          // a slight long-short lilt inside each group keeps it from sounding mechanical
          const pos = e - (g.starts.filter(x => x <= e).pop() ?? 0);
          D('ride', tt, base * (pos === 1 ? 0.92 : 1) * this.r(0.94, 1.06));
        }
        if (major && e !== 0) D('hhpedal', tt, 0.65);
        if (e === 0) D('kick', tt, 0.4);
        else if (major && this.rng() < 0.3) D('kick', tt, 0.22);
        if (major && mi === g.majors.length - 1 && this.rng() < 0.4 * busy) D('xstick', tt, 0.35);
        if (!start && this.rng() < 0.08 * busy) D('snare', tt, 0.18);
      } else {
        D('hhclosed', tt, start ? 0.55 : 0.32);
        if (major) {
          if (mi % 2 === 0) D('kick', tt, e === 0 ? 0.8 : 0.65);
          else D(style === 'bossa' ? 'xstick' : 'snare', tt, style === 'bossa' ? 0.7 : 0.78);
        } else if (start && this.rng() < 0.25 * busy) D(style === 'bossa' ? 'xstick' : 'kick', tt, 0.4);
      }
      if (this.bar.fill && lastBeat && j === pb - 1) { D('snare', tt, 0.5); if (pb === 2) D('snare', tt - eighth / 2, 0.3); }
    }
    if (!ch) return;

    /* bass and harmony are planned once per chord, eighth by eighth */
    const startE = ev.start * pb, lenE = ev.beats * pb;
    const barE = k => (startE + k) % g.E;
    if (info.chordStart) {
      const nextCh = info.nextEv && info.nextEv.chord;
      // bass hits: the felt groups (plus, the busier the setting, some of the smaller groups)
      let hits = [];
      const waltz = o.meter.num === 3 && o.meter.den === 4 && !g.oddGroups;
      const walkAll = jazz && style === 'swing' && !straight && this.rng() < Math.min(0.9, (waltz ? 0.35 : 0.5) * busy);
      for (let k = 0; k < lenE; k++) {
        const be = barE(k);
        if (k === 0) { hits.push(k); continue; }
        if (walkAll) { if (k % 2 === 0) hits.push(k); continue; }
        if (waltz && jazz) { if (be === 4 || be === 0) hits.push(k); continue; } // "1 . 3"
        if (g.majorSet.has(be)) { hits.push(k); continue; }
        if (g.startSet.has(be) && this.rng() < 0.35 * busy) { hits.push(k); continue; }
        if (!jazz && g.majorSet.has((be + 1) % g.E) && this.rng() < 0.3 * busy) hits.push(k); // pickup into a group
      }
      const pairs = walkAll && pb === 2;
      const line = jazz ? this.walk(ch, hits.length, nextCh, pairs ? { pairs, pChrom: 0.22 * busy, pSkip: 0.07 * busy } : {})
        : hits.map((k, i) => {
          const root = this.nearest(ch.bass ?? ch.root, Math.min(Math.max(this.lastBass, 31), 45), 28, 47);
          if (i === 0) return root;
          if (i === hits.length - 1 && nextCh && hits.length > 2) { // the next chord's fifth leads into it (never a long chromatic note)
            const tg = this.nearest(nextCh.bass ?? nextCh.root, root, 28, 47);
            return tg + 7 <= BASS_HI ? tg + 7 : tg - 5;
          }
          return i % 2 ? this.nearest((ch.root + ch.iv[5]) % 12, root + 5, 28, 47) : root;
        });
      const plan = new Map();
      hits.forEach((k, i) => {
        const n = line[i], nextK = hits[i + 1] ?? lenE;
        if (typeof n === 'number') plan.set(k, { midi: n, len: nextK - k });
        else { plan.set(k, { midi: n.a, len: 1 }); plan.set(k + 1, { midi: n.b, len: Math.min(1, nextK - k - 1) || 1 }); }
      });
      // a chromatic leading eighth into the next chord, on the last eighth (never longer than an eighth)
      const lastK = lenE - 1;
      if (nextCh && lenE >= 3 && !plan.has(lastK) && info.nextEv.label !== ev.label && this.rng() < 0.22 * busy) {
        const prevK = Math.max(...[...plan.keys()].filter(k => k < lastK));
        const tg = this.nearest(nextCh.bass ?? nextCh.root, plan.get(prevK).midi, 28, 47);
        const lead = plan.get(prevK).midi >= tg ? tg + 1 : tg - 1;
        plan.get(prevK).len = lastK - prevK;
        plan.set(lastK, { midi: Math.max(BASS_LO, Math.min(BASS_HI, lead)), len: 1 });
      }
      const lastNote = plan.get(Math.max(...plan.keys())).midi;
      this.lastBass = lastNote;
      this.bassPlan = plan;
      // harmony hits; complexity scales everything except the first hit
      const comp = [];
      for (let k = 0; k < lenE; k++) {
        const be = barE(k), start = g.startSet.has(be), major = g.majorSet.has(be);
        let p;
        if (k === 0) p = this.antSkip ? 0 : (style === 'ballad' ? 1 : 0.62);
        else if (inst === 'guitar' && jazz && !straight) p = k % 2 === 0 ? 1 : 0;  // four (three, five…) to the bar
        else if (inst === 'guitar' && style === 'even') p = (start ? 0.3 : 0.6) * busy;
        else if (style === 'ballad') p = major ? 0.2 * busy : 0;
        else if (waltz && this.bar.hemiola) p = be === 3 ? 0.7 : 0;
        else if (major) p = 0.4 * busy;
        else if (start) p = 0.2 * busy;
        else if (g.majorSet.has((be + 1) % g.E)) p = 0.2 * busy;            // just before a group: syncopation
        else p = (pb === 2 && k % 2 === 1 ? 0.1 : 0.05) * busy;
        if (this.rng() < p) comp.push(k);
      }
      if (!comp.length && !this.antSkip) comp.push(0);
      this.compPlan = comp;
    }
    for (const { j, tt } of es) {
      const k = bi * pb + j;
      const bh = this.bassPlan && this.bassPlan.get(k);
      if (bh) B(bh.midi, tt, span(k, k + bh.len) * 0.92, k === 0 ? 1 : 0.85);
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
    const p = { swing: 0.3, bossa: 0.25, even: 0.15, ballad: 0.1 }[x.style] * (x.inst === 'guitar' && x.style === 'swing' ? 0.3 : 1) * x.m;
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
