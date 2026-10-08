// Lists every line of built-in audio the app can play, assigns each one a
// voice, and writes:
//   scripts/audio_jobs.json  - clips the voice generator should create
//   audio/index.json         - clips that already exist (read by the app)
// It also tells GitHub Actions how many clips are still missing.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, 'audio-key.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'data', 'content.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'data', 'words.js'), 'utf8') +
  '\n;globalThis.__DATA = DATA; globalThis.__key = audioKey;', ctx);
const DATA = ctx.__DATA, key = ctx.__key;

// Microsoft Edge neural voices for Korean. s 0 is always the man (남자),
// s 1 always the woman (여자), matching the names in the transcripts.
const VOICES = ['ko-KR-InJoonNeural', 'ko-KR-SunHiNeural'];
const jobs = new Map();
function add(s, text) {
  if (!text || !String(text).trim()) return;
  s = s === 1 ? 1 : 0;
  const k = key(s, text);
  if (!jobs.has(k)) jobs.set(k, { key: k, text: String(text).trim(), voice: VOICES[s] });
}
// These must match exactly how app.js calls speak() and mountPlayer().
for (const id of ['lnext', 'laction', 'lmatch', 'lcentral'])
  for (const set of DATA[id] || []) set.items.forEach(x => x.lines.forEach(l => add(l.s, l.t)));
for (const id of ['lpair', 'guided', 'notes'])
  for (const it of DATA[id] || []) it.lines.forEach(l => add(l.s, l.t));
for (const it of DATA.segment || []) it.segments.forEach(g => add(it.s || 0, g.t));
for (const it of DATA.build || []) it.items.forEach(x => add(1, x.context));
// Word pronunciations for the Words tab (grammar cards have no audio)
for (const deck of DATA.words || []) for (const w of deck.words) add(1, w.t);

const all = [...jobs.values()];
const audioDir = path.join(root, 'audio');
fs.mkdirSync(audioDir, { recursive: true });
const exists = j => fs.existsSync(path.join(audioDir, j.key + '.mp3'));
const missing = all.filter(j => !exists(j));
fs.writeFileSync(path.join(root, 'scripts', 'audio_jobs.json'), JSON.stringify(missing, null, 1));
const files = Object.fromEntries(all.filter(exists).map(j => [j.key, j.key + '.mp3']));
fs.writeFileSync(path.join(audioDir, 'index.json'), JSON.stringify({ version: 1, count: Object.keys(files).length, files }));
console.log(`${all.length} clips in total, ${all.length - missing.length} ready, ${missing.length} to generate.`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `missing=${missing.length}\n`);
