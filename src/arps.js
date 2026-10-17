// Arpeggio pattern engine. Pure: takes settings and an injectable RNG.
// A pattern is an array of chord degrees, e.g. [5, 3, 9, 7, 1].
import { DEGREES } from './theory.js';

/** "13579, 53971, 1-3-11-7" → [[1,3,5,7,9],[5,3,9,7,1],[1,3,11,7]] */
export function parsePatterns(text) {
  return String(text || '').split(/[,;\n]+/).map(p => p.trim()).filter(Boolean).map(p => {
    const parts = /[-.\s]/.test(p) ? p.split(/[-.\s]+/) : p.split('');
    return parts.map(Number).filter(n => n >= 1 && n <= 13);
  }).filter(a => a.length);
}

const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * settings: { source:'random'|'list', degrees:number[], len:number, patterns:string, order:'shuffle'|'seq', onlyWritten:boolean }
 * Arpeggios are cached by slot index k, so looping back to a slot can show the same pattern again.
 */
export class ArpEngine {
  constructor(getSettings, rng = Math.random) {
    this.get = getSettings;
    this.rng = rng;
    this.reset();
  }
  reset(keepUpTo = -1) {
    this.list = keepUpTo >= 0 && this.list ? this.list.slice(0, keepUpTo + 1) : [];
    this.src = keepUpTo >= 0 && this.src ? this.src.slice(0, keepUpTo + 1) : [];
    this.seq = 0;
  }
  /** Own patterns shown as fixed rows: a short list (≤ 4) played in order. Returns the patterns or null. */
  fixedRows() {
    const s = this.get();
    if (s.source !== 'list' || s.order !== 'seq') return null;
    const pats = parsePatterns(s.patterns);
    return pats.length >= 1 && pats.length <= 4 ? pats : null;
  }
  /** Index in the pattern list of the pattern used for slot k (own lists only), else -1. */
  sourceIndex(k) { return this.src[k] ?? -1; }
  /** Degrees allowed for a chord (all selected degrees, or only those written in the symbol). */
  allowed(chord) {
    const s = this.get();
    let deg = (s.degrees && s.degrees.length ? s.degrees : [1, 3, 5, 7]).filter(d => DEGREES.includes(d));
    if (s.onlyWritten && chord) {
      const w = deg.filter(d => chord.written.includes(d));
      if (w.length >= 2) deg = w;
    }
    return deg;
  }
  recent(n = 3) { return this.list.slice(-n); }
  make(chord) {
    const s = this.get();
    const prev = this.list[this.list.length - 1];
    if (s.source === 'list') {
      let pats = parsePatterns(s.patterns);
      if (s.onlyWritten && chord) {
        const ok = pats.filter(p => p.every(d => chord.written.includes(d)));
        if (ok.length) pats = ok;
      }
      if (pats.length) {
        if (s.order === 'seq') { const i = (this.seq++) % pats.length; this.lastSrc = parsePatterns(s.patterns).findIndex(p => same(p, pats[i])); return pats[i]; }
        const recent = this.recent(Math.min(3, pats.length - 1));
        for (let t = 0; t < 20; t++) {
          const p = pats[Math.floor(this.rng() * pats.length)];
          if (!recent.some(r => same(r, p))) return p;
        }
        return pats[Math.floor(this.rng() * pats.length)];
      }
    }
    const deg = this.allowed(chord);
    const n = Math.max(1, Math.min(s.len || deg.length, deg.length));
    let best = null;
    const recent = this.recent(3);
    for (let t = 0; t < 40; t++) {
      const a = deg.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      const c = a.slice(0, n);
      best = c;
      const repeats = recent.some(r => same(r, c));
      const sameStart = prev && n >= 3 && c[0] === prev[0];
      if (!repeats && !sameStart) break;
    }
    return best;
  }
  /** Pattern for slot k. `chordFor(k)` may return the chord sounding in that slot (for "only written degrees"). */
  at(k, chordFor) {
    if (k < 0) k = 0;
    while (this.list.length <= k) {
      this.lastSrc = -1;
      this.list.push(this.make(chordFor ? chordFor(this.list.length) : null));
      this.src.push(this.lastSrc);
    }
    return this.list[k];
  }
}
