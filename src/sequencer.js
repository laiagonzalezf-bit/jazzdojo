// Musical clock logic, independent of audio and UI.
// The caller advances it one beat at a time with the beat's audio-clock time; the sequencer decides which chord
// sounds, when a new arpeggio slot begins (by chord, beats, bars or seconds), and how loops wrap.

/** Adds beats/start/bar info to song events for a given meter. */
export function layout(events, meter) {
  let start = 0;
  return events.map((e, i) => {
    const beats = Math.max(1, Math.round(e.bars * meter.num));
    const out = { ...e, i, beats, start };
    start += beats;
    return out;
  });
}

export class Sequencer {
  /**
   * @param {{events:Array, meter:{num:number,den:number}}} song  events already laid out (see layout())
   * @param {() => {loop:'off'|'all'|'range', range:[number,number]|null, change:'chord'|'beats'|'bars'|'seconds',
   *                 every:number, seconds:number, syncChord:boolean, laps:'new'|'repeat'}} getCfg
   */
  constructor(song, getCfg) {
    this.song = song;
    this.E = song.events;
    this.cfg = getCfg;
    this.reset(0);
  }
  get bpb() { return this.song.meter.num; }
  region() {
    const c = this.cfg(), N = this.E.length;
    if (c.loop === 'range' && c.range) return [Math.max(0, c.range[0]), Math.min(N - 1, c.range[1])];
    return [0, N - 1];
  }
  nextIdx(i) {
    const c = this.cfg(), N = this.E.length;
    if (c.loop === 'off') return i + 1 < N ? i + 1 : -1;
    const [a, b] = this.region();
    if (i >= b || i < a) return a;
    return i + 1;
  }
  startIndex(start) {
    const c = this.cfg();
    const [a, b] = this.region();
    if (c.loop === 'range' && (start < a || start > b)) return a;
    return Math.max(0, Math.min(start, this.E.length - 1));
  }
  reset(startIdx) {
    Object.assign(this, { ev: this.startIndex(startIdx), bi: 0, elapsed: 0, k: -1, slotStart: 0, slotLen: 0, lap: 1, justWrapped: false, nextArpT: 0, done: false });
  }
  /** Jump to a chord without stopping; the next beat is that chord's first beat. */
  jump(i) {
    this.ev = Math.max(0, Math.min(i, this.E.length - 1));
    this.bi = 0;
    this.forceSlot = true;
  }
  /** Beats left from the current position to the end of the loop region (Infinity if not looping). */
  lapRemaining() {
    const c = this.cfg();
    if (c.loop === 'off') return Infinity;
    const [a, b] = this.region();
    if (this.ev < a || this.ev > b) return Infinity;
    let r = -this.bi;
    for (let i = this.ev; i <= b; i++) r += this.E[i].beats;
    return r;
  }
  upcoming(i, n = 3) {
    const out = [i];
    while (out.length < n) { const last = out[out.length - 1]; out.push(last < 0 ? -1 : this.nextIdx(last)); }
    return out;
  }
  /** Advances one beat. `t` = audio time of this beat, `spb` = seconds per beat at this moment. */
  step(t, spb) {
    const c = this.cfg();
    const ev = this.E[this.ev];
    const chordStart = this.bi === 0;
    const wrapped = this.justWrapped;
    this.justWrapped = false;
    const changes = [];
    let force = !!this.forceSlot;
    this.forceSlot = false;
    if (wrapped && c.laps === 'repeat') { this.k = -1; force = true; }

    if (c.change === 'seconds') {
      const L = Math.max(0.5, c.seconds || 4);
      if (this.k < 0 || force || (c.syncChord && chordStart)) {
        this.k++;
        this.nextArpT = t + L;
        changes.push({ t, k: this.k, nextK: this.k + 1, lenSec: L });
      }
      while (this.nextArpT < t + spb - 1e-6) {
        this.k++;
        changes.push({ t: this.nextArpT, k: this.k, nextK: this.k + 1, lenSec: L });
        this.nextArpT += L;
      }
    } else {
      let L = c.change === 'chord' ? ev.beats - this.bi
        : c.change === 'beats' ? Math.max(1, c.every | 0) : Math.max(1, c.every | 0) * this.bpb;
      const due = this.k < 0 || force
        || (c.change === 'chord' ? chordStart : (this.elapsed - this.slotStart >= this.slotLen) || (c.syncChord && chordStart));
      if (due) {
        if (c.syncChord && c.change !== 'chord') L = Math.min(L, ev.beats - this.bi);
        this.k++;
        this.slotStart = this.elapsed;
        this.slotLen = L;
        const nextK = (c.laps === 'repeat' && this.lapRemaining() <= L) ? 0 : this.k + 1;
        changes.push({ t, k: this.k, nextK, len: L });
      }
    }

    const info = {
      t, spb, evIdx: this.ev, ev, bi: this.bi, chordStart, wrapped, lap: this.lap,
      bib: (ev.start + this.bi) % this.bpb,
      barNo: Math.floor((ev.start + this.bi) / this.bpb) + 1,
      inSlot: this.elapsed - this.slotStart, slotLen: this.slotLen, k: this.k,
      changes, upcoming: chordStart ? this.upcoming(this.ev) : null,
    };
    const n1 = this.nextIdx(this.ev);
    info.nextEv = n1 >= 0 ? this.E[n1] : null;

    // advance
    this.bi++;
    this.elapsed++;
    if (this.bi >= ev.beats) {
      this.bi = 0;
      const n = n1;
      if (n < 0) this.done = true;
      else {
        if (c.loop !== 'off' && n <= this.ev) { this.justWrapped = true; this.lap++; }
        this.ev = n;
      }
    }
    info.done = this.done;
    return info;
  }
}
