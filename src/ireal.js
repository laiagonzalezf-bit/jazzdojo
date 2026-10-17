// Progression import: iReal Pro links/HTML exports and hand-written chord text.
// Output format (MiliJazz's own intermediate format):
//   { title, style, bpm, meter: {num, den}, events: [{label, bars}], unknown: [labels] }
// `bars` is the chord's length in bars; beats are derived from the meter, so the meter can change later.
import { parseChord, FLATS } from './theory.js';

/* iReal Pro obfuscation (reverse-engineered by the community: pianosnake/ireal-reader, ironss/accompaniser). */
function obfusc50(s) {
  const a = s.split('');
  for (let i = 0; i < 5; i++) { a[49 - i] = s[i]; a[i] = s[49 - i]; }
  for (let i = 10; i < 24; i++) { a[49 - i] = s[i]; a[i] = s[49 - i]; }
  return a.join('');
}
export function unscramble(s) {
  let r = '';
  while (s.length > 51) { r += obfusc50(s.substring(0, 50)); s = s.substring(50); }
  r += s;
  return r.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   ');
}
/** Inverse of unscramble (used by the tests to build iReal links). */
export function scramble(m) {
  let s = m.replace(/\| x/g, 'Kcl').replace(/ \|/g, 'LZ').replace(/ {3}/g, 'XyQ');
  let r = '';
  while (s.length > 51) { r += obfusc50(s.substring(0, 50)); s = s.substring(50); }
  return r + s;
}

export function styleFromName(n) {
  n = (n || '').toLowerCase();
  if (/bossa|latin|samba|cha|rumba|afro|calypso|reggae/.test(n)) return 'bossa';
  if (/ballad|slow/.test(n)) return 'ballad';
  if (/rock|pop|even|funk|soul|r&b|rnb|country|gospel|folk/.test(n)) return 'even';
  return 'swing';
}

/** Tokenises an unscrambled iReal music string into measures (arrays of chord labels; '%' = continue previous). */
export function parseMusic(str) {
  const items = [];
  let meter = { num: 4, den: 4 }, i = 0, cur = null, ending = 0;
  const open = () => { if (!cur) cur = { slots: [], ending }; };
  const close = () => { if (cur) { if (cur.slots.length || cur.rep) items.push({ t: 'm', ...cur }); cur = null; } };
  while (i < str.length) {
    const s = str.slice(i);
    let m;
    if ((m = /^<[^>]*>/.exec(s))) { i += m[0].length; continue; }
    if (/^\*[A-Za-z]/.test(s)) { i += 2; continue; }
    if ((m = /^T(\d)(\d)/.exec(s))) {
      meter = m[0] === 'T12' ? { num: 12, den: 8 } : { num: +m[1] || 4, den: +m[2] || 4 };
      i += 3; continue;
    }
    if ((m = /^N(\d)/.exec(s))) { close(); ending = +m[1]; i += 2; continue; }
    const c = s[0];
    if (c === '{') { close(); ending = 0; items.push({ t: '{' }); i++; continue; }
    if (c === '}') { close(); items.push({ t: '}' }); ending = 0; i++; continue; }
    if (c === '[' || c === ']' || c === 'Z') { close(); ending = 0; i++; continue; }
    if (c === '|') { close(); i++; continue; }
    if (c === 'x') { open(); cur.rep = 1; i++; continue; }
    if (c === 'r') { close(); items.push({ t: 'm', rep: 2, slots: [], ending }); i++; continue; }
    if (c === 'n') { open(); cur.slots.push(null); i++; continue; }
    if (c === 'p') { open(); cur.slots.push('%'); i++; continue; }
    if (c === 'W') { m = /^W(\/[A-G][b#]?)?/.exec(s); open(); cur.slots.push('%'); i += m[0].length; continue; }
    if ((m = /^[A-G][b#]?[^\s,|[\]{}()<>/xZ*]*(\/[A-G][b#]?)?/.exec(s))) {
      open();
      cur.slots.push(m[0].replace(/[QSfYUsl]+$/, ''));
      i += m[0].length;
      const alt = /^\([^)]*\)/.exec(str.slice(i));
      if (alt) i += alt[0].length;
      continue;
    }
    i++;
  }
  close();
  // Expand repeats and 1st/2nd endings.
  const out = [];
  let k = 0, repStart = 0, pass = 1, guard = 0;
  while (k < items.length && guard++ < 10000) {
    const it = items[k];
    if (it.t === '{') { repStart = k + 1; pass = 1; k++; continue; }
    if (it.t === '}') { if (pass === 1) { pass = 2; k = repStart; } else k++; continue; }
    if (it.ending && ((pass === 1 && it.ending > 1) || (pass === 2 && it.ending === 1))) { k++; continue; }
    if (it.rep === 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if (a) out.push(a.slice());
      if (b) out.push(b.slice());
      k++; continue;
    }
    if (it.rep === 1 && !it.slots.length) { out.push(out.length ? out[out.length - 1].slice() : ['%']); k++; continue; }
    out.push(it.slots.length ? it.slots.slice() : ['%']);
    k++;
  }
  return { meter, measures: out };
}

/** Splits each measure among its chords and merges consecutive identical chords. */
export function measuresToEvents(measures, beatsPerBar = 4) {
  const ev = [];
  const split = n => {
    if (n <= 1) return [beatsPerBar];
    if (n === 2) return beatsPerBar % 2 ? [Math.ceil(beatsPerBar / 2), Math.floor(beatsPerBar / 2)] : [beatsPerBar / 2, beatsPerBar / 2];
    if (n === 3 && beatsPerBar === 4) return [2, 1, 1];
    const base = Math.max(1, Math.floor(beatsPerBar / n));
    const a = Array(n).fill(base);
    a[0] += Math.max(0, beatsPerBar - base * n);
    return a;
  };
  for (const ms of measures) {
    const durs = split(ms.length);
    ms.forEach((lab, j) => {
      const bars = durs[j] / beatsPerBar;
      const prev = ev[ev.length - 1];
      const label = lab === '%' ? (prev ? prev.label : null) : lab;
      if (prev && prev.label === label) prev.bars += bars;
      else ev.push({ label, bars });
    });
  }
  return ev.map(e => ({ label: e.label, bars: +e.bars.toFixed(4) }));
}

function unknownLabels(events) {
  return [...new Set(events.filter(e => e.label && !parseChord(e.label)).map(e => e.label))];
}

export function parseIReal(text) {
  const links = String(text).match(/irealb(?:ook)?:\/\/[^"'<>\s]+/g) || [];
  const songs = [];
  for (const link of links) {
    const old = link.startsWith('irealbook');
    let body = link.replace(/^irealb(?:ook)?:\/\//, '');
    try { body = decodeURIComponent(body); } catch (e) { try { body = unescape(body); } catch (_) { /* keep raw */ } }
    for (const part of body.split('===')) {
      let title, style, music, bpm = 0, key;
      if (part.includes('1r34LbKcu7')) {
        const f = part.split('=');
        const mi = f.findIndex(x => x.includes('1r34LbKcu7'));
        title = f[0]; style = f[3]; key = f[4];
        music = unscramble(f[mi].split('1r34LbKcu7')[1]);
        bpm = +f[mi + 2] || 0;
      } else if (old) {
        const f = part.split('=').filter(x => x !== '');
        if (f.length < 5) continue;
        [title, , style, key, music] = f;
      } else continue;
      title = (title || 'Sense títol').trim().replace(/^(.*), (The|A|An)$/, '$2 $1');
      const { meter, measures } = parseMusic(music);
      let events = measuresToEvents(measures, meter.num);
      while (events.length && !events[0].label) events.shift();
      if (!events.some(e => e.label)) continue;
      songs.push({ title, style: styleFromName(style), styleName: style || '', key: key || '', bpm: bpm || 120, meter, events, unknown: unknownLabels(events), src: 'ireal' });
    }
  }
  return songs;
}

/** "Cmaj9 | F7 | Bb-7 Eb7 |" — each | is a bar; without bars, one chord per bar. '%', '/' or 'x' repeat the previous chord. */
export function parseTextChords(text, meter = { num: 4, den: 4 }) {
  const t = String(text || '').trim();
  if (!t) return null;
  let measures;
  if (t.includes('|')) measures = t.split('|').map(m => m.trim()).filter(Boolean).map(m => m.split(/[\s,]+/).filter(Boolean));
  else measures = t.split(/[\s,]+/).filter(Boolean).map(c => [c]);
  measures = measures.map(ms => ms.map(c => (c === '%' || c === '/' || c === 'x') ? '%' : c));
  if (!measures.length) return null;
  const events = measuresToEvents(measures, meter.num);
  const unknown = unknownLabels(events);
  return { title: 'Progressió escrita a mà', style: 'swing', bpm: 120, meter, events, unknown, src: 'text' };
}

/** Back to editable text, one bar per "|" group where possible. */
export function eventsToText(events) {
  const out = [];
  let acc = 0, bar = [];
  for (const e of events) {
    const lab = e.label || 'NC';
    if (e.bars >= 1 && acc === 0) {
      out.push(lab);
      for (let i = 1; i < Math.round(e.bars); i++) out.push('%');
      continue;
    }
    bar.push(lab); acc += e.bars;
    if (acc >= 0.999) { out.push(bar.join(' ')); bar = []; acc = 0; }
  }
  if (bar.length) out.push(bar.join(' '));
  return out.join(' | ');
}

export const QUALS = [['^7', 'Δ7'], ['^9', 'Δ9'], ['69', '6/9'], ['-7', 'm7'], ['-9', 'm9'], ['-11', 'm11'], ['-^7', 'mΔ7'],
  ['7', '7'], ['9', '9'], ['13', '13'], ['7b9', '7♭9'], ['7alt', '7alt'], ['7sus', '7sus4'], ['h7', 'ø7'], ['o7', '°7']];
// Movement between consecutive roots, in semitones upwards (mod 12). Order as shown in the generator.
export const CYCLES = [
  [5, 'Per quartes'], [7, 'Per quintes'], [1, 'Cromàtic ascendent'], [11, 'Cromàtic descendent'],
  [2, 'Per tons ascendents'], [10, 'Per tons descendents'], [3, 'Per terceres menors ascendents'], [9, 'Per terceres menors descendents'],
  [4, 'Per terceres majors ascendents'], [8, 'Per terceres majors descendents'], [6, 'Per trítons'],
];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** The twelve roots for a movement. Steps that don't reach all twelve notes (tones, thirds, tritones)
 *  restart a semitone away, in the direction of the movement, once each cycle closes. */
export function cycleRoots(step, root) {
  const len = 12 / gcd(step, 12), shift = step <= 6 ? 1 : 11, out = [];
  let start = root;
  while (out.length < 12) {
    for (let i = 0; i < len && out.length < 12; i++) out.push((start + i * step) % 12);
    start = (start + shift) % 12;
  }
  return out;
}

export function generateCycle(quals, step, root, bars, meter = { num: 4, den: 4 }) {
  const events = [];
  const roots = cycleRoots(step, root);
  for (const q of quals) for (const r of roots) events.push({ label: FLATS[r] + q, bars });
  const names = quals.map(q => (QUALS.find(x => x[0] === q) || [q, q])[1]).join(' · ');
  const mv = (CYCLES.find(c => c[0] === step) || [0, ''])[1].toLowerCase();
  return { title: `${names} ${mv}`.trim(), style: 'swing', bpm: 100, meter, events, unknown: [], src: 'gen' };
}
