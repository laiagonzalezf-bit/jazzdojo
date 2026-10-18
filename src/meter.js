// Time signatures and their groupings. Groupings are always written in eighth notes:
// 5/4 "3+2" (in quarters) is [6, 4]; 5/4 "3+3+2+2" (in eighths) is [3, 3, 2, 2]; 7/8 "2+2+3" is [2, 2, 3].

export const METERS = ['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '5/8', '6/8', '7/8', '9/8', '12/8'];

/** Grouping options per meter: [label, eighths]. The first one is the default. */
export const GROUPINGS = {
  '2/4': [['2', [2, 2]]],
  '3/4': [['1-2-3', [2, 2, 2]], ['3+3 corxeres (6/8)', [3, 3]]],
  '4/4': [['1-2-3-4', [2, 2, 2, 2]], ['3+3+2 corxeres', [3, 3, 2]]],
  '5/4': [['3+2', [6, 4]], ['2+3', [4, 6]], ['3+3+2+2 corxeres', [3, 3, 2, 2]], ['2+2+3+3 corxeres', [2, 2, 3, 3]],
    ['3+2+3+2 corxeres', [3, 2, 3, 2]], ['2+3+2+3 corxeres', [2, 3, 2, 3]]],
  '6/4': [['3+3', [6, 6]], ['2+2+2', [4, 4, 4]]],
  '7/4': [['4+3', [8, 6]], ['3+4', [6, 8]], ['2+2+3', [4, 4, 6]], ['3+2+2', [6, 4, 4]], ['2+3+2', [4, 6, 4]],
    ['3+3+2+2+2+2 corxeres', [3, 3, 2, 2, 2, 2]], ['2+2+2+2+3+3 corxeres', [2, 2, 2, 2, 3, 3]]],
  '5/8': [['3+2', [3, 2]], ['2+3', [2, 3]]],
  '6/8': [['3+3', [3, 3]], ['2+2+2', [2, 2, 2]]],
  '7/8': [['2+2+3', [2, 2, 3]], ['3+2+2', [3, 2, 2]], ['2+3+2', [2, 3, 2]]],
  '9/8': [['3+3+3', [3, 3, 3]], ['2+2+2+3', [2, 2, 2, 3]], ['3+2+2+2', [3, 2, 2, 2]]],
  '12/8': [['3+3+3+3', [3, 3, 3, 3]]],
};

export const meterStr = m => `${m.num}/${m.den}`;
/** Eighth notes in one bar, and how many eighths one counted beat holds (x/4: 2, x/8: 1). */
export const eighthsPerBar = m => (m.den === 8 ? m.num : m.num * 2);
export const perBeat = m => (m.den === 8 ? 1 : 2);

export function defaultGroups(m) {
  const g = GROUPINGS[meterStr(m)];
  if (g) return g[0][1].slice();
  // unknown meter: quarters (or dotted quarters for compound x/8)
  const E = eighthsPerBar(m);
  const unit = m.den === 8 && m.num % 3 === 0 ? 3 : 2;
  const out = [];
  for (let e = 0; e < E; e += unit) out.push(Math.min(unit, E - e));
  return out;
}
export function validGroups(m, groups) {
  return Array.isArray(groups) && groups.length && groups.every(x => x > 0) && groups.reduce((a, b) => a + b, 0) === eighthsPerBar(m);
}
export const groupsOf = m => (validGroups(m, m.groups) ? m.groups : defaultGroups(m));
export const groupLabel = g => g.join('+');

/** The rhythmic grid of a bar: group starts and the group each eighth belongs to. */
export function meterGrid(m) {
  const groups = groupsOf(m);
  const E = eighthsPerBar(m);
  const starts = [];
  const groupOf = [];
  let e = 0;
  groups.forEach((len, gi) => { starts.push(e); for (let k = 0; k < len; k++) groupOf[e + k] = gi; e += len; });
  return {
    E, perBeat: perBeat(m), groups, starts, startSet: new Set(starts), groupOf,
    oddGroups: groups.some(x => x % 2 === 1),
    // plain 4/4 in quarters uses the hand-tuned 4/4 grooves
    standard: m.num === 4 && m.den === 4 && groups.length === 4 && groups.every(x => x === 2),
  };
}
