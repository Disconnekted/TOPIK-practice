// Safety check, run by GitHub before publishing. If data/content.js or
// data/words.js has a typo or a broken question, the build stops here with a
// clear message and the last working version of the app stays online.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
let DATA;
const ctx = {}; vm.createContext(ctx);
for (const f of ['content.js', 'words.js']) {
  try {
    vm.runInContext(fs.readFileSync(path.join(root, 'data', f), 'utf8') + (f === 'content.js' ? '\n;globalThis.DATA = DATA;' : ''), ctx, { filename: 'data/' + f });
  } catch (e) {
    const where = (e.stack || '').split('\n').find(l => l.includes(f)) || '';
    console.error(`\n✗ data/${f} has a typo, so the app would not load.`);
    console.error('  ' + e.message + (where ? `\n  near ${where.trim()}` : ''));
    console.error('  Common causes: a missing comma between items, a missing quote, or an unescaped " inside text (write \\" instead).\n');
    process.exit(1);
  }
}
DATA = ctx.DATA;

const str = v => typeof v === 'string' && v.trim().length > 0;
function opts(x, w) {
  if (!Array.isArray(x.options) || x.options.length < 2) problems.push(`${w}: needs at least 2 options`);
  else if (!Number.isInteger(x.answer) || x.answer < 0 || x.answer >= x.options.length)
    problems.push(`${w}: "answer" must be a number from 0 to ${x.options.length - 1} (0 = first option)`);
}
function mcq(qs, where) {
  if (!Array.isArray(qs) || !qs.length) { problems.push(`${where}: has no questions`); return; }
  qs.forEach((q, i) => { const w = `${where}, question ${i + 1}`; if (!str(q.q)) problems.push(`${w}: question text is missing`); opts(q, w); });
}
// s 0 is the man (남자) and s 1 the woman (여자): the voice follows "s",
// so a mismatch would give a woman's line a man's voice.
function lines(ls, where) {
  if (!Array.isArray(ls) || !ls.length) { problems.push(`${where}: "lines" is missing`); return; }
  ls.forEach((l, i) => {
    const w = `${where}, line ${i + 1}`;
    if (!str(l.t)) problems.push(`${w}: text "t" is missing`);
    if (l.s !== 0 && l.s !== 1) problems.push(`${w}: "s" must be 0 or 1`);
    if (l.name === '남자' && l.s !== 0) problems.push(`${w}: 남자 must have "s": 0`);
    if (l.name === '여자' && l.s !== 1) problems.push(`${w}: 여자 must have "s": 1`);
  });
}
const items = (check) => (it, w) => {
  if (!Array.isArray(it.items) || !it.items.length) { problems.push(`${w}: "items" is missing`); return; }
  it.items.forEach((x, i) => { const iw = `${w}, item ${i + 1}`; opts(x, iw); check(x, iw); });
};
const hasText = (x, w) => { if (!str(x.text)) problems.push(`${w}: "text" is missing`); };
const gap = (it, w) => {
  if (!str(it.text) || !it.text.includes('㉠') || !it.text.includes('㉡')) problems.push(`${w}: "text" needs gaps (    ㉠    ) and (    ㉡    )`);
  if (!it.model || !str(it.model.a) || !str(it.model.b)) problems.push(`${w}: needs "model": { a: "...", b: "..." }`);
};
const NEED = {
  lnext: items((x, w) => lines(x.lines, w)),
  laction: items((x, w) => lines(x.lines, w)),
  lmatch: items((x, w) => lines(x.lines, w)),
  lcentral: items((x, w) => lines(x.lines, w)),
  lpair: (it, w) => { lines(it.lines, w); mcq(it.questions, w); },
  rgram: items((x, w) => { if (!str(x.q)) problems.push(`${w}: "q" (the sentence) is missing`); if (x.type !== 'blank' && x.type !== 'similar') problems.push(`${w}: "type" must be "blank" or "similar"`); }),
  rtopic: items(hasText),
  rmatch: items(hasText),
  rorder: items((x, w) => { if (!Array.isArray(x.sents) || x.sents.length !== 4) problems.push(`${w}: "sents" needs exactly 4 sentences`); }),
  rblank: items((x, w) => { hasText(x, w); if (str(x.text) && !/\(\s{2,}\)/.test(x.text)) problems.push(`${w}: the text needs a blank written (    )`); }),
  rhead: items(hasText),
  rmain: items(hasText),
  rinsert: items((x, w) => { hasText(x, w); if (!str(x.given)) problems.push(`${w}: "given" (the sentence to insert) is missing`); }),
  rpair: (it, w) => { if (!str(it.text)) problems.push(`${w}: "text" is missing`); mcq(it.questions, w); },
  skim: (it, w) => { if (!Array.isArray(it.paras) || !it.paras.length) problems.push(`${w}: "paras" is missing`); mcq(it.questions, w); },
  trans: (it, w) => { if (!str(it.text) || !/\[\[[a-z ]+:[^\]]+\]\]/.test(it.text)) problems.push(`${w}: needs [[function:Correct|Wrong|Wrong]] gaps`); mcq(it.predict, w + ' (predict)'); },
  vic: items((x, w) => { if (!/\{\{.+?\}\}/.test(x.text || '')) problems.push(`${w}: mark the word with {{double braces}}`); if (!['definition', 'synonym', 'contrast', 'example', 'general sense', 'hanja'].includes(x.clue)) problems.push(`${w}: "clue" must be definition, synonym, contrast, example, general sense or hanja`); }),
  guided: (it, w) => { lines(it.lines, w); if (!str(it.skeleton) || !/\[\[[^\]]+\]\]/.test(it.skeleton)) problems.push(`${w}: "skeleton" needs [[answer]] gaps`); },
  segment: (it, w) => { if (!Array.isArray(it.segments) || !it.segments.length) problems.push(`${w}: "segments" is missing`); else it.segments.forEach((g, i) => { if (!str(g.t) || !str(g.model) || !Array.isArray(g.keys)) problems.push(`${w}, part ${i + 1}: needs "t", "keys", and "model"`); }); },
  notes: (it, w) => { lines(it.lines, w); mcq(it.questions, w); },
  build: (it, w) => (it.items || []).forEach((x, i) => { if (!str(x.context) || !str(x.answer)) problems.push(`${w}, item ${i + 1}: needs "context" and "answer"`); }),
  w51: gap,
  w52: gap,
  w53: (it, w) => {
    if (!str(it.prompt) || !str(it.model)) problems.push(`${w}: needs "prompt" and "model"`);
    if (!Array.isArray(it.charts) || !it.charts.length) problems.push(`${w}: needs at least one chart in "charts"`);
    else it.charts.forEach((c, i) => {
      if (!Array.isArray(c.labels) || !Array.isArray(c.series) || !c.series.length) problems.push(`${w}, chart ${i + 1}: needs "labels" and "series"`);
      else c.series.forEach((s, k) => { if (!Array.isArray(s.values) || s.values.length !== c.labels.length || !s.values.every(Number.isFinite)) problems.push(`${w}, chart ${i + 1}, series ${k + 1}: needs one number per label`); });
    });
  },
  w54: (it, w) => { if (!str(it.intro) || !str(it.model) || !Array.isArray(it.points) || !it.points.length) problems.push(`${w}: needs "intro", "points" and "model"`); }
};
for (const [id, check] of Object.entries(NEED)) {
  const sets = DATA[id];
  if (!Array.isArray(sets) || !sets.length) { problems.push(`DATA.${id} is missing or empty`); continue; }
  const titles = new Set();
  sets.forEach((it, i) => {
    const w = `DATA.${id}, set ${i + 1}${it && it.title ? ` ("${it.title}")` : ''}`;
    if (!it || !str(it.title)) problems.push(`${w}: "title" is missing`);
    else if (titles.has(it.title)) problems.push(`${w}: another set has the same title; titles must be unique`);
    else titles.add(it.title);
    try { check(it || {}, w); } catch (e) { problems.push(`${w}: ${e.message}`); }
  });
}
// Words and grammar (data/words.js)
const decks = DATA.words;
if (!Array.isArray(decks) || !decks.length) problems.push('DATA.words is missing or empty (data/words.js)');
else decks.forEach(d => (d.words || []).forEach((w, i) => { if (!str(w.t) || !str(w.e)) problems.push(`words deck ${d.n}, word ${i + 1}: needs "t" (word) and "e" (meaning)`); }));
(DATA.grammar || []).forEach((g, i) => { if (!str(g.t) || !str(g.e)) problems.push(`grammar ${i + 1}: needs "t" (pattern) and "e" (meaning)`); });

if (problems.length) {
  console.error(`\n✗ Found ${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
  problems.forEach(p => console.error('  - ' + p));
  console.error('\nFix these, commit again, and GitHub will retry.\n');
  process.exit(1);
}
const count = Object.keys(NEED).reduce((n, id) => n + DATA[id].length, 0);
const nw = decks.reduce((n, d) => n + d.words.length, 0);
console.log(`✓ data/content.js looks good: ${count} practice sets across ${Object.keys(NEED).length} task types.`);
console.log(`✓ data/words.js looks good: ${nw} words in ${decks.length} decks, ${(DATA.grammar || []).length} grammar patterns.`);
