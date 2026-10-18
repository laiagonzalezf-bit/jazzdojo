// JazzDojo app: state, persistence, scheduling loop and UI wiring.
import { parseChord, pretty, spellDegree, family, FLATS, DEGREES } from './theory.js';
import { parseIReal, parseTextChords, eventsToText, generateCycle, cycleRoots, QUALS, CYCLES } from './ireal.js';
import { ArpEngine } from './arps.js';
import { Sequencer, layout } from './sequencer.js';
import { Groove } from './groove.js';
import { METERS, GROUPINGS, groupsOf, meterGrid, groupLabel } from './meter.js';
import { AudioEngine } from './audio.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- storage ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const BELTS = [['blanc', '#EDEBE4', 'Blanc'], ['groc', '#E9C33B', 'Groc'], ['taronja', '#E8873A', 'Taronja'], ['verd', '#4E9A5A', 'Verd'],
  ['blau', '#3F78C0', 'Blau'], ['marro', '#7A5233', 'Marró'], ['negre', '#0E0D0B', 'Negre']];
const DEF = {
  degrees: [1, 3, 5, 7, 9], len: 5, onlyWritten: false, source: 'random', order: 'shuffle',
  sets: [{ id: 'set1', name: 'Bàsics', text: '13579, 53971, 97531, 35791, 1357, 7531' }], setId: 'set1',
  change: 'chord', every: { beats: 2, bars: 2, seconds: 4 }, syncChord: true, laps: 'new', sharp11: true,
  lead: 'slot', leadBeats: 2, countIn: true, harmony: 'piano', theme: 'dark', vol: { bass: 0.8, drums: 0.7, comp: 0.6, master: 0.85 },
  songId: null, songPrefs: {}, hideNames: false,
};
const S = Object.assign({}, DEF, store.get('jd.settings', {}));
S.vol = Object.assign({}, DEF.vol, S.vol || {});
S.every = Object.assign({}, DEF.every, S.every || {});
if (!S.sets || !S.sets.length) S.sets = DEF.sets;
const saveS = () => store.set('jd.settings', S);

const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function seedLibrary() {
  const a = generateCycle(['^9', '9', '-9'], 5, 0, 1);
  const b = generateCycle(['-7', '7', '^7'], 5, 0, 2);
  const c = generateCycle(['h7', '7alt', '-^7'], 5, 0, 2);
  return [
    { ...a, id: 'demo1', title: 'Cicle de quartes · Δ9, 9, m9', level: 'blanc', goals: ['cicle de quartes', 'extensions'], key: 'totes' },
    { ...b, id: 'demo2', title: 'Cicle de quartes · m7, 7, Δ7 (2 compassos)', level: 'groc', goals: ['cicle de quartes'], key: 'totes' },
    { ...c, id: 'demo3', title: 'Menor: ø7, 7alt, mΔ7', level: 'blau', goals: ['dominants alterats', 'menor'], key: 'totes' },
  ];
}
let library = store.get('jd.library', null);
if (!Array.isArray(library) || !library.length) library = seedLibrary();
const saveLib = () => store.set('jd.library', library);

/* ---------------- runtime state ---------------- */
let song = null;      // library entry
let seq = null;       // Sequencer for the laid-out song
const UI = { start: 0, range: null, loop: 'off', help: false, sel: null };
const audio = new AudioEngine('samples/');
const groove = new Groove();
const P = { playing: false, paused: false, next: 0, timer: null, vis: [], k: 0, nextK: 1, disp: 0, revealed: true, slotChord: {}, bar: null, endAt: 0 };

const prefs = () => (S.songPrefs[song.id] ||= {});
const tempo = () => prefs().tempo || song.bpm || 120;
const style = () => prefs().style || song.style || 'swing';
const meterStr = m => `${m.num}/${m.den}`;
const meterLabel = m => { const opts = GROUPINGS[meterStr(m)]; const g = groupsOf(m); return opts && opts.length > 1 ? `${meterStr(m)} (${(opts.find(o => o[1].join() === g.join()) || [groupLabel(g)])[0]})` : meterStr(m); };
const parseMeter = s => { const [n, d] = String(s).split('/').map(Number); return { num: n || 4, den: d || 4 }; };
const arpOpts = () => ({ sharp11: S.sharp11 });

const arps = new ArpEngine(() => ({
  source: S.source, degrees: S.degrees, len: S.len, onlyWritten: S.onlyWritten, order: S.order,
  patterns: (S.sets.find(x => x.id === S.setId) || S.sets[0]).text,
}));
const chordForSlot = k => P.slotChord[k] || null;
const arpAt = k => arps.at(k, chordForSlot);

function seqCfg() {
  return {
    loop: UI.loop, range: UI.range, change: S.change, every: S.change === 'seconds' ? S.every.seconds : (S.every[S.change] || 1),
    seconds: S.every.seconds, syncChord: S.syncChord, laps: S.laps,
  };
}
function buildSeq() {
  const meter = song.meter || { num: 4, den: 4 };
  const events = layout(song.events.map(e => ({ ...e, chord: parseChord(e.label) })), meter);
  seq = new Sequencer({ meter, events }, seqCfg);
}

function loadSong(id) {
  stop();
  song = library.find(s => s.id === id) || library[0];
  song.meter ||= { num: 4, den: 4 };
  S.songId = song.id; saveS();
  arps.reset();
  buildSeq();
  const p = prefs();
  const N = song.events.length;
  UI.start = Math.min(p.start || 0, N - 1);
  UI.range = p.range && p.range[1] < N ? p.range : null;
  UI.loop = p.loop || 'off';
  if (UI.loop === 'range' && !UI.range) UI.loop = 'off';
  restAll();
  renderAll();
}
function savePrefs() { const p = prefs(); p.start = UI.start; p.range = UI.range; p.loop = UI.loop; saveS(); }

/* ---------------- transport ---------------- */
async function play() {
  await audio.init();
  if (P.playing && P.paused) { await audio.resume(); P.paused = false; setPlayIcon(); wake(true); return; }
  if (P.playing) { await audio.suspend(); P.paused = true; setPlayIcon(); return; }
  await audio.resume();
  ensureSamples();
  audio.newSession();
  groove.reset();
  seq.reset(UI.start);
  P.slotChord = {};
  P.slotChord[0] = seq.E[seq.ev].chord;
  Object.assign(P, { playing: true, paused: false, vis: [], endAt: 0, disp: -1 });
  const m = song.meter, spb = 60 / tempo();
  let t = audio.now + 0.12;
  if (S.countIn) {
    for (let i = 0; i < m.num; i++) {
      const gr = meterGrid(m), e = i * gr.perBeat;
      audio.click(t + i * spb, i === 0 ? 2 : gr.startSet.has(e) ? 1 : 0);
      const n = m.num - i;
      P.vis.push({ t: t + i * spb, f: () => { $('countLbl').textContent = String(n); } });
    }
    t += m.num * spb;
  }
  P.next = t;
  clearInterval(P.timer);
  P.timer = setInterval(tick, 25);
  tick();
  wake(true);
  setPlayIcon();
}
function stop() {
  clearInterval(P.timer); P.timer = null;
  audio.endSession();
  if (audio.ctx && audio.ctx.state === 'suspended') audio.resume();
  const was = P.playing;
  Object.assign(P, { playing: false, paused: false, vis: [], bar: null });
  wake(false);
  if (was) arps.reset();
  if (song) restAll();
  setPlayIcon();
}
async function restart() {
  if (!P.playing) return play();
  if (P.paused) { await audio.resume(); P.paused = false; }
  audio.newSession();
  groove.reset();
  arps.reset();
  seq.reset(UI.start);
  P.slotChord = { 0: seq.E[seq.ev].chord };
  P.vis = []; P.disp = -1;
  P.next = audio.now + 0.08;
  setPlayIcon();
}
function tick() {
  if (!P.playing || P.paused) return;
  const now = audio.now;
  if (seq.done) { if (now > P.endAt) stop(); return; }
  while (P.next < now + 0.15 && !seq.done) {
    const spb = 60 / tempo();
    const b = seq.step(P.next, spb);
    onBeat(b);
    P.next += spb;
    if (b.done) P.endAt = b.t + spb * 1.5;
  }
}
function onBeat(b) {
  // which chord each arpeggio slot belongs to (for "only written degrees" and note names)
  for (const c of b.changes) {
    P.slotChord[c.k] = b.ev.chord;
    if (S.change === 'chord' && b.nextEv) P.slotChord[c.nextK] = b.nextEv.chord;
    arpAt(c.k); arpAt(c.nextK);
    const k = c.k, nk = c.nextK;
    const revealNow = S.lead === 'slot' || (S.lead === 'beats' && c.len != null && c.len <= S.leadBeats);
    P.vis.push({ t: c.t, f: () => showArp(k, nk, true, c, revealNow) });
    if (S.lead === 'beats' && c.lenSec) { // seconds mode: reveal a few beats before the next change
      const tr = Math.max(c.t, c.t + c.lenSec - S.leadBeats * b.spb);
      P.vis.push({ t: tr, f: () => { if (P.k === k) revealNext(); } });
    }
  }
  // beat-based slots: reveal the next arpeggio when only `leadBeats` beats remain
  if (S.lead === 'beats' && S.change !== 'seconds' && b.slotLen - b.inSlot === S.leadBeats && !b.changes.length) {
    const k = b.k;
    P.vis.push({ t: b.t, f: () => { if (P.k === k) revealNext(); } });
  }
  const chordOnly = b.chordStart && !b.changes.some(c => Math.abs(c.t - b.t) < 1e-6);
  const info = { evIdx: b.evIdx, bar: b.barNo, lap: b.lap, inSlot: b.inSlot, slotLen: b.slotLen, up: b.upcoming, chordOnly };
  P.vis.push({ t: b.t, f: () => onBeatVisual(info) });
  for (const n of groove.beat(b, { style: style(), meter: song.meter, harmony: S.harmony, tempo: tempo() })) audio.play(n);
}

/* ---------------- visuals ---------------- */
function visLoop() {
  if (audio.ctx && P.vis.length) {
    const now = audio.now;
    P.vis.sort((a, b) => a.t - b.t);
    while (P.vis.length && P.vis[0].t <= now) P.vis.shift().f();
  }
  if (P.bar && audio.ctx) {
    const f = Math.max(0, Math.min(1, (audio.now - P.bar.t0) / (P.bar.t1 - P.bar.t0)));
    const el = $('progress').querySelector('span');
    if (el) el.style.width = (f * 100).toFixed(1) + '%';
  }
  requestAnimationFrame(visLoop);
}
const tilesHTML = arr => arr.map(d => `<span class="t">${d}</span>`).join('');
const dotsHTML = n => Array.from({ length: n }, () => '<span class="t">·</span>').join('');
/** Shows slot k as the active row. Two rows of equal size alternate: the active one has its first digit in red,
 *  the other shows the next arpeggio (when it's time to reveal it). Short ordered lists show every pattern as a fixed row. */
function showArp(k, nk, isChange, c, reveal = S.lead === 'slot') {
  if (isChange) P.disp++;
  P.k = k; P.nextK = nk;
  P.revealed = reveal;
  if (c && c.lenSec) { P.bar = { t0: c.t, t1: c.t + c.lenSec }; $('progress').innerHTML = '<div class="bar"><span></span></div>'; }
  else P.bar = null;
  renderRows(isChange);
  if (UI.help) renderHelp();
}
function revealNext() { if (!P.revealed) { P.revealed = true; renderRows(false, true); } }
function renderRows(isChange, revealing) {
  const box = $('rows');
  const fixed = arps.fixedRows();
  if (fixed) {
    const act = Math.max(0, arps.sourceIndex(P.k));
    box.className = 'rows r' + fixed.length;
    box.innerHTML = fixed.map((p, i) => `<div class="tiles ${i === act ? 'active' : ''}">${tilesHTML(p)}</div>`).join('');
    $('stageLbl').textContent = 'Els teus patrons, en ordre';
    return;
  }
  box.className = 'rows r2';
  const cur = arpAt(P.k), nxt = arpAt(P.nextK);
  const activeRow = P.disp % 2;
  const show = P.revealed && S.lead !== 'never';
  const rowHTML = i => i === activeRow
    ? `<div class="tiles active">${tilesHTML(cur)}</div>`
    : `<div class="tiles ${show ? '' : 'hidden-next'}">${show ? tilesHTML(nxt) : dotsHTML(nxt.length)}</div>`;
  box.innerHTML = rowHTML(0) + rowHTML(1);
  // animate only the row whose content changed (the next one), never the one being played
  const changed = box.children[1 - activeRow];
  if ((isChange || revealing) && show) { changed.classList.add('enter'); }
  $('stageLbl').textContent = 'Arpegis';
}
function renderDots(inSlot, len, bpb) {
  const box = $('progress');
  if (P.bar) return;
  if (inSlot < 0 || !len) { box.innerHTML = ''; return; }
  if (len > 32) { box.innerHTML = `<span class="hint num">${inSlot + 1} / ${len}</span>`; return; }
  let h = '';
  for (let i = 0; i < len; i++) { if (i && bpb && i % bpb === 0) h += '<i class="sep"></i>'; h += `<i class="${i <= inSlot ? 'on' : ''}"></i>`; }
  box.innerHTML = h;
}
let flashT = 0;
function onBeatVisual(i) {
  $('countLbl').textContent = '';
  if (S.change !== 'seconds') renderDots(i.inSlot, i.slotLen, song.meter.num);
  P.pos = i;
  if (i.up) { P.up = i.up; highlightCell(i.evIdx); }
  if (i.chordOnly && S.change !== 'chord') {
    const f = $('chordFlash'); f.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => f.classList.remove('on'), 650);
  }
  if (UI.help) renderHelp();
}
function restAll() {
  // resting state: show what the first slot will be
  if (!seq) return;
  const i = seq.startIndex(UI.start);
  P.slotChord = { 0: seq.E[i].chord };
  if (S.change === 'chord') { const n = seq.nextIdx(i); if (n >= 0) P.slotChord[1] = seq.E[n].chord; }
  P.up = seq.upcoming(i); P.pos = null; P.bar = null; P.disp = 0;
  showArp(0, 1, false, null, S.lead !== 'never');
  $('countLbl').textContent = '';
  $('progress').innerHTML = '';
  highlightCell(-1);
  renderHelp();
}
function renderHelp() {
  if (!UI.help || !seq) return;
  const up = P.up || seq.upcoming(seq.startIndex(UI.start));
  const labels = ['Ara', 'Després', 'I després'];
  $('chordView').innerHTML = up.map((ix, j) => {
    if (ix == null || ix < 0) return `<div class="c"><div class="eyebrow">${labels[j]}</div><div class="n">—</div></div>`;
    const ev = seq.E[ix];
    const notes = j === 0 && ev.chord ? arpAt(P.k).map(d => spellDegree(ev.chord, d, arpOpts())).join(' ') : '';
    return `<div class="c ${j === 0 ? 'cur' : ''}"><div class="eyebrow">${labels[j]}</div><div class="n">${esc(pretty(ev.label))}</div>${notes ? `<div class="notes">${notes}</div>` : ''}</div>`;
  }).join('');
  const N = seq.E.length;
  const p = P.pos;
  $('whereLbl').innerHTML = p
    ? `<span>Acord <b class="num">${p.evIdx + 1}/${N}</b></span><span>Compàs <b class="num">${p.bar}</b></span>${UI.loop !== 'off' ? `<span>Volta <b class="num">${p.lap}</b></span>` : ''}`
    : `<span>Començarà a l'acord <b class="num">${seq.startIndex(UI.start) + 1}/${N}</b></span>${UI.loop === 'range' && UI.range ? `<span>Tram <b class="num">${UI.range[0] + 1}–${UI.range[1] + 1}</b></span>` : ''}`;
}
function setPlayIcon() {
  const on = P.playing && !P.paused;
  $('playIcon').innerHTML = on ? '<rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="5.5" width="4" height="13" rx="1"/>' : '<path d="M8 5.5v13l11-6.5z"/>';
  $('playBtn').setAttribute('aria-label', on ? 'Pausa' : 'Reprodueix');
}
let wakeLock = null;
async function wake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not allowed here */ }
}

/* ---------------- samples ---------------- */
const loadState = {};
audio.onStatus = (inst, st) => { loadState[inst] = st; renderSoundStatus(); };
function ensureSamples() { audio.load('drums'); audio.load('bass'); audio.load(S.harmony); }
function renderSoundStatus() {
  const need = ['drums', 'bass', S.harmony];
  const st = need.map(k => loadState[k]);
  const el = $('soundStatus');
  el.classList.toggle('ready', st.every(x => x === 'ready'));
  el.querySelector('span').textContent = st.every(x => x === 'ready') ? 'Sons reals carregats'
    : st.some(x => x === 'error') ? 'No s\'han pogut carregar alguns sons: sonen sintetitzats'
      : st.some(x => x === 'loading') ? 'Carregant els sons reals… mentrestant sonen sintetitzats'
        : 'Els sons reals es carreguen quan prems ▶';
}

/* ---------------- render ---------------- */
function setSeg(id, val) { $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === val))); }
function renderLoop() {
  const full = { off: 'Sense bucle', all: 'Bucle: tot', range: 'Bucle: tram' }[UI.loop];
  const short = { off: 'No', all: 'Tot', range: 'Tram' }[UI.loop];
  $('loopLbl').innerHTML = `<span class="lt">${full}</span><span class="st">${short}</span>`;
  $('loopBtn').dataset.on = UI.loop === 'off' ? '0' : '1';
}
function renderHead() {
  $('songTitle').textContent = song.title;
  $('songMeta').textContent = `${song.events.length} acords · ${meterLabel(song.meter)}`;
  $('meterSel').value = meterStr(song.meter);
  const opts = GROUPINGS[meterStr(song.meter)] || [];
  $('groupSel').hidden = opts.length < 2;
  $('groupSel').innerHTML = opts.map(([label, g]) => `<option value="${g.join(',')}">${label}</option>`).join('');
  $('groupSel').value = groupsOf(song.meter).join(',');
}
function renderTempo() { $('tempoOut').textContent = tempo(); $('tempoRange').value = tempo(); }
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
function renderGrid() {
  const g = $('grid');
  g.classList.toggle('hidenames', !!S.hideNames);
  const [a, b] = UI.loop === 'range' && UI.range ? UI.range : [-1, -1];
  g.innerHTML = seq.E.map((e, i) => `<div class="cell ${i >= a && i <= b ? 'inrange' : ''} ${i === UI.start ? 'start' : ''} ${e.label && !e.chord ? 'bad' : ''}" data-i="${i}" role="button" tabindex="0" aria-label="Acord ${i + 1}"><div class="i">${i + 1}</div><div class="n">${esc(pretty(e.label))}</div>${i === UI.sel ? `<button class="go" data-go="${i}" aria-label="Toca des d'aquí">${PLAY_SVG}</button>` : ''}</div>`).join('');
  if (P.playing && P.pos) highlightCell(P.pos.evIdx);
}
function highlightCell(i) {
  $('grid').querySelectorAll('.cell.playing').forEach(c => c.classList.remove('playing'));
  if (i >= 0) { const c = $('grid').querySelector(`[data-i="${i}"]`); if (c) c.classList.add('playing'); }
}
function renderArpPane() {
  setSeg('srcSeg', S.source); setSeg('orderSeg', S.order); setSeg('changeSeg', S.change); setSeg('lapsSeg', S.laps); setSeg('s11Seg', S.sharp11 ? 'sharp' : 'nat');
  $('randomOpts').hidden = S.source !== 'random';
  $('listOpts').hidden = S.source !== 'list';
  $('degChips').innerHTML = DEGREES.map(d => `<button class="chip" data-d="${d}" aria-pressed="${S.degrees.includes(d)}">${d}</button>`).join('');
  S.len = Math.max(2, Math.min(S.len, Math.max(2, S.degrees.length)));
  $('lenOut').textContent = S.len;
  $('onlyWritten').checked = !!S.onlyWritten;
  const set = S.sets.find(x => x.id === S.setId) || S.sets[0];
  $('setSel').innerHTML = S.sets.map(x => `<option value="${x.id}" ${x.id === set.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  if (document.activeElement !== $('patterns')) $('patterns').value = set.text;
  if (document.activeElement !== $('setName')) $('setName').value = set.name;
  $('everyRow').hidden = S.change === 'chord';
  $('syncRow').hidden = S.change === 'chord';
  $('syncChord').checked = !!S.syncChord;
  $('everyLbl').textContent = { beats: 'Cada quants temps', bars: 'Cada quants compassos', seconds: 'Cada quants segons' }[S.change] || '';
  $('everyOut').textContent = S.change === 'seconds' ? S.every.seconds.toFixed(1).replace('.0', '') : S.every[S.change];
  setSeg('leadSeg', S.lead);
  $('leadRow').hidden = S.lead !== 'beats';
  $('leadOut').textContent = S.leadBeats;
  $('leadField').hidden = !!arps.fixedRows();
  $('leadHint').textContent = S.lead === 'slot' ? 'Veus el següent arpegi des que comences l\'actual.'
    : S.lead === 'beats' ? `El següent apareix ${S.leadBeats} ${S.leadBeats === 1 ? 'temps' : 'temps'} abans del canvi: menys temps per pensar.` : 'No veus el següent fins que l\'has de tocar.';
}
function renderSoPane() {
  setSeg('styleSeg', style()); setSeg('harmSeg', S.harmony);
  $('countIn').checked = S.countIn;
  const names = { bass: 'Baix', drums: 'Bateria', comp: 'Harmonia', master: 'General' };
  $('mixer').innerHTML = Object.keys(names).map(k => `<div class="mix"><label for="v-${k}">${names[k]}</label><input type="range" id="v-${k}" data-k="${k}" min="0" max="100" value="${Math.round(S.vol[k] * 100)}"><output id="o-${k}">${Math.round(S.vol[k] * 100)}</output></div>`).join('');
  renderSoundStatus();
}
function applyTheme() {
  document.documentElement.setAttribute('data-jd-theme', S.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = S.theme === 'light' ? '#EFEAE0' : '#17140F';
}
function renderAll() { renderHead(); renderTempo(); renderLoop(); renderGrid(); renderArpPane(); renderSoPane(); $('hideNames').checked = !!S.hideNames; $('help').hidden = !UI.help; renderHelp(); }

/* ---------------- arpeggio settings changes ---------------- */
function arpsChanged() {
  if (P.playing) { arps.reset(P.k); renderRows(false, true); }
  else { arps.reset(); restAll(); }
}

/* ---------------- events ---------------- */
$('playBtn').onclick = play;
$('stopBtn').onclick = stop;
$('restartBtn').onclick = restart;
$('loopBtn').onclick = () => {
  const order = UI.range ? ['off', 'all', 'range'] : ['off', 'all'];
  UI.loop = order[(order.indexOf(UI.loop) + 1) % order.length];
  renderLoop(); savePrefs(); renderGrid();
  if (!P.playing) restAll(); else renderHelp();
};
const setTempo = v => { prefs().tempo = Math.max(30, Math.min(320, Math.round(v))); saveS(); renderTempo(); };
$('tMinus').onclick = () => setTempo(tempo() - 1);
$('tPlus').onclick = () => setTempo(tempo() + 1);
// press on the bpm number and drag: up = faster, down = slower, in steps of 5
(() => {
  const el = $('tempoOut'); let d = null;
  el.addEventListener('pointerdown', e => { d = { y: e.clientY, v: tempo(), id: e.pointerId }; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (!d || e.pointerId !== d.id) return; const steps = Math.trunc((d.y - e.clientY) / 14); setTempo(d.v + steps * 5); });
  const end = () => { d = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
})();
$('tempoRange').oninput = e => setTempo(+e.target.value);
function toggleHelp() { UI.help = !UI.help; $('helpBtn').setAttribute('aria-pressed', String(UI.help)); $('help').hidden = !UI.help; renderHelp(); }
$('helpBtn').onclick = toggleHelp;
$('themeBtn').onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; saveS(); applyTheme(); };
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== b.dataset.pane; });
});
const segVal = e => e.target.closest('button')?.dataset.v;
$('srcSeg').onclick = e => { const v = segVal(e); if (!v) return; S.source = v; saveS(); arpsChanged(); renderArpPane(); };
$('orderSeg').onclick = e => { const v = segVal(e); if (!v) return; S.order = v; saveS(); arpsChanged(); renderArpPane(); };
$('changeSeg').onclick = e => { const v = segVal(e); if (!v) return; S.change = v; saveS(); renderArpPane(); if (P.playing) seq.forceSlot = true; else restAll(); };
$('lapsSeg').onclick = e => { const v = segVal(e); if (!v) return; S.laps = v; saveS(); renderArpPane(); };
$('s11Seg').onclick = e => { const v = segVal(e); if (!v) return; S.sharp11 = v === 'sharp'; saveS(); renderArpPane(); renderHelp(); };
$('degChips').onclick = e => {
  const d = +e.target.closest('button')?.dataset.d; if (!d) return;
  S.degrees = S.degrees.includes(d) ? S.degrees.filter(x => x !== d) : [...S.degrees, d].sort((a, b) => a - b);
  if (S.degrees.length < 2) S.degrees = [1, 3];
  S.len = S.degrees.length; saveS(); renderArpPane(); arpsChanged();
};
$('lenMinus').onclick = () => { S.len = Math.max(2, S.len - 1); saveS(); renderArpPane(); arpsChanged(); };
$('lenPlus').onclick = () => { S.len = Math.min(S.degrees.length, S.len + 1); saveS(); renderArpPane(); arpsChanged(); };
$('onlyWritten').onchange = e => { S.onlyWritten = e.target.checked; saveS(); arpsChanged(); };
function stepEvery(dir) {
  if (S.change === 'seconds') S.every.seconds = Math.max(0.5, Math.min(30, +(S.every.seconds + dir * 0.5).toFixed(1)));
  else S.every[S.change] = Math.max(1, Math.min(S.change === 'beats' ? 32 : 16, S.every[S.change] + dir));
  saveS(); renderArpPane();
}
$('everyMinus').onclick = () => stepEvery(-1);
$('everyPlus').onclick = () => stepEvery(1);
$('syncChord').onchange = e => { S.syncChord = e.target.checked; saveS(); };
$('leadSeg').onclick = e => { const v = segVal(e); if (!v) return; S.lead = v; saveS(); renderArpPane(); if (!P.playing) restAll(); else renderRows(false, true); };
$('leadMinus').onclick = () => { S.leadBeats = Math.max(1, S.leadBeats - 1); saveS(); renderArpPane(); };
$('leadPlus').onclick = () => { S.leadBeats = Math.min(16, S.leadBeats + 1); saveS(); renderArpPane(); };
$('reshuffle').onclick = arpsChanged;
// pattern sets
const curSet = () => S.sets.find(x => x.id === S.setId) || S.sets[0];
$('setSel').onchange = e => { S.setId = e.target.value; saveS(); renderArpPane(); arpsChanged(); };
$('setNew').onclick = () => { const s = { id: uid(), name: 'Conjunt ' + (S.sets.length + 1), text: curSet().text }; S.sets.push(s); S.setId = s.id; saveS(); renderArpPane(); $('setName').focus(); $('setName').select(); };
$('setDel').onclick = e => {
  const b = e.currentTarget;
  if (S.sets.length <= 1) { b.textContent = 'És l\'únic'; setTimeout(() => { b.textContent = 'Esborra'; }, 1500); return; }
  if (!b.classList.contains('danger')) { b.classList.add('danger'); b.textContent = 'Segur?'; setTimeout(() => { b.classList.remove('danger'); b.textContent = 'Esborra'; }, 2500); return; }
  S.sets = S.sets.filter(x => x.id !== S.setId); S.setId = S.sets[0].id; saveS(); b.classList.remove('danger'); b.textContent = 'Esborra'; renderArpPane(); arpsChanged();
};
$('setName').oninput = e => { curSet().name = e.target.value || 'Sense nom'; saveS(); const o = $('setSel').selectedOptions[0]; if (o) o.textContent = curSet().name; };
let patT = 0;
$('patterns').oninput = e => { curSet().text = e.target.value; saveS(); clearTimeout(patT); patT = setTimeout(() => { arpsChanged(); renderArpPane(); }, 400); };
// sound
$('styleSeg').onclick = e => { const v = segVal(e); if (!v) return; prefs().style = v; saveS(); setSeg('styleSeg', v); };
$('harmSeg').onclick = e => { const v = segVal(e); if (!v) return; S.harmony = v; saveS(); setSeg('harmSeg', v); if (audio.ctx) audio.load(v); renderSoundStatus(); };
$('countIn').onchange = e => { S.countIn = e.target.checked; saveS(); };
$('mixer').oninput = e => { const k = e.target.dataset.k; if (!k) return; S.vol[k] = e.target.value / 100; $('o-' + k).textContent = e.target.value; audio.setVolumes(S.vol); saveS(); };
audio.setVolumes(S.vol);
// structure
$('meterSel').onchange = e => { stop(); song.meter = parseMeter(e.target.value); saveLib(); buildSeq(); restAll(); renderAll(); };
$('groupSel').onchange = e => { song.meter = { ...song.meter, groups: e.target.value.split(',').map(Number) }; saveLib(); if (seq) seq.song.meter = song.meter; renderHead(); };
$('hideNames').onchange = e => { S.hideNames = e.target.checked; saveS(); renderGrid(); };

/* Chord grid gestures:
   tap → select the chord (shows a ▶ button that plays from there)
   double tap → leave the loop and stop if there is a range loop; otherwise play from that chord
   press-and-hold + drag (or mouse drag) → select a range, which loops straight away */
function playFrom(i) {
  UI.start = i; UI.sel = null; savePrefs();
  if (P.playing) stop();
  renderGrid();
  play();
}
const G = { down: null, timer: 0, dragging: false, a: -1, b: -1, lastTap: { i: -1, t: 0 } };
const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); const c = el && el.closest('#grid .cell'); return c ? +c.dataset.i : -1; };
function paintDrag() {
  const [a, b] = [Math.min(G.a, G.b), Math.max(G.a, G.b)];
  $('grid').querySelectorAll('.cell').forEach(c => { const i = +c.dataset.i; c.classList.toggle('inrange', i >= a && i <= b); });
}
function startDrag() {
  G.dragging = true; $('grid').classList.add('dragging');
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* ignore */ }
  paintDrag();
}
$('grid').addEventListener('pointerdown', e => {
  if (e.target.closest('.go')) return;
  const i = cellAt(e.clientX, e.clientY); if (i < 0) return;
  G.down = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
  G.a = G.b = i; G.dragging = false;
  clearTimeout(G.timer);
  if (e.pointerType === 'mouse') { /* mouse: dragging starts as soon as it moves to another chord */ }
  else G.timer = setTimeout(() => { if (G.down) startDrag(); }, 320);
});
window.addEventListener('pointermove', e => {
  if (!G.down || e.pointerId !== G.down.id) return;
  const moved = Math.hypot(e.clientX - G.down.x, e.clientY - G.down.y);
  if (!G.dragging) {
    if (G.down.type === 'mouse') { const i = cellAt(e.clientX, e.clientY); if (i >= 0 && i !== G.a) startDrag(); else return; }
    else { if (moved > 10) { clearTimeout(G.timer); G.down = null; } return; } // a scroll, not a long press
  }
  const i = cellAt(e.clientX, e.clientY);
  if (i >= 0 && i !== G.b) { G.b = i; paintDrag(); }
});
// while dragging on touch screens, stop the page from scrolling
$('grid').addEventListener('touchmove', e => { if (G.dragging) e.preventDefault(); }, { passive: false });
window.addEventListener('pointerup', e => {
  if (!G.down || e.pointerId !== G.down.id) return;
  clearTimeout(G.timer);
  const wasDrag = G.dragging;
  G.down = null; G.dragging = false; $('grid').classList.remove('dragging');
  if (wasDrag) {
    const a = Math.min(G.a, G.b), b = Math.max(G.a, G.b);
    UI.range = [a, b]; UI.loop = 'range'; UI.start = a; UI.sel = null;
    savePrefs(); renderLoop(); renderGrid();
    if (!P.playing) restAll(); else renderHelp();
    return;
  }
  onTap(G.a);
});
window.addEventListener('pointercancel', () => { clearTimeout(G.timer); G.down = null; if (G.dragging) { G.dragging = false; $('grid').classList.remove('dragging'); renderGrid(); } });
function onTap(i) {
  const now = performance.now();
  const dbl = G.lastTap.i === i && now - G.lastTap.t < 350;
  G.lastTap = { i, t: dbl ? 0 : now };
  if (dbl) {
    if (UI.loop === 'range' && UI.range) {
      UI.range = null; UI.loop = 'off'; UI.sel = null;
      savePrefs(); renderLoop(); stop(); renderGrid();
    } else playFrom(i);
    return;
  }
  UI.sel = i; UI.start = i; savePrefs();
  renderGrid();
  if (!P.playing) restAll();
}
$('grid').addEventListener('click', e => { const g = e.target.closest('.go'); if (g) { e.stopPropagation(); playFrom(+g.dataset.go); } });
$('grid').addEventListener('keydown', e => {
  const c = e.target.closest('.cell'); if (!c) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); playFrom(+c.dataset.i); }
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select') || !$('libSheet').hidden || !$('editSheet').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); play(); }
  else if (e.key === 'Escape') stop();
  else if (e.key === 'a' || e.key === 'A') toggleHelp();
  else if (e.key === 'r' || e.key === 'R') restart();
  else if (e.key === 'ArrowUp') { e.preventDefault(); setTempo(tempo() + 1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setTempo(tempo() - 1); }
});

/* ---------------- library ---------------- */
const libF = { q: '', fam: null, level: null };
function songFamilies(s) { return [...new Set(s.events.map(e => family(parseChord(e.label))).filter(f => f !== 'altres'))]; }
function renderLib() {
  const fams = ['major', 'dominant', 'menor', 'm7♭5', 'disminuït', 'sus'];
  $('libFilters').innerHTML = fams.map(f => `<button class="chip" data-fam="${f}" aria-pressed="${libF.fam === f}">${f}</button>`).join('')
    + BELTS.map(([id, col, name]) => `<button class="chip" data-level="${id}" aria-pressed="${libF.level === id}" title="Cinturó ${name}"><span class="belt" style="background:${col}"></span></button>`).join('');
  const active = (libF.fam ? 1 : 0) + (libF.level ? 1 : 0);
  $('filterCount').textContent = active ? String(active) : '';
  const q = libF.q.toLowerCase();
  const items = library.filter(s => (!q || [s.title, s.key, ...(s.goals || [])].join(' ').toLowerCase().includes(q))
    && (!libF.fam || songFamilies(s).includes(libF.fam)) && (!libF.level || s.level === libF.level));
  $('libList').innerHTML = items.length ? items.map(s => {
    const belt = BELTS.find(b => b[0] === s.level);
    const meta = [`${s.events.length} acords`, meterStr(s.meter || { num: 4, den: 4 }), s.key, ...(s.goals || [])].filter(Boolean).join(' · ');
    return `<div class="it ${s.id === song.id ? 'cur' : ''}"><button class="t" data-load="${s.id}">${belt ? `<span class="belt" style="background:${belt[1]}" title="Cinturó ${belt[2]}"></span>` : '<span class="belt"></span>'}<span><b>${esc(s.title)}</b><small>${esc(meta)}</small></span></button><button class="small-btn" data-edit="${s.id}">Edita</button><button class="small-btn" data-del="${s.id}">Esborra</button></div>`;
  }).join('') : '<div class="empty">Cap exercici coincideix amb el filtre.</div>';
}
const openLib = () => { renderLib(); $('libSheet').hidden = false; $('importMsg').hidden = true; };
$('libBtn').onclick = openLib;
$('songBtn').onclick = openLib;
$('libClose').onclick = () => { $('libSheet').hidden = true; };
$('libSheet').onclick = e => { if (e.target === $('libSheet')) $('libSheet').hidden = true; };
$('libSearch').oninput = e => { libF.q = e.target.value; renderLib(); };
$('filterBtn').onclick = () => { const f = $('libFilters'); f.hidden = !f.hidden; $('filterBtn').setAttribute('aria-expanded', String(!f.hidden)); };
$('libFilters').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.fam) libF.fam = libF.fam === b.dataset.fam ? null : b.dataset.fam;
  if (b.dataset.level) libF.level = libF.level === b.dataset.level ? null : b.dataset.level;
  renderLib();
};
$('libList').onclick = e => {
  const l = e.target.closest('[data-load]'), d = e.target.closest('[data-del]'), ed = e.target.closest('[data-edit]');
  if (l) { loadSong(l.dataset.load); $('libSheet').hidden = true; }
  if (ed) openEditor(ed.dataset.edit);
  if (d) {
    if (!d.classList.contains('danger')) { d.classList.add('danger'); d.textContent = 'Segur?'; return; }
    if (library.length <= 1) { d.textContent = 'És l\'únic'; return; }
    library = library.filter(s => s.id !== d.dataset.del); saveLib();
    if (song.id === d.dataset.del) loadSong(library[0].id);
    renderLib();
  }
};
function addSongs(list) {
  list.forEach(s => { s.id = uid(); s.level ||= 'blanc'; s.goals ||= []; });
  library = list.concat(library);
  saveLib(); loadSong(list[0].id); renderLib();
}
function importText(txt) {
  const msg = $('importMsg'); msg.hidden = false; msg.classList.remove('warn');
  if (/irealb(ook)?:\/\//.test(txt)) {
    let songs = [];
    try { songs = parseIReal(txt); } catch (err) { songs = []; }
    if (!songs.length) { msg.textContent = 'He trobat un enllaç d\'iReal Pro però no n\'he pogut llegir els acords.'; msg.classList.add('warn'); return; }
    addSongs(songs);
    const bad = [...new Set(songs.flatMap(s => s.unknown))];
    msg.textContent = (songs.length === 1 ? `Importat: ${songs[0].title} (${songs[0].events.length} acords).` : `Importades ${songs.length} cançons. Tens carregada «${songs[0].title}».`)
      + (bad.length ? ` No reconec aquests acords, i sonaran com a silenci: ${bad.slice(0, 8).join(', ')}.` : '');
    if (bad.length) msg.classList.add('warn');
    return;
  }
  const r = parseTextChords(txt);
  if (!r) { msg.textContent = 'No hi ha res per importar. Enganxa un enllaç irealb:// o escriu acords.'; msg.classList.add('warn'); return; }
  if (r.unknown.length) { msg.textContent = 'No reconec aquests acords: ' + r.unknown.slice(0, 8).join(', ') + '. Corregeix-los i torna-ho a provar.'; msg.classList.add('warn'); return; }
  addSongs([r]);
  msg.textContent = `Creat un exercici amb ${r.events.length} acords.`;
}
$('importBtn').onclick = () => importText($('pasteIn').value);
$('fileIn').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => importText(String(rd.result)); rd.readAsText(f); };
// generator
const gen = { quals: ['^9', '9', '-9'] };
$('genRoot').innerHTML = FLATS.map((n, i) => `<option value="${i}">${n.replace('b', '♭')}</option>`).join('');
$('genCycle').innerHTML = CYCLES.map(([st, name]) => `<option value="${st}">${name}</option>`).join('');
for (const id of ['meterSel', 'genMeter', 'edMeter']) $(id).innerHTML = METERS.map(m => `<option value="${m}">${m}</option>`).join('');
$('genMeter').value = '4/4';
function renderGen() {
  $('genQual').innerHTML = QUALS.map(([q, n]) => { const ix = gen.quals.indexOf(q); return `<button class="chip" data-q="${q}" aria-pressed="${ix >= 0}">${n}${ix >= 0 ? `<span class="o">${ix + 1}</span>` : ''}</button>`; }).join('');
  const step = +$('genCycle').value, r = +$('genRoot').value;
  const g = cycleRoots(step, r).map(x => FLATS[x].replace('b', '♭'));
  $('genPreview').textContent = gen.quals.length ? `${gen.quals.length * 12} acords. Fonamentals: ${g.join(' ')}` : 'Tria almenys un tipus d\'acord.';
}
$('genQual').onclick = e => { const q = e.target.closest('button')?.dataset.q; if (!q) return; gen.quals = gen.quals.includes(q) ? gen.quals.filter(x => x !== q) : [...gen.quals, q]; renderGen(); };
$('genCycle').onchange = renderGen;
$('genRoot').onchange = renderGen;
$('genBtn').onclick = () => {
  if (!gen.quals.length) return;
  const s = generateCycle(gen.quals, +$('genCycle').value, +$('genRoot').value, +$('genBars').value, parseMeter($('genMeter').value));
  s.goals = [+$('genCycle').value === 0 ? 'ordre aleatori' : (CYCLES.find(c => c[0] === +$('genCycle').value) || [0, ''])[1].toLowerCase()];
  s.key = 'totes';
  addSongs([s]);
  $('libSheet').hidden = true;
};
renderGen();
// editor
let editing = null;
function openEditor(id) {
  editing = library.find(s => s.id === id); if (!editing) return;
  $('edName').value = editing.title;
  $('edChords').value = eventsToText(editing.events);
  $('edMeter').value = meterStr(editing.meter || { num: 4, den: 4 });
  $('edKey').value = editing.key || '';
  $('edStyle').value = editing.style || 'swing';
  $('edGoals').value = (editing.goals || []).join(', ');
  $('edLevel').dataset.v = editing.level || 'blanc';
  renderLevels();
  $('editMsg').hidden = true;
  $('editSheet').hidden = false;
}
function renderLevels() {
  const v = $('edLevel').dataset.v;
  $('edLevel').innerHTML = BELTS.map(([id, col, name]) => `<button class="chip" data-l="${id}" aria-pressed="${v === id}"><span class="belt" style="background:${col}"></span>${name}</button>`).join('');
}
$('edLevel').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; $('edLevel').dataset.v = b.dataset.l; renderLevels(); };
function readEditor() {
  let meter = parseMeter($('edMeter').value);
  if (editing.meter && meterStr(editing.meter) === meterStr(meter) && editing.meter.groups) meter = { ...meter, groups: editing.meter.groups };
  const r = parseTextChords($('edChords').value, meter);
  const m = $('editMsg');
  if (!r) { m.hidden = false; m.textContent = 'Escriu almenys un acord.'; return null; }
  if (r.unknown.length) { m.hidden = false; m.textContent = 'No reconec aquests acords: ' + r.unknown.slice(0, 8).join(', '); return null; }
  return {
    title: $('edName').value.trim() || 'Sense nom', events: r.events, meter, key: $('edKey').value.trim(),
    style: $('edStyle').value, level: $('edLevel').dataset.v, goals: $('edGoals').value.split(',').map(x => x.trim()).filter(Boolean),
  };
}
$('editSave').onclick = () => {
  const d = readEditor(); if (!d) return;
  Object.assign(editing, d); saveLib(); $('editSheet').hidden = true;
  if (editing.id === song.id) loadSong(song.id); else renderHead();
  renderLib();
};
$('editDup').onclick = () => {
  const d = readEditor(); if (!d) return;
  const copy = { ...editing, ...d, id: uid(), title: d.title === editing.title ? d.title + ' (còpia)' : d.title, src: 'text' };
  library.unshift(copy); saveLib(); $('editSheet').hidden = true; renderLib();
};
$('editClose').onclick = () => { $('editSheet').hidden = true; };
$('editSheet').onclick = e => { if (e.target === $('editSheet')) $('editSheet').hidden = true; };

/* ---------------- boot ---------------- */
applyTheme();
loadSong(S.songId);
requestAnimationFrame(visLoop);
if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude\.ai|claudeusercontent/.test(location.host)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
}
window.__jd = { S, P, get seq() { return seq; }, arps, audio, get song() { return song; } };
