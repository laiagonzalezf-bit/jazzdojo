// Chord symbols → structured chords. Pure functions, no DOM.

export const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const DEGREES = [1, 3, 5, 7, 9, 11, 13];

export function pcOf(name) {
  let p = PC[name[0]];
  for (const c of name.slice(1)) {
    if (c === 'b' || c === '♭') p--;
    else if (c === '#' || c === '♯') p++;
  }
  return (p + 12) % 12;
}

/** Normalises a quality string (text or iReal style) to iReal-ish tokens: ^ maj, - minor, h half-dim, o dim, + aug. */
export function normalizeQuality(q0) {
  let q = (q0 || '').replace(/♭/g, 'b').replace(/♯/g, '#').replace(/Δ/g, '^').replace(/ø/g, 'h').replace(/°/g, 'o').replace(/\s/g, '');
  q = q.replace(/maj|Maj|MAJ|MA|ma|M(?=\d|$)/g, '^');
  q = q.replace(/^(min|mi|m)/, '-');
  q = q.replace(/^-7b5|^-7\(b5\)/, 'h7');
  q = q.replace(/^dim/, 'o').replace(/^aug/, '+');
  return q;
}

export function analyzeQuality(q0) {
  const q = normalizeQuality(q0);
  const minor = q.startsWith('-');
  const hdim = q.startsWith('h');
  const dim = q.startsWith('o');
  const alt = /alt/.test(q);
  const aug = q.startsWith('+') || /#5|\+5/.test(q);
  const sus4 = /sus(?!2)/.test(q);
  const sus2 = /sus2/.test(q);
  const maj7 = q.includes('^');
  const noAdd = q.replace(/add\d+/g, '');
  const six = /6/.test(noAdd.replace(/b6|#6|13/g, ''));
  const has7 = maj7 || hdim || (dim && /7/.test(q)) || (!six && /7|9|11|13|alt/.test(noAdd));
  const dom = has7 && !maj7 && !minor && !hdim && !dim;

  const iv = { 1: 0 };
  iv[3] = sus4 ? 5 : sus2 ? 2 : (minor || hdim || dim) ? 3 : 4;
  iv[5] = (hdim || dim || /b5/.test(q)) ? 6 : (aug || alt) ? 8 : 7;
  iv[7] = maj7 ? 11 : (dim && /7/.test(q)) ? 9 : six ? 9 : 10;
  iv[9] = /b9/.test(q) ? 1 : /#9/.test(q) ? 3 : alt ? 1 : 2;
  const explicit11 = /#11/.test(q) ? 6 : /11/.test(q) ? 5 : null;
  // 11 on major and dominant chords defaults to ♯11 (lydian / lydian dominant); configurable via `sharp11`.
  const auto11 = explicit11 === null && (maj7 || (dom && !sus4));
  iv[11] = explicit11 ?? (auto11 ? 6 : 5);
  iv[13] = (/b13/.test(q) || alt || hdim) ? 8 : 9;

  // Degrees literally present in the symbol (used by "only written degrees").
  const written = [1, 3, 5];
  if (has7 || six) written.push(7);
  if (/9|11|13|alt|69/.test(q)) written.push(9);
  if (/11/.test(q)) written.push(11);
  if (/13|alt/.test(q)) written.push(13);

  // Rootless comping voicing (pitch-class intervals above the root).
  const tones = [];
  tones.push(sus4 ? 5 : iv[3]);
  if (has7 || six) tones.push(iv[7]);
  if (!dim && !(hdim && !/9/.test(q))) tones.push(iv[9]);
  tones.push(/13/.test(q) || alt ? iv[13] : iv[5]);

  return { q, iv, auto11, written, tones: [...new Set(tones.map(x => x % 12))], minor, dom, maj7, hdim, dim, six, sus4 };
}

/** Parses "Cmaj9", "C^9", "Bb-7", "F#h7", "G7alt/B"... Returns null if there is no recognizable root. */
export function parseChord(label) {
  if (!label) return null;
  const m = /^([A-G])([b#♭♯]?)(.*)$/.exec(String(label).trim());
  if (!m) return null;
  let rest = m[3];
  let bass = null;
  const sl = /\/([A-G][b#♭♯]?)$/.exec(rest);
  if (sl) { bass = pcOf(sl[1]); rest = rest.slice(0, -sl[0].length); }
  rest = rest.replace(/\(.*?\)/g, '');
  if (!/^[0-9^\-+#b♭♯hoaltusdijMmngΔø°/]*$/.test(rest.replace(/\s/g, ''))) return null;
  const root = pcOf(m[1] + m[2]);
  const a = analyzeQuality(rest);
  const flat = m[2] === 'b' || m[2] === '♭' || (m[1] === 'F' && !m[2]) || ((a.minor || a.hdim || a.dim) && ['C', 'G', 'D'].includes(m[1]) && !m[2]);
  return { root, bass, flat, label, rootName: m[1] + (m[2] === '♭' ? 'b' : m[2] === '♯' ? '#' : m[2]), ...a };
}

/** Interval in semitones of a degree for a parsed chord. */
export function degreeInterval(chord, deg, opts = {}) {
  if (deg === 11 && chord.auto11 && opts.sharp11 === false) return 5;
  const map = { 2: 9, 4: 11, 6: 13 };
  return chord.iv[map[deg] || deg] ?? 0;
}

/** Spells a chord degree with the right letter: C7's 7 is B♭ (not A♯). Double sharps/flats are simplified (E7♯9's ♯9 → G). */
export function spellDegree(chord, deg, opts = {}) {
  const L = 'CDEFGAB', NAT = [0, 2, 4, 5, 7, 9, 11];
  const li = L.indexOf((chord.rootName || 'C')[0]);
  let steps = (deg - 1) % 7;
  if (deg === 7 && chord.six) steps = 5;           // 6 chords: the "7" slot is the 6th
  if (deg === 3 && chord.sus4) steps = 3;          // sus4: the "3" slot is the 4th
  const letter = (li + steps) % 7;
  const pc = (chord.root + degreeInterval(chord, deg, opts)) % 12;
  let diff = ((pc - NAT[letter]) % 12 + 12) % 12;
  if (diff > 6) diff -= 12;
  if (Math.abs(diff) !== 1 && diff !== 0) return noteName(pc, diff < 0);
  return L[letter] + ({ '-1': '♭', 0: '', 1: '♯' }[diff]);
}

export function noteName(pc, flat) {
  return (flat ? FLATS : SHARPS)[((pc % 12) + 12) % 12].replace('b', '♭').replace('#', '♯');
}

/** Display form: C^9 → CΔ9, D-7 → Dm7, Bh7 → Bø7. */
export function pretty(label) {
  if (!label) return 'N.C.';
  const m = /^([A-G])([b#]?)([^/]*)(\/[A-G][b#]?)?$/.exec(label);
  if (!m) return label;
  let q = m[3].replace(/\(.*?\)/g, '');
  q = q.replace(/^maj/, '^').replace(/^-\^/, 'mΔ').replace(/\^/g, 'Δ').replace(/^-/, 'm').replace(/^h/, 'ø').replace(/^o/, '°')
    .replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1');
  if (q === 'Δ') q = 'Δ7';
  if (q === 'ø') q = 'ø7';
  const acc = s => s.replace('b', '♭').replace('#', '♯');
  return acc(m[1] + m[2]) + q + (m[4] ? '/' + acc(m[4].slice(1)) : '');
}

/** Chord quality families used to organise and filter exercises. */
export function family(chord) {
  if (!chord) return 'altres';
  if (chord.hdim) return 'm7♭5';
  if (chord.dim) return 'disminuït';
  if (chord.sus4) return 'sus';
  if (chord.minor) return 'menor';
  if (chord.dom) return 'dominant';
  if (chord.maj7 || chord.six) return 'major';
  return 'tríada';
}
