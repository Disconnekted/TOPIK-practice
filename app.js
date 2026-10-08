
// ---------- Utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const stage = $('#stage');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Korean is counted in 어절 (space-separated units) for notes, and in
// characters for writing answers, like the 원고지 answer sheet.
const wordCount = s => (s.trim().match(/\S+/g) || []).length;
const charCount = s => s.replace(/\r?\n/g, '').length;
// Enter can arrive while the Korean keyboard is still composing a syllable.
const enterKey = e => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;

let SETTINGS = Object.assign({ rate: 1, exam: false, english: true, voiceA: '', voiceB: '', haptics: true }, store.get('topik2-settings', {}));
let STATS = store.get('topik2-stats', {});
let EXTRA = store.get('topik2-extra', {});
let CURSOR = store.get('topik2-cursor', {});
let HIST = store.get('topik2-hist', {});
function pushHist(id, v) { if (v == null || isNaN(v)) return; (HIST[id] = HIST[id] || []).push({ t: Date.now(), v: Math.max(0, Math.min(1, v)) }); HIST[id] = HIST[id].slice(-30); store.set('topik2-hist', HIST); }
const saveSettings = () => store.set('topik2-settings', SETTINGS);

function pool(id) { return (DATA[id] || []).concat(EXTRA[id] || []); }
function record(id, pts, tot) {
  if (typeof markStudyDay === 'function') markStudyDay();
  if (current && current.daily && DAILY && DAILY.steps[DAILY.i] && DAILY.steps[DAILY.i].id === id) dailyResult(pts, tot);
  buzz(tot && pts / tot >= 0.8 ? 25 : [25, 70, 25]);
  const s = STATS[id] || { sets: 0, pts: 0, tot: 0 };
  s.sets++; s.pts += pts; s.tot += tot; STATS[id] = s; store.set('topik2-stats', STATS);
  if (tot) pushHist(id, pts / tot);
}
function recordAI(id, score) {
  if (typeof markStudyDay === 'function') markStudyDay();
  const s = STATS[id] || { sets: 0, pts: 0, tot: 0 };
  s.sets++; if (score != null) s.last = score; STATS[id] = s; store.set('topik2-stats', STATS);
}
// Writing scores are kept as a share of the task's full marks (e.g. 7/10).
function setLast(id, score, max) {
  if (score == null) return;
  const s = STATS[id] || { sets: 1, pts: 0, tot: 0 };
  s.last = score; s.max = max; STATS[id] = s; store.set('topik2-stats', STATS);
  pushHist(id, score / max);
}

// ---------- Android helpers ----------
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
function buzz(pattern) { if (SETTINGS.haptics === false) return; try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { } }
// Keep the screen on during listening. Android turns the screen off after
// ~30 s by default, which also stops the audio mid-talk.
let wakeLock = null, wantWake = false;
async function keepAwake(on) {
  wantWake = on;
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantWake) keepAwake(true); });

// Wide screens (computers, tablets in landscape): reading tasks show the
// passage on the left and the questions on the right.
function useWide(on) { document.body.classList.toggle('wide', !!on); }

// ---------- Cleanup between screens ----------
let cleanups = [];
function onLeave(fn) { cleanups.push(fn); }
function go(fn) {
  cleanups.forEach(f => { try { f(); } catch (e) { } }); cleanups = [];
  stopSpeech(); keepAwake(false); closeSheet(); useWide(false);
  fn(); window.scrollTo(0, 0);
}

// ---------- Theme ----------
function effectiveDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function paintThemeBtn() { $('#themeBtn').textContent = effectiveDark() ? '☀️' : '🌙'; }
(function initTheme() { const t = store.get('topik2-theme', null); if (t) document.documentElement.setAttribute('data-theme', t); paintThemeBtn(); })();
$('#themeBtn').addEventListener('click', () => {
  const next = effectiveDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next); store.set('topik2-theme', next); paintThemeBtn();
});

// ---------- Text to speech ----------
// Speaker 0 is 남자 (the man) and speaker 1 is 여자 (the woman), as in TOPIK
// questions like "여자가 이어서 할 행동". The phone's Korean voices are ranked
// so the most natural ones come first, and the two speakers get different
// voices (a male and a female one when the phone has both).
let VOICES = [];
const MALE_N = /\b(Male|InJoon|Hyunsu|Minsu|BongJin|GookMin)\b|남성/i;
const FEMALE_N = /\b(Female|SunHi|Heami|Yuna|Sora|JiMin|SeoHyeon|SoonBok|YuJin)\b|여성/i;
const ANDROID_F = /-x-(ism|kob)/i, ANDROID_M = /-x-(koc|kod)/i;
function voiceGender(v) {
  const id = (v.voiceURI || '') + ' ' + v.name;
  if (ANDROID_M.test(id)) return 'm'; if (ANDROID_F.test(id)) return 'f';
  return MALE_N.test(v.name) ? 'm' : FEMALE_N.test(v.name) ? 'f' : '?';
}
function voiceScore(v) {
  const n = v.name;
  let s = 0;
  if (/Natural|Neural/i.test(n)) s += 100; else if (/Online/i.test(n)) s += 80;
  if (/Premium/i.test(n)) s += 95;
  if (/Enhanced/i.test(n)) s += 70;
  if (/Google/i.test(n)) s += 55;
  if (/network/i.test((v.voiceURI || '') + n)) s += 60; else if (/-x-.*local/i.test((v.voiceURI || '') + n)) s += 20;
  return s;
}
function loadVoices() {
  try {
    VOICES = speechSynthesis.getVoices()
      .filter(v => /^ko[-_]?/i.test(v.lang))
      .sort((a, b) => voiceScore(b) - voiceScore(a));
  } catch (e) { VOICES = []; }
  if (document.getElementById('vA')) fillVoiceSelects();
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function autoPair() {
  if (!VOICES.length) return [null, null];
  const best = g => VOICES.find(v => voiceGender(v) === g);
  const m = best('m'), f = best('f');
  if (m && f) return [m, f];
  const a = VOICES[0];
  const b = VOICES.find(v => v !== a && voiceScore(v) >= voiceScore(a) - 45) || VOICES.find(v => v !== a) || a;
  return [a, b];
}
function voicesForSpeakers() {
  const [aa, ab] = autoPair();
  const find = uri => uri && VOICES.find(v => v.voiceURI === uri);
  return [find(SETTINGS.voiceA) || aa, find(SETTINGS.voiceB) || ab];
}
let playToken = 0;
function stopSpeech() { playToken++; try { speechSynthesis.cancel(); } catch (e) { } try { studioPlayer.pause(); } catch (e) { } }
function splitSentences(t) { return (t.match(/[^.!?]+[.!?]*["'”’]?\s*/g) || [t]).map(s => s.trim()).filter(Boolean); }
// ---------- Studio audio: recorded clips made by the GitHub build ----------
// audio/index.json maps audioKey(speaker, text) → mp3 file. If every line in
// a request has a recording, play those; otherwise use the phone's voices.
let AUDIO_INDEX = null;
const studioPlayer = new Audio(); studioPlayer.preload = 'auto';
const clipUrls = new Map();
fetch('audio/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
  if (j && j.files && Object.keys(j.files).length) AUDIO_INDEX = j.files;
  const st = document.getElementById('studioStatus'); if (st) st.textContent = studioStatus();
}).catch(() => { });
function studioStatus() {
  return AUDIO_INDEX ? `${Object.keys(AUDIO_INDEX).length} recorded clips available.` : 'No recorded clips yet, so your phone\'s Korean voices are used. They appear after GitHub finishes building the audio.';
}
function useStudio(lines) { return SETTINGS.studio !== false && AUDIO_INDEX && lines.length && lines.every(l => AUDIO_INDEX[audioKey(l.s || 0, l.t)]); }
async function clipUrl(file) {
  if (clipUrls.has(file)) return clipUrls.get(file);
  const r = await fetch('audio/' + file); if (!r.ok) throw new Error('missing clip');
  const u = URL.createObjectURL(await r.blob()); clipUrls.set(file, u); return u;
}
function playStudio(lines, onEnd, onProgress) {
  stopSpeech();
  const token = playToken; let i = 0;
  const fallback = () => { if (token !== playToken) return; speakTTS(lines.slice(Math.max(0, i - 1)), onEnd, onProgress); };
  const next = async () => {
    if (token !== playToken) return;
    if (i >= lines.length) { onEnd && onEnd(true); return; }
    const l = lines[i++];
    try {
      const url = await clipUrl(AUDIO_INDEX[audioKey(l.s || 0, l.t)]);
      if (token !== playToken) return;
      const rate = Math.max(0.6, Math.min(1.5, SETTINGS.rate));
      studioPlayer.src = url; studioPlayer.defaultPlaybackRate = rate; studioPlayer.playbackRate = rate;
      try { studioPlayer.preservesPitch = true; } catch (e) { }
      studioPlayer.onended = () => { if (token === playToken) setTimeout(next, i < lines.length ? 350 + Math.random() * 300 : 0); };
      studioPlayer.onerror = fallback;
      studioPlayer.ontimeupdate = () => { if (token === playToken && onProgress && studioPlayer.duration) onProgress((i - 1 + studioPlayer.currentTime / studioPlayer.duration) / lines.length); };
      await studioPlayer.play();
    } catch (e) { fallback(); }
  };
  next();
}
async function saveAllAudio(btn, out) {
  if (!('caches' in window) || !AUDIO_INDEX) { out.textContent = 'There is no recorded audio to save yet.'; return; }
  const files = [...new Set(Object.values(AUDIO_INDEX))];
  const cache = await caches.open('topik-audio');
  let done = 0, failed = 0; btn.disabled = true;
  for (const f of files) {
    const url = new URL('audio/' + f, location.href).href;
    try { if (!(await cache.match(url))) { const r = await fetch(url); if (r.ok) await cache.put(url, r); else failed++; } } catch (e) { failed++; }
    done++; if (done % 5 === 0 || done === files.length) out.textContent = `Saving ${done} of ${files.length}…`;
  }
  out.textContent = failed ? `Saved ${files.length - failed} of ${files.length}. Try again on a better connection.` : `All ${files.length} clips saved. Listening works offline now.`;
  btn.disabled = false;
}
function speak(lines, onEnd, onProgress) {
  if (useStudio(lines)) { playStudio(lines, onEnd, onProgress); return; }
  speakTTS(lines, onEnd, onProgress);
}
// Plays lines one speaker turn at a time, with a short, slightly varied
// pause between turns (like people taking turns).
function speakTTS(lines, onEnd, onProgress) {
  if (!('speechSynthesis' in window)) { toast("Audio isn't available in this browser."); onEnd && onEnd(false); return; }
  stopSpeech();
  const token = playToken;
  const [vA, vB] = voicesForSpeakers();
  const same = !vA || !vB || vA.voiceURI === vB.voiceURI;
  const turns = lines.map(l => ({ s: l.s || 0, parts: splitSentences(l.t), jitter: 1 + (Math.random() * 0.06 - 0.03) }));
  const totalParts = turns.reduce((n, t) => n + t.parts.length, 0) || 1; let doneParts = 0;
  let ti = 0, started = false;
  const playTurn = () => {
    if (token !== playToken) return;
    if (ti >= turns.length) { onEnd && onEnd(true); return; }
    const T = turns[ti++], v = T.s === 1 ? vB : vA;
    const rate = Math.max(0.5, Math.min(1.6, SETTINGS.rate * T.jitter));
    let finished = false, idle = 0, watch = null;
    const turnEnd = () => {
      if (finished || token !== playToken) return;
      finished = true; clearInterval(watch);
      const gap = ti < turns.length ? 380 + Math.random() * 380 : 0;
      setTimeout(playTurn, gap);
    };
    T.parts.forEach((p, k) => {
      const u = new SpeechSynthesisUtterance(p);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ko-KR';
      u.rate = rate; u.pitch = same ? (T.s === 1 ? 1.15 : 0.88) : 1;
      u.onstart = () => { started = true; };
      u.addEventListener('end', () => { if (token === playToken && onProgress) onProgress(++doneParts / totalParts); });
      if (k === T.parts.length - 1) { u.onend = turnEnd; u.onerror = turnEnd; }
      speechSynthesis.speak(u);
    });
    // Some browsers never fire "end"; move on once speech has gone quiet.
    watch = setInterval(() => {
      if (token !== playToken) { clearInterval(watch); return; }
      if (!speechSynthesis.speaking && !speechSynthesis.pending) { if (++idle >= 5) turnEnd(); } else idle = 0;
    }, 250);
  };
  if (IS_ANDROID) setTimeout(playTurn, 150); else playTurn();
  setTimeout(() => {
    if (token === playToken && !started && !speechSynthesis.speaking) {
      stopSpeech(); toast("Audio didn't start. Check your volume, or install a Korean voice (see Settings)."); onEnd && onEnd(false);
    }
  }, 3000);
}
function voiceTip() {
  const ua = navigator.userAgent;
  if (!VOICES.length) {
    if (/Android/.test(ua)) return 'No Korean voice found. Open Android Settings and search "Text-to-speech output". Choose "Speech Services by Google", tap the gear › Install voice data › 한국어 (Korean), download it, then reload this page.';
    if (/iPhone|iPad|iPod/.test(ua)) return 'No Korean voice found. Open Settings › Accessibility › Spoken Content › Voices › Korean, download a voice (Premium or Enhanced if offered), then reload this page.';
    return 'No Korean voice found. Microsoft Edge includes free natural Korean voices (SunHi, InJoon). Or install a Korean voice in your system settings and reload.';
  }
  const great = VOICES.filter(v => voiceScore(v) >= 90).length;
  if (great >= 2) return `Found ${great} natural-sounding Korean voices. ★ marks the best ones.`;
  if (/Android/.test(ua)) return 'For better voices: in Android Settings › Text-to-speech output, choose "Speech Services by Google" and download the Korean voice data.';
  return 'For the most natural Korean voices, open this page in Microsoft Edge.';
}
function voiceLabel(v) {
  const g = { m: 'male', f: 'female', '?': '' }[voiceGender(v)];
  const code = /^[a-z]{2}[-_][a-z]{2}-x-([a-z]{3})-(network|local)/i.exec(v.name);
  if (code) return `${voiceScore(v) >= 90 ? '★ ' : ''}Voice ${code[1].toUpperCase()}${g ? `, ${g}` : ''}, ${code[2] === 'network' ? 'online, higher quality' : 'offline'} (${v.lang})`;
  return `${voiceScore(v) >= 90 ? '★ ' : ''}${v.name.replace(/^Microsoft\s+/, '').replace(/\s*-\s*Korean.*$/, '')}${g ? `, ${g}` : ''} (${v.lang})`;
}
function fillVoiceSelects() {
  const [aa, ab] = autoPair();
  [['vA', 'voiceA', aa], ['vB', 'voiceB', ab]].forEach(([elId, key, auto]) => {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = `<option value="">Automatic${auto ? `: ${esc(voiceLabel(auto))}` : ''}</option>` +
      VOICES.map(v => `<option value="${esc(v.voiceURI)}" ${SETTINGS[key] === v.voiceURI ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('');
  });
  const tip = document.getElementById('voiceTip'); if (tip) tip.textContent = voiceTip();
}

// A play control that respects exam mode (one play only)
function mountPlayer(el, lines, { label = '▶ Play audio', onFirstEnd, once = false } = {}) {
  let plays = 0, playing = false, firstDone = false;
  const single = () => once || SETTINGS.exam;
  el.innerHTML = `<button class="btn" data-p="play">${label}</button><button class="btn ghost small" data-p="stop" hidden>■ Stop</button><span class="state"></span><div class="pbar" role="progressbar" aria-label="Audio progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>`;
  const play = $('[data-p=play]', el), stop = $('[data-p=stop]', el), state = $('.state', el), bar = $('.pbar', el), fill = $('.pbar i', el);
  const setP = f => { const v = Math.round(Math.max(0, Math.min(1, f)) * 100); fill.style.width = v + '%'; bar.setAttribute('aria-valuenow', v); };
  const paint = () => {
    play.hidden = playing; stop.hidden = !playing || once;
    if (single() && plays >= 1 && !playing) { play.disabled = true; play.textContent = 'Played'; }
    else if (plays >= 1) play.textContent = '↺ Play again';
    state.textContent = playing ? (once ? 'Playing… one time only' : 'Playing…') : (once ? (plays ? 'Finished' : 'You will hear it once') : SETTINGS.exam ? 'Exam mode: one listen only' : (plays ? `Played ${plays}×` : ''));
  };
  play.addEventListener('click', () => {
    plays++; playing = true; paint(); setP(0);
    speak(lines, ok => {
      playing = false; if (ok !== false) setP(1);
      if (ok === false) { plays = Math.max(0, plays - 1); paint(); return; } // audio failed: allow another try
      paint(); if (!firstDone) { firstDone = true; onFirstEnd && onFirstEnd(); }
    }, setP);
  });
  stop.addEventListener('click', () => { stopSpeech(); playing = false; paint(); if (!firstDone) { firstDone = true; onFirstEnd && onFirstEnd(); } });
  paint();
}

// ---------- Claude (optional, with your own Anthropic API key) ----------
// The key is stored only in this browser (localStorage) and sent only to
// api.anthropic.com. Usage is billed to the key owner's Anthropic account.
const DEFAULT_MODEL = 'claude-sonnet-5-5';
let sample = null;
function parseJsonLoose(t) {
  try { return JSON.parse(t); } catch (e) { }
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) { try { return JSON.parse(m[1]); } catch (e) { } }
  const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { } }
  return undefined;
}
function makeApiSample() {
  const key = (SETTINGS.apiKey || '').trim(); if (!key) return null;
  const call = async (input, opts = {}) => {
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: opts.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: (SETTINGS.model || DEFAULT_MODEL).trim(), max_tokens: 6000, messages })
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'cancelled' };
      throw { code: navigator.onLine === false ? 'offline' : 'upstream_error' };
    }
    if (!res.ok) {
      let msg = ''; try { msg = (await res.json()).error?.message || ''; } catch (e) { }
      const code = res.status === 401 || res.status === 403 ? 'bad_key' : res.status === 429 ? 'rate_limited' : res.status === 400 || res.status === 404 ? 'bad_request' : 'upstream_error';
      throw { code, message: msg };
    }
    const data = await res.json();
    const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');
    if (!text.trim()) throw { code: 'empty_completion' };
    return { text, truncated: data.stop_reason === 'max_tokens' };
  };
  const fn = (input, opts) => call(input, opts);
  fn.json = async (input, opts) => {
    const { text } = await call(typeof input === 'string' ? input + '\n\nRespond with only the JSON value, with no other text.' : input, opts);
    const v = parseJsonLoose(text); if (v === undefined) throw { code: 'invalid_json', text }; return v;
  };
  return fn;
}
function refreshAI() { sample = makeApiSample(); document.documentElement.classList.toggle('has-ai', !!sample); }
refreshAI();
function aiErrorText(e) {
  const c = e && e.code;
  if (c === 'bad_key') return 'Your Anthropic API key was rejected. Check it in Settings.';
  if (c === 'offline') return "You're offline. Claude features need an internet connection.";
  if (c === 'bad_request') return 'Claude could not process this request' + (e.message ? `: ${e.message}` : '.') + ' If it mentions the model, check the model name in Settings.';
  if (c === 'rate_limited') return "You've hit a usage limit. Try again in a little while.";
  if (c === 'invalid_json') return "Claude's reply couldn't be read. Try again.";
  if (c === 'cancelled') return '';
  return 'Something went wrong reaching Claude. Try again.';
}
// Feedback language: English explanations by default, or all in Korean.
const fbLang = () => SETTINGS.english !== false
  ? ' Write all explanations in clear, simple English, quoting the Korean where relevant.'
  : ' Write all explanations in Korean (한국어), at a level a TOPIK II learner can follow.';

// ---------- Task registry ----------
// TOPIK II (paper test): 듣기 Listening 50 questions, 쓰기 Writing questions
// 51-54, 읽기 Reading 50 questions. "ko" is the instruction line printed in the
// real test booklet; "nums" says which question numbers a task practices.
const MCQ_SCHEMA_NOTE = 'Each question has "q" (in Korean), "options" (4 Korean strings), "answer" (index 0-3 of the correct option), and "why" (one short sentence in English explaining the answer, quoting the Korean text). Vary which index is correct.';
const ITEM_SCHEMA_NOTE = 'Each item has "options" (4 Korean strings), "answer" (index 0-3), and "why" (one short English sentence explaining the answer, quoting the Korean). Vary which index is correct across items.';
const LINES_NOTE = '"lines" is an array of {"s": 0 or 1, "name": "남자" or "여자", "t": "what they say"}; s 0 is always 남자 (the man) and s 1 is always 여자 (the woman). Write numbers in Hangul words where they are spoken.';
const isMcq = qs => Array.isArray(qs) && qs.length >= 1 && qs.every(q => q && typeof q.q === 'string' && Array.isArray(q.options) && q.options.length >= 3 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
const isLines = ls => Array.isArray(ls) && ls.length >= 1 && ls.every(l => l && typeof l.t === 'string' && (l.s === 0 || l.s === 1));
const isOpt = x => x && Array.isArray(x.options) && x.options.length >= 3 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.options.length;
const isItems = (it, n, extra = () => true) => Array.isArray(it.items) && it.items.length >= n && it.items.every(x => isOpt(x) && extra(x));

const TASKS = {
  // ----- Listening -----
  lnext: { section: 'Listening', nums: '4–8', name: 'Choose the next line', ko: '다음을 듣고 이어질 수 있는 말로 가장 알맞은 것을 고르십시오.', blurb: 'A short exchange; pick what the speaker says next.', render: renderItems, items: true,
    how: 'Listen to each short exchange and choose the most natural next line.',
    tip: '<b>Focus on the last line.</b> Is it a question, a request, a suggestion, or news? The answer reacts to exactly that. Options that repeat words from the audio but don\'t respond to the last line are traps.',
    gen: 'A set of 5 items. Each item has "lines": a 2-3 turn everyday conversation between a man and a woman (school, work, shops, services) ending mid-exchange, and 4 "options": possible next lines by the other speaker, exactly one natural. ' + LINES_NOTE + ' ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => isLines(x.lines)) },
  laction: { section: 'Listening', nums: '9–12', name: 'What will they do next?', ko: '다음을 듣고 여자가 이어서 할 행동으로 가장 알맞은 것을 고르십시오.', blurb: 'Hear a conversation and pick the next action.', render: renderItems, items: true,
    how: 'Listen and choose what the speaker named in the question will do right after the conversation.',
    tip: '<b>Listen for the final agreement.</b> Several actions are usually mentioned; the answer is the one the speaker agrees to do <i>now</i>, often after "그럼…", "제가 -(으)ㄹ게요", or "-아/어 주세요".',
    gen: 'A set of 4 items. Each item has "lines": a 4-turn conversation between a man and a woman in which several actions are mentioned, "q": "여자가 이어서 할 행동으로 가장 알맞은 것을 고르십시오." (or 남자가), and 4 action "options" ending in -ㄴ다/-는다. ' + LINES_NOTE + ' ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => isLines(x.lines)) },
  lmatch: { section: 'Listening', nums: '13–16', name: 'Choose what matches', ko: '다음을 듣고 들은 내용과 같은 것을 고르십시오.', blurb: 'Conversations, announcements and news; find the true statement.', render: renderItems, items: true,
    how: 'Listen and choose the statement that agrees with what you heard.',
    tip: '<b>Read the options first.</b> Before you play, skim all four options and note what each one claims (who, when, how many). While listening, cross out each option the audio contradicts.',
    gen: 'A set of 4 items: two conversations (4 turns), one announcement, and one short news report (one speaker). Each has "lines" and 4 Korean statement "options", exactly one true to the audio; the false ones change one detail. ' + LINES_NOTE + ' ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => isLines(x.lines)) },
  lcentral: { section: 'Listening', nums: '17–20', name: "The speaker's central thought", ko: '다음을 듣고 남자의 중심 생각으로 가장 알맞은 것을 고르십시오.', blurb: "Identify the man's main opinion.", render: renderItems, items: true,
    how: "Listen and choose the man's central thought: his main opinion, not just a detail he mentions.",
    tip: '<b>Find the opinion, not the fact.</b> The central thought is usually stated with expressions like -아/어야 하다, -는 게 좋다, -(으)ㄹ 필요가 있다, or 중요하다, often near the end. A true detail is not the same as the main idea.',
    gen: 'A set of 4 items. Each has "lines": a 3-4 turn conversation (or for one item, an interview) where the man clearly states an opinion, "q": "남자의 중심 생각으로 가장 알맞은 것을 고르십시오.", and 4 Korean "options" ending in -다. ' + LINES_NOTE + ' ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => isLines(x.lines)) },
  lpair: { section: 'Listening', nums: '21–50', name: 'Longer talks, two questions', ko: '다음을 듣고 물음에 답하십시오.', blurb: 'Conversations, interviews, lectures and debates.', render: renderPair,
    how: 'Read the two questions first, then listen once and answer both. These follow the TOPIK pattern of one recording with two questions.',
    tip: '<b>Read both questions before the audio.</b> The test booklet shows them, so use the time: underline what each asks (중심 생각, 태도, 이유, 일치). One question is usually about the whole talk; the other about a detail.',
    gen: 'One recording for TOPIK II listening questions 21-50: "kind" is one of 대화, 인터뷰, 강연, 다큐멘터리, 대담, 뉴스. ' + LINES_NOTE + ' Conversations and interviews have 4-6 turns; lectures and documentaries are one speaker of 250-350 Korean characters. Then exactly 2 "questions" in TOPIK style, chosen from: 중심 생각, 들은 내용과 같은 것, 말하는 의도, 태도, 이유, 무엇에 대한 내용인지. ' + MCQ_SCHEMA_NOTE,
    ok: it => isLines(it.lines) && isMcq(it.questions) },
  // ----- Reading -----
  rgram: { section: 'Reading', nums: '1–4', name: 'Grammar in a sentence', ko: '(    )에 들어갈 가장 알맞은 것을 고르십시오. / 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.', blurb: 'Fill the blank or find the grammar that means the same.', render: renderItems, items: true,
    how: 'Choose the grammar that fits the blank, or the expression closest in meaning to the underlined part.',
    tip: '<b>Look at the connection between the two clauses.</b> Is it a reason, a contrast, a condition, a purpose, or a guess? Then check tense and what can come after the ending (some can\'t take -았/었- or a command).',
    gen: 'A set of 4 items: 2 with "type": "blank" and 2 with "type": "similar". "q" is one Korean sentence. For blank items it contains (    ) where an intermediate grammar ending goes; for similar items the target expression is wrapped in [[double brackets]]. 4 grammar "options". ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => typeof x.q === 'string') },
  rtopic: { section: 'Reading', nums: '5–8', name: 'What is it about?', ko: '다음은 무엇에 대한 글인지 고르십시오.', blurb: 'Ads, signs and slogans in a few words.', render: renderItems, items: true,
    how: 'Read the short ad or notice and choose what it is about.',
    tip: '<b>Key words over grammar.</b> These texts are slogans with few full sentences. Find two or three content words (e.g. 충전, 통화 → phone) and match them to an option.',
    gen: 'A set of 4 items. Each "text" is a 2-3 line Korean advertisement, public campaign slogan, notice, or product guide (use \\n for line breaks), and 4 short noun "options" such as 휴대 전화, 병원, 환경 보호, 사용 방법. ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => typeof x.text === 'string') },
  rmatch: { section: 'Reading', nums: '9–12, 32–34', name: 'Choose what matches', ko: '다음 글 또는 그래프의 내용과 같은 것을 고르십시오.', blurb: 'Notices, articles and short texts; find the true statement.', render: renderItems, items: true, wide: true,
    how: 'Read the text and choose the statement that agrees with it.',
    tip: '<b>Check every option against the text.</b> Wrong options usually change one detail: a number, a time, who did it, or "all" for "some". Find the exact sentence that proves your answer.',
    gen: 'A set of 4 items. Each has "kind" (안내문, 기사, 설명문, 이메일), "text" (a Korean text of 150-350 characters, \\n for line breaks), and 4 Korean statement "options", exactly one consistent with the text. ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => typeof x.text === 'string') },
  rorder: { section: 'Reading', nums: '13–15', name: 'Put the sentences in order', ko: '다음을 순서대로 맞게 배열한 것을 고르십시오.', blurb: 'Order four sentences (가)–(라).', render: renderItems, items: true,
    how: 'Choose the order that makes a natural paragraph.',
    tip: '<b>Find the first sentence, then follow the links.</b> Sentences starting with 그래서, 하지만, 이, 그 or 이것 can\'t come first. Two options usually share the first sentence, so check the connector words (signal words) to decide what follows.',
    gen: 'A set of 3 items. Each has "sents": exactly 4 Korean sentences labelled in order (가), (나), (다), (라) as written (not the correct order), forming one paragraph when reordered; "options": 4 orders written like "(나)-(가)-(라)-(다)"; two options start with the same sentence. ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 2, x => Array.isArray(x.sents) && x.sents.length === 4) },
  rblank: { section: 'Reading', nums: '16–18, 28–31', name: 'Fill the blank in a passage', ko: '다음을 읽고 (    )에 들어갈 내용으로 가장 알맞은 것을 고르십시오.', blurb: 'Choose the phrase that completes the paragraph.', render: renderItems, items: true, wide: true,
    how: 'Read the paragraph and choose the phrase that fits the blank.',
    tip: '<b>The blank is explained by the sentences around it.</b> Read the sentence before and after; look for a signal word (그래서, 하지만, 즉) that tells you whether the blank repeats, contrasts, or concludes.',
    gen: 'A set of 4 items. Each "text" is a Korean expository paragraph of 200-350 characters on society, science, culture or economy containing (    ) where a key phrase is missing; 4 phrase "options". ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => typeof x.text === 'string' && x.text.includes('(')) },
  rhead: { section: 'Reading', nums: '25–27', name: 'Newspaper headlines', ko: '다음은 신문 기사의 제목입니다. 가장 잘 설명한 것을 고르십시오.', blurb: 'Decode compressed headline language.', render: renderItems, items: true,
    how: 'Choose the sentence that best explains the headline.',
    tip: '<b>Unpack the headline.</b> Headlines drop endings and use symbols: a comma often means "and", "…" or a final noun means the story is ongoing. Words like 껑충 (jump), 뚝 (drop), 활짝 (wide open), 주춤 (hesitate) carry the meaning, so learn them.',
    gen: 'A set of 3 items. Each "text" is a compressed Korean newspaper headline (with typical words like 껑충, 뚝, 주춤, 활짝, 비상, 훈풍, 먹구름), and 4 full-sentence "options" explaining it. ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 2, x => typeof x.text === 'string') },
  rmain: { section: 'Reading', nums: '35–38', name: 'Find the main idea', ko: '다음 글의 주제로 가장 알맞은 것을 고르십시오.', blurb: 'Choose the topic of an argument or explanation.', render: renderItems, items: true, wide: true,
    how: 'Read the paragraph and choose its main idea.',
    tip: '<b>Korean writers often save the point for the end.</b> Read the last sentence carefully, especially after 따라서, 그러므로, 결국, or -아/어야 한다. Options that are true but only about one detail are traps.',
    gen: 'A set of 4 items. Each "text" is a Korean argumentative or expository paragraph of 300-400 characters whose main idea is stated near the end; 4 Korean "options" ending in -다. ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 3, x => typeof x.text === 'string') },
  rinsert: { section: 'Reading', nums: '39–41', name: 'Where does the sentence go?', ko: '주어진 문장이 들어갈 곳으로 가장 알맞은 것을 고르십시오.', blurb: 'Place a given sentence at ㉠, ㉡, ㉢ or ㉣.', render: renderItems, items: true, wide: true,
    how: 'Choose where the sentence in the box fits best.',
    tip: '<b>Use the sentence\'s own clues.</b> Words like 이, 그, 이러한, 또한, 하지만 at its start point back to something; find the spot right after the idea they refer to, and check that the sentence after it still follows.',
    gen: 'A set of 3 items. Each "text" is a Korean paragraph of 300-400 characters with the four positions marked ( ㉠ ), ( ㉡ ), ( ㉢ ), ( ㉣ ); "given" is the sentence to insert; "options" are exactly ["㉠", "㉡", "㉢", "㉣"]. ' + ITEM_SCHEMA_NOTE,
    ok: it => isItems(it, 2, x => typeof x.text === 'string' && typeof x.given === 'string') },
  rpair: { section: 'Reading', nums: '19–24, 42–50', name: 'Longer passages', ko: '다음을 읽고 물음에 답하십시오.', blurb: 'Articles, essays and fiction with 2–3 questions.', render: renderLong, wide: true,
    how: 'Read the passage and answer all its questions.',
    tip: '<b>Read the questions first, then the passage.</b> Knowing whether you need a blank, the writer\'s attitude (태도), a character\'s feeling (심정), or the purpose (목적) tells you what to look for.',
    gen: 'One reading passage for TOPIK II questions 19-24 or 42-50: "kind" is one of 설명문, 칼럼, 기사, 수필, 소설, 논설문; "text" is a Korean text of 450-700 characters (\\n between paragraphs; for 소설, an original literary excerpt with one underlined phrase in [[double brackets]]). Then 2 or 3 "questions" in TOPIK style chosen from: (    )에 들어갈 말, 밑줄 친 부분에 나타난 인물의 심정, 필자의 태도, 글을 쓴 목적, 글의 내용과 같은 것. If a blank question is used, put (    ) in the text. ' + MCQ_SCHEMA_NOTE,
    ok: it => typeof it.text === 'string' && isMcq(it.questions) },
  // ----- Writing -----
  w51: { section: 'Writing', nums: '51', name: 'Complete a practical text', ko: '다음 글의 ㉠과 ㉡에 알맞은 말을 각각 쓰시오. (10점)', blurb: 'An email or notice with two missing sentences.', render: renderGap, writing: true, max: 10, mins: 6,
    how: 'Write one sentence for ㉠ and one for ㉡ that fit the text\'s purpose, grammar, and level of politeness.',
    gen: 'A TOPIK question 51 practical text: "kind" (이메일, 안내문, 문자 메시지, 게시판 글), "text" of 150-250 Korean characters in polite -습니다/-아요 style with two gaps written (    ㉠    ) and (    ㉡    ) where a full clause is missing; the words right after each gap should constrain the answer. "model": {"a": model answer for ㉠, "b": model answer for ㉡}. "tip": one English sentence on the clue that decides each answer.',
    ok: it => typeof it.text === 'string' && it.model && typeof it.model.a === 'string' },
  w52: { section: 'Writing', nums: '52', name: 'Complete an explanation', ko: '다음 글의 ㉠과 ㉡에 알맞은 말을 각각 쓰시오. (10점)', blurb: 'An explanatory paragraph with two missing clauses.', render: renderGap, writing: true, max: 10, mins: 6,
    how: 'Write one clause for ㉠ and one for ㉡. Use the written -다 style, like the rest of the paragraph.',
    gen: 'A TOPIK question 52 explanatory paragraph of 4-5 sentences (180-250 Korean characters) in written -ㄴ다/-다 style, with two gaps (    ㉠    ) and (    ㉡    ); signal words around each gap (그러나, 따라서, 그래서, 즉, 반면) should determine the content. "model": {"a": ..., "b": ...}. "tip": one English sentence on the clue for each gap.',
    ok: it => typeof it.text === 'string' && it.model && typeof it.model.a === 'string' },
  w53: { section: 'Writing', nums: '53', name: 'Describe a chart', ko: '다음을 참고하여 200~300자로 글을 쓰시오. 단, 글의 제목을 쓰지 마시오. (30점)', blurb: 'Survey or trend data in 200–300 characters.', render: renderChart, writing: true, max: 30, mins: 15, chars: [200, 300],
    how: 'Describe the information in one paragraph of 200–300 characters, in written -다 style, without a title.',
    gen: 'A TOPIK question 53 task: "prompt" (one Korean line naming the survey or topic, e.g. "20대 이상 성인 남녀 500명을 대상으로 한 \'여가 활동\' 조사 결과"), "charts": 1-2 objects {"type": "bar" or "line", "title": Korean title, "unit": e.g. "%" or "만 명", "labels": [category or year labels], "series": [{"name": series label, "values": [numbers]}]}, optional "notes": up to 3 Korean bullet strings (reasons or outlook shown beside the chart), and "model": a 250-290 character model answer in -ㄴ다/-다 style.',
    ok: it => typeof it.prompt === 'string' && Array.isArray(it.charts) && it.charts.length >= 1 && typeof it.model === 'string' },
  w54: { section: 'Writing', nums: '54', name: 'Write an essay', ko: '다음을 주제로 하여 자신의 생각을 600~700자로 글을 쓰시오. 단, 문제를 그대로 옮겨 쓰지 마시오. (50점)', blurb: 'An argumentative essay of 600–700 characters.', render: renderEssay, writing: true, max: 50, mins: 25, chars: [600, 700],
    how: 'Write an essay that answers all three questions in the prompt, in written -다 style, with an introduction, body, and conclusion.',
    gen: 'A TOPIK question 54 essay task: "intro" (2-3 Korean sentences introducing a social issue), "points": exactly 3 Korean guiding questions (e.g. "…이/가 필요한 이유는 무엇인가?", "…의 문제점은 무엇인가?", "…을/를 위해 어떤 노력이 필요한가?"), and "model": a 620-690 character model essay in -ㄴ다/-다 style.',
    ok: it => typeof it.intro === 'string' && Array.isArray(it.points) && it.points.length >= 2 && typeof it.model === 'string' }
};
Object.assign(TASKS, {
  skim: { section: 'Reading strategies', name: 'Skim for the main idea', blurb: 'See only the first and last sentence of each paragraph, then answer.', render: renderSkim,
    how: 'You\'ll see the title and the first and last sentence of each paragraph for a short time. Then the passage disappears and you answer questions about the main idea and where information is.',
    gen: 'A Korean expository passage of 700-900 characters in exactly 4 "paras", written -다 style, where each paragraph\'s first sentence introduces its topic and its last sentence sums it up, and the writer\'s main claim is the LAST sentence of paragraph 4. Then 4 Korean questions answerable ONLY from the title and the first and last sentence of each paragraph: one 주제, one 필자의 주장, and two "…에 대한 내용은 몇 번째 단락에 있습니까?" (options "첫 번째 단락" to "네 번째 단락"). ' + MCQ_SCHEMA_NOTE,
    ok: it => Array.isArray(it.paras) && it.paras.length >= 3 && isMcq(it.questions) },
  trans: { section: 'Reading strategies', name: 'Signal words (접속 표현)', blurb: 'Choose connectors and predict what comes next.', render: renderTrans,
    how: 'Pick the connector that fits each gap, then predict where the writer goes next. Connectors show how ideas link, which is how you solve order, blank and sentence-insertion questions.',
    gen: 'A Korean expository paragraph of 250-350 characters with exactly 4 or 5 gaps written as [[function:Correct|Wrong1|Wrong2|Wrong3]] where function is one of contrast, cause, result, example, addition, restate, shift, concession. The correct connector comes FIRST; the 3 wrong ones are connectors with other functions (그러나, 그래서, 따라서, 예를 들어, 게다가, 즉, 그런데, 그럼에도 불구하고, 반면에, 왜냐하면, 또한, 한편). Also "predict": 2 questions, each quoting a sentence that ends in a connector (e.g. "…. 그러나") and asking "다음에 올 내용으로 가장 알맞은 것은?". ' + MCQ_SCHEMA_NOTE,
    ok: it => typeof it.text === 'string' && (it.text.match(/\[\[[a-z ]+:[^\]]+\]\]/g) || []).length >= 3 && isMcq(it.predict) },
  vic: { section: 'Reading strategies', name: 'Words from context', blurb: 'Work out unfamiliar words from clues around them.', render: renderVic,
    how: 'Each sentence contains a word you may not know. Guess its meaning, then name the clue that helped. Sino-Korean (한자) roots count as a clue too.',
    gen: 'A set of 5 items. Each "text" is one or two Korean sentences containing an advanced (TOPIK 5-6급) target word wrapped in {{double braces}} and the context clue phrase wrapped in [[double brackets]]. 4 Korean meaning "options", "answer" index, "clue" (exactly one of: definition, synonym, contrast, example, general sense, hanja; use at least 4 types across the set; for hanja, the clue is a familiar word sharing a Sino-Korean syllable), and "why" (English, explaining how the clue shows the meaning).',
    ok: it => Array.isArray(it.items) && it.items.length >= 3 && it.items.every(x => /\{\{.+?\}\}/.test(x.text) && isOpt(x) && CLUES.includes(x.clue)) },
  guided: { section: 'Listening strategies', name: 'Guided notes', blurb: 'Fill in an outline while the talk plays once.', render: renderGuided,
    how: 'You get the outline of the notes with gaps. Read it first, then fill each gap while the talk plays. This shows what good notes look like and trains you to listen for key words.',
    gen: 'A Korean mini-lecture of 350-450 characters by one speaker with a clear view at the end, as "lines" with exactly one entry {"s": 0 or 1, "name": "남자" or "여자", "t": "..."}. Plus "skeleton": partial notes of 7-10 lines (use \\n), starting with "주제:", following the talk, with 8-10 gaps written as [[answer|alternative|alternative]], each answer a single key Korean word (noun stem) or number the listener actually hears. Include one line starting "화자의 생각:".',
    ok: it => isLines(it.lines) && typeof it.skeleton === 'string' && (it.skeleton.match(/\[\[[^\]]+\]\]/g) || []).length >= 5 },
  segment: { section: 'Listening strategies', name: 'One note per chunk', blurb: 'Hear a talk in short pieces; note each in 8 words.', render: renderSegment,
    how: 'The talk comes in short pieces, each played once. After each piece you write its key idea in 8 words (어절) or fewer, then compare with a model note. This trains choosing what to write and what to skip.',
    gen: 'One Korean mini-lecture split into exactly 5 "segments". Each segment is {"t": 1-3 spoken Korean sentences continuing the same talk, "keys": 2-4 arrays of Korean keyword alternatives (noun stems) a good note must contain, "model": a model note of 8 어절 or fewer}. Segment 1 introduces the topic, the middle ones give an explanation, a term, and an example, and segment 5 states the speaker\'s view.',
    ok: it => Array.isArray(it.segments) && it.segments.length >= 3 && it.segments.every(g => typeof g.t === 'string' && Array.isArray(g.keys) && typeof g.model === 'string') },
  notes: { section: 'Listening strategies', name: 'Lecture notes and attitude', blurb: 'Hear a full talk once, take notes, answer from them.', render: renderNotes,
    how: 'The talk plays only once. Take notes, then answer from your notes, including the speaker\'s attitude (태도), which TOPIK asks about in questions 21–50. Listen for attitude words like 우려하다, 바람직하다, 회의적이다, 기대하다.',
    gen: 'A Korean lecture or interview answer of 450-550 characters by one speaker, as "lines" with exactly one entry {"s": 0 or 1, "name": "남자" or "여자", "t": "..."}. The speaker takes a clear attitude (우려, 비판, 기대, 신중, 강조) shown through wording, plus one defined term and one example. "attitude": 4-6 exact short phrases copied from the talk that show the attitude. "model": 6-10 lines of short Korean notes joined with \\n. 5 questions: 주제, a detail, two about the speaker\'s 태도 (options like "…을 우려하고 있다", "…에 대해 회의적이다"), and one about why the speaker mentions something. ' + MCQ_SCHEMA_NOTE,
    ok: it => isLines(it.lines) && isMcq(it.questions) && Array.isArray(it.attitude) },
  byo: { section: 'Listening strategies', name: 'Notes on your own podcast', blurb: 'Take notes on any real Korean talk, then check them.', render: renderByo, noSets: true,
    how: 'Practice with real speakers and real tone of voice. Listen once to any Korean lecture, news report, or podcast, take notes here, and summarize the main idea and attitude from your notes. With a transcript, Claude can quiz you and review your notes.' },
  build: { section: 'Writing strategies', name: 'Build a sentence', blurb: 'Put word chunks in order to write a correct sentence.', render: renderBuild,
    how: 'Tap the chunks in order to build the sentence the question asks for. One extra chunk doesn\'t belong. Tap a placed chunk to send it back.',
    gen: 'A set of 5 items. Each has "context" (a Korean question or situation), "answer" (a 4-7 어절 Korean sentence in written or polite style without final punctuation, testing intermediate grammar such as -는 바람에, -(으)ㄹ 뿐만 아니라, -기 위해서, -는 반면에, -(으)ㄹ수록, -다 보니), "end" (the final punctuation mark), "distractor" (one plausible wrong chunk not in the answer, e.g. the same word with the wrong particle or ending), optional "alts" (other fully correct orders of exactly the same chunks), and "why" (English, naming the grammar point).',
    ok: it => Array.isArray(it.items) && it.items.length >= 3 && it.items.every(x => typeof x.context === 'string' && typeof x.answer === 'string' && x.answer.split(' ').length >= 3) }
});
TASKS.ltest = { section: 'Listening', name: 'Listening practice test', blurb: 'Questions 4–50 in test order. Each recording plays once.', test: true };
TASKS.rtest = { section: 'Reading', name: 'Reading practice test', blurb: 'All 50 questions in 70 minutes, with an estimated score.', test: true };
TASKS.wtest = { section: 'Writing', name: 'Writing practice test', blurb: 'Questions 51–54 in 50 minutes, like the real test.', test: true };

// ---------- Navigation: bottom tabs, header, screens ----------
const TABS = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'listening', label: '듣기', en: 'Listening', icon: '🎧', groups: [
    { name: 'Practice test', meta: 'full section, timed', tasks: ['ltest'] },
    { name: 'Test questions', meta: 'questions 4–50', tasks: ['lnext', 'laction', 'lmatch', 'lcentral', 'lpair'] },
    { name: 'Note-taking drills', meta: 'skills practice', tasks: ['guided', 'segment', 'notes', 'byo'] }] },
  { id: 'reading', label: '읽기', en: 'Reading', icon: '📖', groups: [
    { name: 'Practice test', meta: 'full section, 70 min', tasks: ['rtest'] },
    { name: 'Test questions', meta: 'questions 1–50', tasks: ['rgram', 'rtopic', 'rmatch', 'rorder', 'rblank', 'rhead', 'rmain', 'rinsert', 'rpair'] },
    { name: 'Strategy drills', meta: 'skills practice', tasks: ['skim', 'trans', 'vic'] }] },
  { id: 'writing', label: '쓰기', en: 'Writing', icon: '✍️', groups: [
    { name: 'Practice test', meta: '51–54, 50 min', tasks: ['wtest'] },
    { name: 'Test questions', meta: 'questions 51–54', tasks: ['w51', 'w52', 'w53', 'w54'] },
    { name: 'Strategy drills', meta: 'skills practice', tasks: ['build'] }] },
  { id: 'words', label: '어휘', en: 'Words', icon: '🗂️' }
];
const SKILL_TABS = TABS.filter(t => t.groups);
const ALL_TASK_IDS = SKILL_TABS.flatMap(t => t.groups.flatMap(g => g.tasks)).filter(id => !TASKS[id].test && !TASKS[id].noSets);
const openAny = id => TASKS[id].test ? openTest(id) : openTask(id);
const tabOf = id => SKILL_TABS.find(t => t.groups.some(g => g.tasks.includes(id)));
const tabName = t => t.en ? `${t.label} ${t.en}` : t.label;
let currentTab = 'home', screen = 'tab';

const TEXT_SIZES = [0.9, 1, 1.12, 1.25, 1.4];
function applyTextSize() { document.documentElement.style.setProperty('--rs', String(SETTINGS.textScale || 1)); }
function stepText(dir) {
  const cur = SETTINGS.textScale || 1;
  let i = TEXT_SIZES.findIndex(v => Math.abs(v - cur) < 0.01); if (i < 0) i = 1;
  i = Math.max(0, Math.min(TEXT_SIZES.length - 1, i + dir));
  SETTINGS.textScale = TEXT_SIZES[i]; saveSettings(); applyTextSize();
}
applyTextSize();

function setHeader(title, back) {
  $('#hdrTitle').textContent = title;
  $('#backBtn').hidden = !back;
  document.body.classList.toggle('in-sub', !!back);
}
function paintTabbar() {
  $('#tabbar').innerHTML = `<div class="tabbar-inner" role="tablist">${TABS.map(t =>
    `<button class="tab${t.id === currentTab ? ' active' : ''}" role="tab" aria-selected="${t.id === currentTab}" data-tab="${t.id}"${t.en ? ` aria-label="${t.en}"` : ''}><span class="ic" aria-hidden="true">${t.icon}</span><span>${t.label}</span></button>`).join('')}</div>`;
  $$('#tabbar [data-tab]').forEach(b => b.addEventListener('click', () => go(() => renderTab(b.dataset.tab))));
}
// Screens below the tabs (a task, settings, progress) add one history entry,
// so Android's back button and the header arrow return to the tabs.
function enterSub() {
  screen = 'sub';
  try { if (!(history.state && history.state.topik)) history.pushState({ topik: 'sub' }, ''); } catch (e) { }
}
function goBack() {
  try { if (history.state && history.state.topik) { history.back(); return; } } catch (e) { }
  go(() => renderTab(currentTab));
}
$('#backBtn').addEventListener('click', goBack);
$('#settingsBtn').addEventListener('click', () => go(renderSettings));

function renderTab(tabId) {
  currentTab = TABS.some(t => t.id === tabId) ? tabId : 'home';
  screen = 'tab'; keepAwake(false);
  paintTabbar();
  if (currentTab === 'home') return renderHomeTab();
  if (currentTab === 'words') return renderWordsTab();
  const tab = TABS.find(t => t.id === currentTab);
  setHeader(tabName(tab), false);
  stage.innerHTML = `<h1>${tabName(tab)}</h1>` + tab.groups.map(g => `
    <section class="sec">
      <div class="sec-head"><h2>${g.name}</h2><span class="sec-meta">${g.meta}</span></div>
      ${g.tasks.map(taskRowHtml).join('')}
    </section>`).join('');
  wireTaskRows();
}
function taskRowHtml(id) {
  const t = TASKS[id];
  return `<button class="task-row" data-task="${id}">
    <span><span class="nm">${t.nums ? `<span class="qnum">Q${t.nums}</span> ` : ''}${t.name}</span><br><span class="bl">${t.blurb}</span></span>
    ${badgeFor(id)}</button>`;
}
function wireTaskRows() { $$('.task-row[data-task]').forEach(b => b.addEventListener('click', () => go(() => openAny(b.dataset.task)))); }

// ---------- Home tab ----------
function badgeFor(id) {
  const s = STATS[id];
  if (!s || !s.sets) return '<span class="badge">not started</span>';
  if (s.tot) return `<span class="badge on">${s.sets} done, ${Math.round(100 * s.pts / s.tot)}%</span>`;
  return `<span class="badge on">${s.sets} done${s.last != null ? `, last ${s.last}/${s.max || TASKS[id].max || '?'}` : ''}</span>`;
}
function suggestNext() {
  let worst = null;
  for (const id of ALL_TASK_IDS) {
    const s = STATS[id]; if (!s || !s.tot) continue;
    const p = s.pts / s.tot; if (p < 0.8 && (!worst || p < worst.p)) worst = { id, p };
  }
  if (worst) return { id: worst.id, why: `Your average here is ${Math.round(worst.p * 100)}%, your lowest score.` };
  const fresh = ALL_TASK_IDS.find(id => !STATS[id] || !STATS[id].sets);
  if (fresh) return { id: fresh, why: "You haven't tried this one yet." };
  let low = null;
  for (const id of ALL_TASK_IDS) { const s = STATS[id]; if (s && s.last != null && s.max && s.last / s.max < 0.7 && (!low || s.last / s.max < low.v)) low = { id, v: s.last / s.max, txt: `${s.last}/${s.max}` }; }
  if (low) return { id: low.id, why: `Your last score was ${low.txt}.` };
  const id = ALL_TASK_IDS[Math.floor(Math.random() * ALL_TASK_IDS.length)];
  return { id, why: 'Everything looks strong. Keep this skill fresh.' };
}
function skillAverage(tab) {
  let pts = 0, tot = 0, sets = 0;
  tab.groups.forEach(g => g.tasks.forEach(id => { const s = STATS[id]; if (!s) return; sets += s.sets || 0; pts += s.pts || 0; tot += s.tot || 0; if (!s.tot && s.last != null && s.max) { pts += s.last / s.max; tot += 1; } }));
  return { pct: tot ? Math.round(100 * pts / tot) : null, sets };
}
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
function dailyCardHtml() {
  const st = streak(), due = dueWords(WORDS_ALL()).length, dm = dueMistakes().length;
  const live = DAILY && !DAILY.finished, doneToday = DAILY && DAILY.finished;
  return `<button class="home-card primary" id="dailyBtn">
      <span class="hc-kicker">Daily 15${st ? ` · 🔥 ${st}-day streak` : ''}</span>
      <span class="hc-title">${live ? `Continue: step ${DAILY.i + 1} of ${DAILY.steps.length}` : doneToday ? 'Done for today ✓ · Start another mix' : 'Start today\'s 15-minute mix'}</span>
      <span class="hc-sub">Words, mistakes, reading, listening, and writing, picked from your weakest areas.</span></button>
    ${dm ? `<button class="home-card" id="mistakesDue"><span class="hc-kicker">Mistake review</span><span class="hc-title">${dm} missed question${dm > 1 ? 's' : ''} to review</span><span class="hc-sub">Questions you got wrong come back after 1, 3, and 7 days.</span></button>` : ''}
    ${due ? `<button class="home-card" id="wordsDue"><span class="hc-kicker">어휘 Words</span><span class="hc-title">${due} card${due > 1 ? 's' : ''} due for review</span><span class="hc-sub">TOPIK II vocabulary and grammar</span></button>` : ''}`;
}
function renderHomeTab() {
  setHeader('TOPIK II', false);
  const last = store.get('topik2-last', null);
  const sug = suggestNext();
  const lastOk = last && TASKS[last.id] && pool(last.id).length;
  const goal = SETTINGS.goal || 0;
  stage.innerHTML = `
    ${IS_ANDROID && !isStandalone() && !store.get('topik2-android-tip', 0) ? `<div class="notice info" id="androidTip" style="margin:0 0 18px; display:flex; gap:10px; align-items:flex-start;"><span><b>Install it as an app:</b> in Chrome, tap ⋮, then <b>Install app</b>. It then works offline.</span><button class="icon-btn" id="androidTipX" style="color:var(--pine); border-color:var(--pine); flex-shrink:0;" aria-label="Dismiss tip">✕</button></div>` : ''}
    <h1>TOPIK II practice <span lang="ko" class="h-ko">한국어능력시험</span></h1>
    <p class="sub">Every question type on the TOPIK II paper test (듣기, 읽기, 쓰기), plus strategy drills.${goal ? ` Your goal: <b>${goal}급</b> (${LEVELS.find(l => l.lv === goal).min}+ of 300).` : ''}</p>
    ${dailyCardHtml()}
    ${lastOk ? `<button class="home-card" id="contBtn">
      <span class="hc-kicker">Continue</span>
      <span class="hc-title">${esc(TASKS[last.id].name)}</span>
      <span class="hc-sub">${esc(tabName(tabOf(last.id)))}, set ${(last.idx || 0) + 1}</span></button>` : ''}
    <button class="home-card" id="sugBtn">
      <span class="hc-kicker">Suggested next</span>
      <span class="hc-title">${esc(TASKS[sug.id].name)}</span>
      <span class="hc-sub">${esc(sug.why)}</span></button>
    ${levelCardHtml()}
    <section class="sec">
      <div class="sec-head"><h2>Your skills</h2><button class="btn ghost small" id="progBtn">📈 Progress</button></div>
      ${SKILL_TABS.map(t => { const a = skillAverage(t); return `
        <button class="skill-row" data-goto="${t.id}">
          <span class="sk-name">${t.icon} ${tabName(t)}</span>
          <span class="sk-bar" aria-hidden="true"><i style="width:${a.pct ?? 0}%"></i></span>
          <span class="sk-val">${a.pct != null ? a.pct + '%' : (a.sets ? a.sets + ' done' : '—')}</span>
        </button>`; }).join('')}
    </section>`;
  if (lastOk) $('#contBtn').addEventListener('click', () => go(() => openTask(last.id, last.idx)));
  $('#dailyBtn').addEventListener('click', () => go(() => (DAILY && !DAILY.finished) ? runDailyStep() : startDaily()));
  const wb = $('#wordsDue'); if (wb) wb.addEventListener('click', () => go(() => renderTab('words')));
  const mb = $('#mistakesDue'); if (mb) mb.addEventListener('click', () => go(() => runMistakes(shuffle(dueMistakes()).slice(0, 10))));
  $('#sugBtn').addEventListener('click', () => go(() => openTask(sug.id)));
  $('#progBtn').addEventListener('click', () => go(renderProgress));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => go(() => renderTab(b.dataset.goto))));
  const tipX = $('#androidTipX'); if (tipX) tipX.addEventListener('click', () => { store.set('topik2-android-tip', 1); $('#androidTip').remove(); });
}
// Estimated TOPIK level from your latest practice test in each section.
// Missing sections are filled with the average of the ones you've taken.
const LEVELS = [{ lv: 6, min: 230 }, { lv: 5, min: 190 }, { lv: 4, min: 150 }, { lv: 3, min: 120 }];
const levelOf = total => (LEVELS.find(l => total >= l.min) || { lv: 0 }).lv;
function sectionScores() {
  const lastOf = id => { const h = HIST[id] || []; return h.length ? Math.round(h[h.length - 1].v * 100) : null; };
  return { listening: lastOf('ltest'), reading: lastOf('rtest'), writing: lastOf('wtest') };
}
function levelCardHtml() {
  const sc = sectionScores(), have = Object.values(sc).filter(v => v != null);
  if (!have.length) return '';
  const avg = have.reduce((a, b) => a + b, 0) / have.length;
  const total = Math.round(['listening', 'reading', 'writing'].reduce((n, k) => n + (sc[k] ?? avg), 0));
  const lv = levelOf(total);
  return `<div class="home-card level-card">
    <span class="hc-kicker">Estimated level from your practice tests</span>
    <span class="hc-title">${lv ? `${lv}급` : 'Below 3급'} · about ${total} / 300</span>
    <span class="hc-sub">듣기 ${sc.listening ?? '—'} · 읽기 ${sc.reading ?? '—'} · 쓰기 ${sc.writing ?? '—'}${have.length < 3 ? ' (sections you haven\'t tested are estimated from the others)' : ''}. A rough guide, not an official score.</span></div>`;
}

// ---------- Progress screen ----------
function sparkline(vals) {
  if (!vals.length) return '';
  const w = 120, h = 32, n = vals.length;
  const pts = vals.map((v, i) => [n === 1 ? w / 2 : (i * (w - 6)) / (n - 1) + 3, h - 3 - v * (h - 6)]);
  const d = pts.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="0" y1="${(h - 3 - 0.8 * (h - 6)).toFixed(1)}" x2="${w}" y2="${(h - 3 - 0.8 * (h - 6)).toFixed(1)}" class="spark-goal"/><polyline points="${d}" class="spark-line"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" class="spark-dot"/></svg>`;
}
function renderProgress() {
  enterSub(); setHeader('Progress', true);
  const now = Date.now(), week = 7 * 864e5;
  const all = Object.values(HIST).flat();
  const thisWeek = all.filter(e => now - e.t < week).length;
  const days = new Set(all.filter(e => now - e.t < 30 * 864e5).map(e => new Date(e.t).toDateString())).size;
  stage.innerHTML = `
    <h1>Your progress</h1>
    <div class="stat-row">
      <div class="stat"><b>${thisWeek}</b><span>sets this week</span></div>
      <div class="stat"><b>${days}</b><span>days practiced in the last 30</span></div>
    </div>
    ${levelCardHtml()}
    ${(() => { const all = Object.keys(MISTAKES).length, d = dueMistakes().length; return all ? `<div class="notice info" style="margin:0 0 12px; display:flex; justify-content:space-between; align-items:center; gap:10px;"><span>${all} question${all > 1 ? 's' : ''} in mistake review${d ? `, ${d} due now` : ''}.</span>${d ? '<button class="btn small" id="progMist">Review</button>' : ''}</div>` : ''; })()}
    ${(() => { const lb = store.get('topik2-lastbackup', null); const studied = store.get('topik2-days', []).length; return studied >= 3 && (!lb || (Date.now() - new Date(lb).getTime()) > 30 * 864e5) ? '<p class="hint">💾 Tip: save a backup of your progress in Settings.</p>' : ''; })()}
    <p class="hint">Each line shows your last 12 scores for a task. The dotted line marks 80%.</p>
    ${SKILL_TABS.map(t => `
      <section class="sec"><div class="sec-head"><h2>${tabName(t)}</h2></div>
      ${t.groups.flatMap(g => g.tasks).filter(id => !TASKS[id].noSets).map(id => {
        const h = (HIST[id] || []).slice(-12);
        const vals = h.map(e => e.v);
        const lastV = vals.length ? Math.round(vals[vals.length - 1] * 100) : null;
        const trend = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
        return `<button class="prog-row" data-task="${id}">
          <span class="pr-name">${TASKS[id].name}<br><span class="hint">${vals.length ? `${vals.length} recent score${vals.length > 1 ? 's' : ''}` : 'No scores yet'}</span></span>
          ${vals.length ? sparkline(vals) : '<span class="spark-empty"></span>'}
          <span class="pr-val">${lastV != null ? lastV + '%' : '—'}${vals.length >= 2 ? `<span class="${trend >= 0 ? 'up' : 'down'}">${trend >= 0.005 ? ' ↑' : trend <= -0.005 ? ' ↓' : ''}</span>` : ''}</span>
        </button>`;
      }).join('')}</section>`).join('')}`;
  $$('.prog-row[data-task]').forEach(b => b.addEventListener('click', () => go(() => openAny(b.dataset.task))));
  const pm = $('#progMist'); if (pm) pm.addEventListener('click', () => go(() => runMistakes(shuffle(dueMistakes()).slice(0, 10))));
}

// ---------- Settings screen ----------
function renderSettings() {
  enterSub(); setHeader('Settings', true);
  stage.innerHTML = `
    <h1>Settings</h1>
    <div class="set-grid">
      <div><span class="lbl">Your target level</span>
        <div class="seg" id="goalSeg">${[0, 3, 4, 5, 6].map(v => `<button data-goal="${v}" class="${(SETTINGS.goal || 0) === v ? 'active' : ''}">${v ? v + '급' : 'Not set'}</button>`).join('')}</div>
        <p class="hint" style="margin:6px 0 0;">Total of 300 needed: 3급 120, 4급 150, 5급 190, 6급 230.</p></div>
      <div><span class="lbl">Text size for passages and questions</span>
        <div class="seg" id="sizeSeg">${TEXT_SIZES.map((v, i) => `<button data-size="${v}" class="${Math.abs((SETTINGS.textScale || 1) - v) < 0.01 ? 'active' : ''}" style="font-size:${12 + i * 1.5}px">가</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="enBox" ${SETTINGS.english !== false ? 'checked' : ''}><span>Explain answers and give Claude's feedback in English. Turn off for feedback in Korean (한국어로 피드백 받기).</span></label>
      <div><span class="lbl">Speaking speed of the audio</span>
        <div class="seg" id="rateSeg">
          ${[[0.8, 'Slower'], [1, 'Test pace'], [1.15, 'Faster']].map(([v, l]) => `<button data-rate="${v}" class="${SETTINGS.rate == v ? 'active' : ''}">${l}</button>`).join('')}
        </div></div>
      <div><span class="lbl">Recorded voices</span>
        <label class="check"><input type="checkbox" id="studioBox" ${SETTINGS.studio !== false ? 'checked' : ''}><span>Use recorded voices when available. New sets from Claude use your phone's voices.</span></label>
        <p class="hint" id="studioStatus" style="margin:6px 0 0;">${studioStatus()}</p>
        <div class="row" style="margin-top:8px;"><button class="btn ghost small" id="saveAudioBtn">Save all audio for offline use</button></div>
        <p class="hint" id="saveAudioOut" style="margin:6px 0 0;"></p>
      </div>
      <div><span class="lbl">Phone voices (used when there's no recording)</span>
        <div class="voice-grid">
          <span>남자 (man)</span><select id="vA" aria-label="Voice for the man"></select><button class="btn ghost small" data-prev="0" aria-label="Preview the man's voice">▶</button>
          <span>여자 (woman)</span><select id="vB" aria-label="Voice for the woman"></select><button class="btn ghost small" data-prev="1" aria-label="Preview the woman's voice">▶</button>
        </div>
        <p class="hint" id="voiceTip" style="margin:8px 0 0;"></p>
        <div class="row" style="margin-top:8px;"><button class="btn ghost small" id="voiceTest">🔊 Hear a sample conversation</button></div>
      </div>
      <label class="check"><input type="checkbox" id="examBox" ${SETTINGS.exam ? 'checked' : ''}><span>Exam mode: each listening recording plays only once.</span></label>
      <label class="check"><input type="checkbox" id="hapBox" ${SETTINGS.haptics !== false ? 'checked' : ''}><span>Vibrate briefly when answers are checked.</span></label>
      <div><span class="lbl">Claude features (optional)</span>
        <p class="hint" style="margin:0 0 8px;">New practice sets and in-app scoring for writing and notes need your own Anthropic API key (from console.anthropic.com). It's saved only on this device and sent only to Anthropic. Usage is billed to your Anthropic account. Without a key, use the "Score in Claude ↗" buttons, which open claude.ai with your subscription.</p>
        <input id="apiKeyIn" class="field-in" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(SETTINGS.apiKey || '')}">
        <div class="row" style="margin-top:8px;"><input id="modelIn" class="field-in" style="flex:1; min-width:0;" autocomplete="off" spellcheck="false" value="${esc(SETTINGS.model || DEFAULT_MODEL)}" aria-label="Claude model name"><button class="btn small" id="saveKeyBtn">Save</button></div>
        <p class="hint" id="keyOut" style="margin:6px 0 0;">${sample ? 'Claude features are on.' : 'Claude features are off.'}</p>
      </div>
      <div><span class="lbl">Backup and restore</span>
        <p class="hint" style="margin:0 0 8px;">Your progress is stored only on this device. Save a backup file before changing phones or clearing browser data. Your API key is never included. Last backup: ${store.get('topik2-lastbackup', null) || 'never'}.</p>
        <div class="row"><button class="btn small" id="exportBtn">⬇ Save backup</button><button class="btn ghost small" id="importBtn">⬆ Restore from file</button><input type="file" id="importFile" accept="application/json,.json" hidden></div>
        <p class="hint" id="backupOut" style="margin:6px 0 0;"></p>
      </div>
      <div class="row"><button class="btn ghost small" id="welcomeBtn">Show the welcome guide</button><button class="btn ghost small" id="resetBtn">Clear my progress</button></div>
    </div>`;
  $('#goalSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SETTINGS.goal = +b.dataset.goal; saveSettings(); $$('#goalSeg button').forEach(x => x.classList.toggle('active', x === b)); });
  $('#sizeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SETTINGS.textScale = +b.dataset.size; saveSettings(); applyTextSize(); $$('#sizeSeg button').forEach(x => x.classList.toggle('active', x === b)); });
  $('#enBox').addEventListener('change', e => { SETTINGS.english = e.target.checked; saveSettings(); });
  $('#rateSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SETTINGS.rate = +b.dataset.rate; saveSettings(); $$('#rateSeg button').forEach(x => x.classList.toggle('active', x === b)); });
  $('#examBox').addEventListener('change', e => { SETTINGS.exam = e.target.checked; saveSettings(); });
  $('#hapBox').addEventListener('change', e => { SETTINGS.haptics = e.target.checked; saveSettings(); });
  $('#studioBox').addEventListener('change', e => { SETTINGS.studio = e.target.checked; saveSettings(); });
  $('#saveAudioBtn').addEventListener('click', e => saveAllAudio(e.target, $('#saveAudioOut')));
  $('#saveKeyBtn').addEventListener('click', () => {
    SETTINGS.apiKey = $('#apiKeyIn').value.trim(); SETTINGS.model = $('#modelIn').value.trim() || DEFAULT_MODEL; saveSettings(); refreshAI();
    $('#keyOut').textContent = sample ? 'Saved. Claude features are on.' : 'Key removed. Claude features are off.';
  });
  fillVoiceSelects();
  [['vA', 'voiceA'], ['vB', 'voiceB']].forEach(([el, key]) => $('#' + el).addEventListener('change', e => { SETTINGS[key] = e.target.value; saveSettings(); }));
  $$('[data-prev]').forEach(b => b.addEventListener('click', () => {
    const s = +b.dataset.prev;
    speakTTS([{ s, t: s === 0 ? '안녕하세요. 오늘 무엇을 도와 드릴까요?' : '다음 주 발표 자료에 대해 여쭤보고 싶은 게 있어서요.' }]);
  }));
  $('#voiceTest').addEventListener('click', () => speakTTS([
    { s: 1, t: '교수님, 잠깐 시간 괜찮으세요? 과제에 대해 질문이 있어서요.' },
    { s: 0, t: '네, 들어오세요. 무슨 질문인데요?' },
    { s: 1, t: '보고서에 제 의견도 써야 하는지 궁금해서요.' },
    { s: 0, t: '좋은 질문이네요. 요약은 객관적으로 쓰고, 의견은 마지막 단락에 따로 쓰세요.' }]));
  $('#welcomeBtn').addEventListener('click', () => showWelcome());
  $('#exportBtn').addEventListener('click', () => exportBackup($('#backupOut')));
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importBackup(f, $('#backupOut')); e.target.value = ''; });
  $('#resetBtn').addEventListener('click', e => {
    if (!e.target.dataset.armed) { e.target.dataset.armed = '1'; e.target.textContent = 'Tap again to clear all scores'; return; }
    STATS = {}; CURSOR = {}; HIST = {}; MISTAKES = {}; saveMistakes(); TEST_USED = {}; store.set('topik2-testused', {}); SRS = {}; DAILY = null; saveSRS(); saveDaily(); store.set('topik2-days', []);
    store.set('topik2-stats', STATS); store.set('topik2-cursor', CURSOR); store.set('topik2-hist', HIST); store.set('topik2-last', null);
    e.target.textContent = 'Progress cleared'; e.target.disabled = true;
  });
}

// ---------- Welcome guide (first launch) ----------
function showWelcome() {
  let step = 0;
  const ua = navigator.userAgent;
  const installText = isStandalone()
    ? "You're already using the installed app. Nice."
    : /iPhone|iPad|iPod/.test(ua)
      ? 'In Safari, tap the Share button, then <b>Add to Home Screen</b>.'
      : 'In Chrome, tap <b>⋮</b> in the top corner, then <b>Install app</b> (or <b>Add to Home screen</b>). The app then opens like any other app and works offline.';
  const slides = [
    { title: 'Practice the whole TOPIK II', body: `<p>Use the tabs at the bottom: <b>듣기</b> (Listening), <b>읽기</b> (Reading), and <b>쓰기</b> (Writing). Each has every question type from the paper test, a timed practice test, and strategy drills. <b>어휘</b> has TOPIK vocabulary and grammar with spaced review.</p><p>Short on time? Tap <b>Daily 15</b> on Home for a 15-minute mix of everything.</p>
      <div><span class="lbl">Your target level (optional)</span><div class="seg" id="wGoal">${[3, 4, 5, 6].map(v => `<button data-goal="${v}" class="${SETTINGS.goal === v ? 'active' : ''}">${v}급</button>`).join('')}</div></div>` },
    { title: 'Install it on your phone', body: `<p>${installText}</p>` },
    { title: 'Save the audio for offline use', body: `<p>Listening questions use recorded Korean voices. Save them once on Wi-Fi so they play without internet.</p>
      <div class="row"><button class="btn ghost" id="wSave">Save audio now</button></div><p class="hint" id="wSaveOut"></p>
      <p class="hint">You can do this later in Settings (⚙️). If no recordings are available, your phone's Korean voice is used.</p>` }
  ];
  const ov = document.createElement('div'); ov.className = 'welcome'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Welcome guide');
  document.body.appendChild(ov); document.body.classList.add('sheet-open');
  const close = () => { store.set('topik2-welcomed', 1); ov.remove(); document.body.classList.remove('sheet-open'); if (screen === 'tab') renderTab(currentTab); };
  const paint = () => {
    const s = slides[step], lastStep = step === slides.length - 1;
    ov.innerHTML = `<div class="welcome-card">
      <div class="w-top"><span class="w-dots">${slides.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</span><button class="btn ghost small" data-w="skip">Skip</button></div>
      <h2 class="w-title">${s.title}</h2>
      <div class="w-body">${s.body}</div>
      <div class="w-nav">${step ? '<button class="btn ghost" data-w="prev">Back</button>' : '<span></span>'}<button class="btn" data-w="next">${lastStep ? 'Start practicing' : 'Next'}</button></div>
    </div>`;
    $('[data-w=skip]', ov).addEventListener('click', close);
    $('[data-w=next]', ov).addEventListener('click', () => { if (lastStep) close(); else { step++; paint(); } });
    const pv = $('[data-w=prev]', ov); if (pv) pv.addEventListener('click', () => { step--; paint(); });
    const g = $('#wGoal', ov); if (g) g.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SETTINGS.goal = +b.dataset.goal; saveSettings(); $$('#wGoal button', ov).forEach(x => x.classList.toggle('active', x === b)); });
    const ws = $('#wSave', ov); if (ws) ws.addEventListener('click', e => saveAllAudio(e.target, $('#wSaveOut', ov)));
    $('[data-w=next]', ov).focus();
  };
  paint();
}

// ---------- Task shell ----------
let current = { id: null, idx: 0 };
function openTask(id, idx, opts = {}) {
  enterSub();
  const t = TASKS[id], list = t.noSets ? [{}] : pool(id);
  if (idx == null) idx = (CURSOR[id] || 0) % list.length;
  idx = Math.min(idx, list.length - 1);
  const daily = !!(opts.daily && DAILY);
  current = { id, idx, daily };
  CURSOR[id] = idx; store.set('topik2-cursor', CURSOR);
  if (!t.noSets) store.set('topik2-last', { id, idx });
  const tab = tabOf(id);
  if (tab) { currentTab = tab.id; paintTabbar(); }
  if (/Listening/.test(t.section)) keepAwake(true);
  setHeader(daily ? dailyTitle() : t.name, true);
  const audioTask = /Listening/.test(t.section) || id === 'build';
  stage.innerHTML = `
    <div class="task-head">
      <span class="sec-meta">${esc(tab ? tabName(tab) : t.section)}${t.nums ? ` · question${t.nums.length > 2 ? 's' : ''} ${t.nums}` : ''}</span>
      <span class="row" style="gap:6px;">
        <button class="btn ghost small" data-act="smaller" aria-label="Smaller text">가−</button>
        <button class="btn ghost small" data-act="bigger" aria-label="Larger text">가+</button>
        ${audioTask ? '<button class="btn ghost small" data-act="voices" aria-label="Audio settings">🔊</button>' : ''}
      </span>
    </div>
    <h1>${t.name}</h1>
    ${t.ko ? `<p class="topik-ko" lang="ko">${t.ko}</p>` : ''}
    <p class="task-how">${t.how}</p>
    ${t.tip ? `<details class="strat"><summary>Strategy</summary><div>${t.tip}</div></details>` : ''}
    ${daily ? `<div class="set-bar"><span class="ttl"><span>Daily 15 · ${esc(DAILY.steps[DAILY.i].label)}</span>${esc(list[idx].title || '')}</span></div>` : t.noSets ? '' : `<div class="set-bar">
      <span class="ttl"><span>Set ${idx + 1} of ${list.length}</span>${esc(list[idx].title || '')}</span>
      <span class="row" style="gap:6px;">
        <button class="btn ghost small" data-act="prev" ${idx === 0 ? 'disabled' : ''} aria-label="Previous set">◀ Previous</button>
        <button class="btn ghost small" data-act="next">Next set ▶</button>
        <button class="btn ghost small ai-only" data-act="gen">✨ New set from Claude</button>
      </span>
    </div>`}
    <div id="genNote"></div>
    <div id="body"></div>`;
  $('[data-act=smaller]').addEventListener('click', () => stepText(-1));
  $('[data-act=bigger]').addEventListener('click', () => stepText(1));
  const vb = $('[data-act=voices]'); if (vb) vb.addEventListener('click', () => go(renderSettings));
  if (!t.noSets && !daily) {
    $('[data-act=next]').addEventListener('click', () => go(() => openTask(id, (idx + 1) % pool(id).length)));
    $('[data-act=prev]').addEventListener('click', () => { if (idx > 0) go(() => openTask(id, idx - 1)); });
    $('[data-act=gen]').addEventListener('click', () => generateSet(id));
  }
  t.render(list[idx], $('#body'), id);
}

async function generateSet(id) {
  const t = TASKS[id], note = $('#genNote'), btn = $('[data-act=gen]');
  if (!sample) return;
  const example = DATA[id][0];
  const exampleClean = Object.assign({}, example); delete exampleClean.model;
  const used = pool(id).map(x => x.title).filter(Boolean).join('; ');
  const wantsModel = 'model' in example;
  const prompt = `Create ONE new, original practice item for the TOPIK II (Test of Proficiency in Korean, levels 3-6) task "${t.name}"${t.nums ? ` (questions ${t.nums})` : ''}.
Requirements: ${t.gen}
Include a short English "title" naming the topic.${wantsModel ? ' Include the "model" field as described.' : ''}
Write natural, accurate standard Korean at TOPIK II level, matching the style of real TOPIK questions. Facts must be true. Make sure every answer key is unambiguously correct and every distractor is clearly wrong.
Match the JSON structure of this example exactly (same keys and value types), but with a completely different topic and new wording:
${JSON.stringify(exampleClean)}
Do not reuse these topics: ${used}.
Reply with only the JSON object.`;
  btn.disabled = true;
  note.innerHTML = '<p class="thinking">Claude is writing a new set. This can take up to a minute…</p>';
  const ctl = new AbortController(); onLeave(() => ctl.abort());
  try {
    const item = await sample.json(prompt, { signal: ctl.signal });
    if (!item || typeof item !== 'object' || !t.ok(item)) throw { code: 'invalid_json' };
    if (!item.title) item.title = 'New set';
    (EXTRA[id] = EXTRA[id] || []).push(item); store.set('topik2-extra', EXTRA);
    go(() => openTask(id, pool(id).length - 1));
  } catch (e) {
    btn.disabled = false;
    const msg = aiErrorText(e);
    note.innerHTML = msg ? `<div class="notice err">${esc(msg)}</div>` : '';
  }
}

// ---------- Shared MCQ ----------
// Options are numbered ①–④ like the TOPIK answer sheet.
const CIRCLED = ['①', '②', '③', '④', '⑤'];
// Inline marks used in content: [[underlined]] text and (    ) blanks.
const fmtInline = s => esc(s).replace(/\[\[(.+?)\]\]/g, '<u>$1</u>').replace(/\(\s{2,}\)/g, '<span class="blank">(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</span>');
function mcqHtml(qs, pfx, startNum = 1) {
  return qs.map((q, i) => `
    <fieldset class="q" data-qi="${i}">
      <legend>${startNum + i}. ${q.qHtml || fmtInline(q.q)}</legend>
      ${q.options.map((o, j) => `<label class="opt"><input type="radio" name="${pfx}-${i}" value="${j}"><span><span class="cn">${CIRCLED[j]}</span> ${esc(o)}</span></label>`).join('')}
    </fieldset>`).join('');
}
// track (optional): { task, item, qi(i) } records results for mistake review
// and adds an "Ask Claude why" button to missed questions.
function gradeMcq(qs, pfx, root, track) {
  let right = 0;
  qs.forEach((q, i) => {
    const chosen = $(`input[name="${pfx}-${i}"]:checked`, root);
    const labels = $$(`input[name="${pfx}-${i}"]`, root).map(x => x.closest('label'));
    labels.forEach((l, j) => { $('input', l).disabled = true; if (j === q.answer) l.classList.add('right'); });
    let ok = false;
    if (chosen) { const v = +chosen.value; if (v === q.answer) { right++; ok = true; } else labels[v].classList.add('wrong'); }
    const fs = labels.length ? labels[0].closest('fieldset') : null;
    if (q.why && fs && !fs.querySelector('.why')) fs.insertAdjacentHTML('beforeend', `<div class="why">${esc(q.why)}</div>`);
    if (track) {
      const qi = track.qi ? track.qi(i) : i;
      noteResult(track.task, track.item, qi, ok);
      if (!ok && fs && !fs.querySelector('[data-ask]')) {
        const rq = reviewQuestion(track.task, track.item, qi) || q;
        fs.insertAdjacentHTML('beforeend', `<div class="row ask-row">${askBtnHtml(explainPrompt(track.task, track.item, rq, chosen ? q.options[+chosen.value] : '', qi), 'Ask Claude why ↗', 'btn ghost small')}</div>`);
      }
    }
  });
  return right;
}
function stampHtml(right, total) {
  const p = total ? right / total : 0;
  const cls = p >= 0.8 ? 'good' : p >= 0.5 ? 'mid' : 'low';
  return `<div class="stamp ${cls}">${right} / ${total}</div>`;
}
// The Check button stays pinned to the bottom of the screen on phones, so
// you never have to scroll hunting for it after the last question.
function checkRow(label = 'Check answers', extra = '') {
  return `<div class="check-bar"><span class="answered" data-answered></span>${extra}<button class="btn" data-check>${label}</button></div><div class="result" data-result></div>`;
}
document.addEventListener('change', e => {
  if (!e.target.matches('input[type=radio]')) return;
  const body = e.target.closest('#body'); if (!body) return;
  const out = $('[data-answered]', body); if (!out) return;
  const groups = new Set($$('fieldset.q input[type=radio]', body).map(x => x.name));
  const done = [...groups].filter(n => $(`input[name="${n}"]:checked`, body)).length;
  out.textContent = groups.size ? `${done}/${groups.size} done` : '';
});
function openSheet(title, html) {
  closeSheet();
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
  sh.innerHTML = `<div class="sheet-head"><b>${esc(title)}</b><button class="btn small" data-sheet-close>Close</button></div><div class="sheet-body">${html}</div>`;
  document.body.appendChild(sh); document.body.classList.add('sheet-open');
  $('[data-sheet-close]', sh).addEventListener('click', closeSheet);
  $('[data-sheet-close]', sh).focus();
}
function closeSheet() { const sh = $('.sheet'); if (!sh) return false; sh.remove(); document.body.classList.remove('sheet-open'); return true; }
function afterCheck(body, id, extraHtml = '') {
  const res = $('[data-result]', body);
  if (current.daily && DAILY && DAILY.steps[DAILY.i] && DAILY.steps[DAILY.i].id === id) {
    if (!DAILY.results[DAILY.i]) dailyResult(0, 0);
    res.insertAdjacentHTML('beforeend', `${extraHtml}<div class="row" style="justify-content:center; margin-top:16px;"><button class="btn" data-nextset>${dailyNextLabel()}</button></div>`);
    $('[data-nextset]', body).addEventListener('click', dailyNext);
    return;
  }
  res.insertAdjacentHTML('beforeend', `${extraHtml}<div class="row" style="justify-content:center; margin-top:16px;"><button class="btn" data-nextset>Next set ▶</button></div>`);
  $('[data-nextset]', body).addEventListener('click', () => go(() => openTask(id, (current.idx + 1) % pool(id).length)));
}

// ---------- Question sets made of short items (questions 1-18, 25-41) ----------
const LISTEN_ITEMS = ['lnext', 'laction', 'lmatch', 'lcentral'];
const DEFAULT_Q = {
  lnext: '이어질 수 있는 말로 가장 알맞은 것은?',
  laction: '여자가 이어서 할 행동으로 가장 알맞은 것은?',
  lmatch: '들은 내용과 같은 것은?',
  lcentral: '남자의 중심 생각으로 가장 알맞은 것은?',
  rtopic: '무엇에 대한 글입니까?',
  rmatch: '글의 내용과 같은 것은?',
  rorder: '순서대로 맞게 배열한 것은?',
  rblank: '(    )에 들어갈 내용으로 가장 알맞은 것은?',
  rhead: '제목을 가장 잘 설명한 것은?',
  rmain: '글의 주제로 가장 알맞은 것은?',
  rinsert: '주어진 문장이 들어갈 곳으로 가장 알맞은 것은?'
};
const textHtml = s => fmtInline(s).replace(/\n/g, '<br>');
// The question as asked: for grammar items the sentence itself is the question.
function itemQuestion(task, x) {
  if (task === 'rgram') return { q: x.q, qHtml: `<span class="qtype">${x.type === 'similar' ? '밑줄 친 부분과 의미가 비슷한 것' : '빈칸에 알맞은 것'}</span><br>${fmtInline(x.q)}`, options: x.options, answer: x.answer, why: x.why };
  return { q: x.q || DEFAULT_Q[task] || '알맞은 것을 고르십시오.', options: x.options, answer: x.answer, why: x.why };
}
// What sits above an item's question: a player, a text, a headline, or sentences.
function itemCtxHtml(task, x, i, pfx) {
  if (LISTEN_ITEMS.includes(task)) return `<div class="player compact" id="${pfx}p${i}"></div>`;
  if (task === 'rgram') return '';
  if (task === 'rhead') return `<div class="headline" lang="ko">${esc(x.text)}</div>`;
  if (task === 'rorder') return `<div class="doc">${x.sents.map(s => `<div class="sent">${esc(s)}</div>`).join('')}</div>`;
  if (task === 'rinsert') return `<div class="given"><span class="kind">주어진 문장</span>${esc(x.given)}</div><div class="doc">${textHtml(x.text)}</div>`;
  if (task === 'rtopic') return `<div class="doc ad">${textHtml(x.text)}</div>`;
  return `<div class="doc">${x.kind ? `<span class="kind">${esc(x.kind)}</span>` : ''}${textHtml(x.text)}</div>`;
}
function mountItemPlayers(task, items, root, pfx, opts = {}) {
  if (!LISTEN_ITEMS.includes(task)) return;
  items.forEach((x, i) => mountPlayer($('#' + pfx + 'p' + i, root), x.lines, Object.assign({ label: `▶ Play ${(opts.start || 1) + i}` }, opts.player || {}, opts.onEnd ? { onFirstEnd: () => opts.onEnd(i) } : {})));
}
function transcriptHtml(lines, open = false) {
  return `<details class="transcript"${open ? ' open' : ''}><summary>Transcript</summary>${lines.map(l => `<p>${lines.length > 1 || l.name ? `<b>${esc(l.name || 'Speaker')}:</b> ` : ''}${esc(l.t)}</p>`).join('')}</details>`;
}
function renderItems(item, body, id) {
  body.innerHTML = item.items.map((x, i) => `
    <div class="resp-item" data-ri="${i}">
      ${itemCtxHtml(id, x, i, 'it')}
      ${mcqHtml([itemQuestion(id, x)], 'it' + i, i + 1)}
      <div class="after-item"></div>
    </div>`).join('') + checkRow();
  mountItemPlayers(id, item.items, body, 'it');
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; let r = 0;
    item.items.forEach((x, i) => {
      const wrap = $(`[data-ri="${i}"]`, body);
      r += gradeMcq([itemQuestion(id, x)], 'it' + i, wrap, { task: id, item, qi: () => i });
      if (x.lines) $('.after-item', wrap).innerHTML = transcriptHtml(x.lines);
    });
    record(id, r, item.items.length); $('[data-result]', body).innerHTML = stampHtml(r, item.items.length); afterCheck(body, id);
  });
}

// ---------- One recording, two questions (listening 21-50) ----------
// The real booklet prints the questions, so they're visible before you play.
function renderPair(item, body, id) {
  body.innerHTML = `${item.kind ? `<div class="kind-tag">${esc(item.kind)}</div>` : ''}<div class="player" id="pl"></div>
    ${mcqHtml(item.questions, 'lp')}${checkRow()}`;
  mountPlayer($('#pl', body), item.lines);
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; const r = gradeMcq(item.questions, 'lp', body, { task: id, item });
    record(id, r, item.questions.length); $('[data-result]', body).innerHTML = stampHtml(r, item.questions.length);
    afterCheck(body, id, `<div style="text-align:left;">${transcriptHtml(item.lines, true)}</div>`);
  });
}
// ---------- Longer reading passages (19-24, 42-50) ----------
const passageHtml = item => `${item.kind ? `<span class="kind">${esc(item.kind)}</span>` : ''}${item.text.split(/\n+/).map(p => `<p>${fmtInline(p)}</p>`).join('')}`;
function renderLong(item, body, id) {
  useWide(true);
  body.innerHTML = `<div class="split"><div class="split-left"><div class="passage" tabindex="0" aria-label="Reading passage">${passageHtml(item)}</div></div>
    <div class="split-right">${mcqHtml(item.questions, 'rl')}${checkRow('Check answers', '<button class="btn ghost" data-sheet>📄 Passage</button>')}</div></div>`;
  $('[data-sheet]', body).addEventListener('click', () => openSheet(item.title || 'Passage', passageHtml(item)));
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; const r = gradeMcq(item.questions, 'rl', body, { task: id, item });
    record(id, r, item.questions.length); $('[data-result]', body).innerHTML = stampHtml(r, item.questions.length); afterCheck(body, id);
  });
}

// ---------- Reading strategies ----------
// Korean connectors that signal how ideas relate (접속 표현).
const SIGNAL_WORDS = ['그럼에도 불구하고', '그렇기 때문에', '이와 같이', '이처럼', '다시 말해', '예를 들어', '예를 들면', '그러므로', '따라서', '그러나', '하지만', '그런데', '그래서', '게다가', '더구나', '또한', '반면에', '반면', '오히려', '결국', '왜냐하면', '즉', '한편', '특히', '그리고', '이러한', '이런'];
const SIGNALS = new RegExp(`(${SIGNAL_WORDS.map(w => w.replace(/\s/g, '\\s')).join('|')})`, 'g');
const markSignals = html => html.replace(SIGNALS, m => `<span class="tw">${m}</span>`);
// Which sentences a skimmer reads: the first and last sentence of every
// paragraph. Korean writers often put the point at the end (미괄식).
function skimVisible(paras) {
  return paras.map(p => {
    const ss = splitSentences(p), vis = new Set([0]);
    if (ss.length > 1) vis.add(ss.length - 1);
    return { ss, vis };
  });
}
function renderSkim(item, body, id) {
  const sk = skimVisible(item.paras);
  const secs = 12 * item.paras.length + 6;
  body.innerHTML = `
    <div class="strat-tip"><b>How to skim Korean:</b> read the title, then the first <i>and</i> last sentence of each paragraph. Korean writers often state the point at the end (미괄식), especially after 따라서, 결국, or -아/어야 한다. Ask: what is each paragraph's job?</div>
    <div class="write-bar"><span>You have ${secs} seconds</span><span class="timer" id="tm"></span></div>
    <div class="skim-box" id="skimBox">
      <h3>${esc(item.title)}</h3>
      ${sk.map(({ ss, vis }, i) => `<div class="skim-para"><span class="pnum">¶${i + 1}</span>${ss.map((s, k) => vis.has(k) ? `<span class="ts">${esc(s)}</span> ` : `<span class="bar" style="width:${Math.max(25, Math.min(100, s.length * 1.6))}%" aria-hidden="true"></span>`).join('')}</div>`).join('')}
    </div>
    <div class="row" style="margin-top:12px;"><button class="btn" id="doneSkim">Done skimming</button></div>
    <div id="qzone"></div>`;
  const toQuestions = () => {
    timer.stop();
    $('#skimBox', body).remove(); $('#doneSkim', body).remove();
    $('.write-bar', body).remove(); $('.strat-tip', body).remove();
    const q = $('#qzone', body);
    q.innerHTML = `<div class="notice info" style="margin:0 0 18px;">The passage is hidden now. Answer from your skim. Knowing where information is, without reading every word, is the skill you're building.</div>${mcqHtml(item.questions, 'sk')}${checkRow()}`;
    $('[data-check]', body).addEventListener('click', e => {
      e.target.disabled = true; const r = gradeMcq(item.questions, 'sk', body, { task: id, item });
      record(id, r, item.questions.length); $('[data-result]', body).innerHTML = stampHtml(r, item.questions.length);
      afterCheck(body, id, `<h3 style="text-align:left; margin:22px 0 6px;">The full passage</h3>
        <p class="hint" style="text-align:left; margin:0 0 8px;"><mark class="ts">Highlighted</mark> sentences are what you skimmed. <span class="tw">Underlined</span> words are connectors.</p>
        <div class="passage" style="text-align:left;">${sk.map(({ ss, vis }, i) => `<p><span class="pnum">¶${i + 1}</span>${ss.map((s, k) => vis.has(k) ? `<mark class="ts">${markSignals(esc(s))}</mark>` : markSignals(esc(s))).join(' ')}</p>`).join('')}</div>`);
    });
  };
  const timer = makeTimer($('#tm', body), secs, toQuestions);
  timer.start();
  $('#doneSkim', body).addEventListener('click', toQuestions);
}

const SIGNAL_GUIDE = [
  ['contrast', '그러나, 하지만, 반면에', 'The next idea goes against the last one. The writer\'s main point often follows.'],
  ['concession', '그럼에도 불구하고, 그래도, -지만', 'Despite what was just said, something else is true.'],
  ['cause', '왜냐하면 …기 때문이다, 그 이유는', 'An explanation is coming. Useful for 이유 questions.'],
  ['result', '그래서, 따라서, 그러므로, 결국', 'An effect or conclusion is coming, often the main idea in Korean texts.'],
  ['example', '예를 들어, 예컨대, 가령', 'A specific case of the idea just stated. If you understood the idea, read examples quickly.'],
  ['addition', '게다가, 또한, 더구나, 그리고', 'More of the same kind of point.'],
  ['restate', '즉, 다시 말해, 이처럼', 'The same idea in other words, often a summary. Great clue for blanks.'],
  ['shift', '그런데, 한편', 'A change of topic or a new angle.']
];
function renderTrans(item, body, id) {
  const parts = item.text.split(/\[\[([a-z ]+):([^\]]+)\]\]/);
  const blanks = []; let html = '';
  for (let k = 0; k < parts.length; k++) {
    if (k % 3 === 0) { html += esc(parts[k]); continue; }
    const func = parts[k], opts = parts[k + 1].split('|').map(s => s.trim()); k++;
    const order = shuffle(opts.map((_, i) => i));
    const bi = blanks.length; blanks.push({ func, correct: opts[0], order });
    html += `<select class="tsel" data-b="${bi}" aria-label="Blank ${bi + 1}"><option value="">(${bi + 1}) 선택…</option>${order.map(o => `<option value="${o}">${esc(opts[o])}</option>`).join('')}</select><span class="func" data-f="${bi}" hidden></span>`;
  }
  body.innerHTML = `
    <details class="guide"><summary>Connector guide (접속 표현)</summary>
      <table>${SIGNAL_GUIDE.map(([f, w, m]) => `<tr><td><b>${f}</b><br><span class="hint" lang="ko">${w}</span></td><td>${m}</td></tr>`).join('')}</table>
    </details>
    <h3 style="margin:18px 0 6px;">Part 1. Choose the connector that fits</h3>
    <div class="trans-text" lang="ko">${html}</div>
    <h3 style="margin:24px 0 6px;">Part 2. Predict what comes next</h3>
    <p class="hint" style="margin-top:0;">Strong readers guess the next idea from the connector before they read it. This is exactly what order (13–15) and sentence-insertion (39–41) questions test.</p>
    ${mcqHtml(item.predict, 'pr')}
    ${checkRow()}`;
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; let r = 0;
    blanks.forEach((b, i) => {
      const sel = $(`[data-b="${i}"]`, body); sel.disabled = true;
      const ok = sel.value === '0'; if (ok) r++;
      sel.classList.add(ok ? 'ok' : 'bad');
      const f = $(`[data-f="${i}"]`, body); f.hidden = false;
      f.textContent = ok ? ` ${b.func}` : ` → ${b.correct} (${b.func})`;
    });
    r += gradeMcq(item.predict, 'pr', body, { task: id, item });
    const tot = blanks.length + item.predict.length;
    record(id, r, tot); $('[data-result]', body).innerHTML = stampHtml(r, tot); afterCheck(body, id);
  });
}

const CLUES = ['definition', 'synonym', 'contrast', 'example', 'general sense', 'hanja'];
const CLUE_KO = { definition: '정의', synonym: '비슷한 말', contrast: '대조', example: '예시', 'general sense': '전체 의미', hanja: '한자' };
function renderVic(item, body, id) {
  body.innerHTML = `
    <div class="strat-tip"><b>Don't stop at an unknown word.</b> Look around it for a clue: a definition (<i lang="ko">즉, ~(이)란, ~을/를 말한다</i>), a similar word, a contrast (<i lang="ko">반면, ~와/과 달리</i>), examples (<i lang="ko">예를 들어, ~ 등</i>), or the sense of the whole sentence. For Sino-Korean words, a syllable you know (<i lang="ko">학 in 학교, 학생</i>) often gives the meaning away.</div>
    ${item.items.map((it, i) => {
      const t = esc(it.text).replace(/\{\{(.+?)\}\}/, '<b class="target">$1</b>').replace(/\[\[(.+?)\]\]/, '<span class="clue">$1</span>');
      return `<div class="vic-item" data-vi="${i}">
        <p class="vic-text" lang="ko">${i + 1}. ${t}</p>
        ${mcqHtml([{ q: '굵은 단어의 뜻으로 가장 알맞은 것은?', options: it.options, answer: it.answer }], 'vm' + i, i + 1).replace(/<legend>\d+\. /, '<legend>')}
        <div class="lbl">Which kind of clue helped?</div>
        <div class="chips" role="radiogroup">${CLUES.map(c => `<label class="chip"><input type="radio" name="vc${i}" value="${c}"><span>${c} <span lang="ko" class="hint">${CLUE_KO[c]}</span></span></label>`).join('')}</div>
        <div class="why" hidden>${esc(it.why)}</div>
      </div>`;
    }).join('')}
    ${checkRow()}`;
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; let r = 0;
    item.items.forEach((it, i) => {
      const wrap = $(`[data-vi="${i}"]`, body);
      r += gradeMcq([{ q: '', options: it.options, answer: it.answer }], 'vm' + i, wrap, { task: id, item, qi: () => i });
      const chosen = $(`input[name="vc${i}"]:checked`, wrap);
      $$(`input[name="vc${i}"]`, wrap).forEach(x => {
        x.disabled = true; const l = x.closest('label');
        if (x.value === it.clue) l.classList.add('right'); else if (x.checked) l.classList.add('wrong');
      });
      if (chosen && chosen.value === it.clue) r++;
      wrap.classList.add('checked'); $('.why', wrap).hidden = false;
    });
    const tot = item.items.length * 2;
    record(id, r, tot); $('[data-result]', body).innerHTML = stampHtml(r, tot); afterCheck(body, id);
  });
}

// ---------- Listening strategies: note-taking ----------
function notepadHtml(ph = '들으면서 메모하세요… (take notes while you listen)') {
  return `<div class="pad">
    <textarea class="pad-ta" spellcheck="false" autocapitalize="off" lang="ko" placeholder="${esc(ph)}"></textarea>
    <div class="pad-foot"><span>Key words, not full sentences</span><button type="button" class="btn ghost small" data-tpl>Insert template</button></div>
  </div>`;
}
function wireNotepad(root) {
  const ta = $('.pad-ta', root);
  $('[data-tpl]', root).addEventListener('click', () => { if (!ta.value.trim()) { ta.value = '주제:\n화자의 생각/태도:\n• \n• \n• \n예:\n결론:\n'; ta.focus(); ta.setSelectionRange(3, 3); } });
  return ta;
}
function markAttitude(text, phrases) {
  let h = esc(text);
  (phrases || []).forEach(p => { const e = esc(p); if (e && h.includes(e)) h = h.replace(e, `<mark class="att">${e}</mark>`); });
  return markSignals(h);
}

function notesFeedbackHtml(fb) {
  const list = a => Array.isArray(a) && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">None noted.</p>';
  const yn = v => v ? '<span style="color:var(--green)">✓ yes</span>' : '<span style="color:var(--red)">✗ not clearly</span>';
  return `<div class="row" style="justify-content:space-between;"><span class="score">${esc(fb.coverage ?? '?')}</span><span class="hint">key points captured</span></div>
    <p style="margin:6px 0 0;">Main idea in your notes: ${yn(fb.main_idea_captured)}. Speaker's attitude in your notes: ${yn(fb.attitude_captured)}.</p>
    ${fb.summary ? `<p style="margin:6px 0 0;">${esc(fb.summary)}</p>` : ''}
    <h4>What your notes did well</h4>${list(fb.strengths)}
    <h4>Important points you missed</h4>${list(fb.missed)}
    ${Array.isArray(fb.shorter) && fb.shorter.length ? `<h4>Write it shorter</h4>${fb.shorter.map(c => `<div class="corr"><span class="o">${esc(c.original)}</span> → <span class="n">${esc(c.better)}</span></div>`).join('')}` : ''}`;
}
async function reviewNotes(out, btn, transcript, notes, extra = '') {
  const ctl = new AbortController(); onLeave(() => ctl.abort());
  btn.disabled = true;
  const box = document.createElement('div'); box.className = 'fb'; box.innerHTML = '<p class="thinking">Claude is comparing your notes with the talk…</p>'; out.prepend(box);
  const prompt = `You are a TOPIK II listening coach. A learner of Korean listened ONCE to the Korean talk below and took the notes shown (in Korean, English, or a mix). Evaluate the notes as a tool for answering TOPIK listening questions 21-50: did they capture the main idea (중심 생각), the speaker's attitude (태도), the key supporting points and examples, and the logical links (이유, 대조, 결론)? Also judge how efficiently they wrote: key words rather than full sentences. Notes are supposed to be fragmentary, so never criticize grammar or spelling.

TALK TRANSCRIPT
"""${transcript.slice(0, 30000)}"""

STUDENT NOTES
"""${notes.slice(0, 6000)}"""
${extra}
Reply with only JSON:
{"coverage": "3/5", "main_idea_captured": true, "attitude_captured": false, "summary": "one or two encouraging sentences", "strengths": ["..."], "missed": ["important points or attitude cues missing from the notes"], "shorter": [{"original": "a long phrase from the notes", "better": "a shorter key-word version"}]}
"coverage" counts how many of the talk's 4-6 most important points appear in the notes. Give 2-3 strengths, up to 4 missed points, and up to 4 "shorter" rewrites (only if the notes contain long phrases).${fbLang()}`;
  try {
    const fb = await sample.json(prompt, { signal: ctl.signal });
    box.innerHTML = notesFeedbackHtml(fb);
  } catch (err) { const m = aiErrorText(err); box.innerHTML = m ? `<div class="notice err" style="margin:0;">${esc(m)}</div>` : ''; btn.disabled = false; }
}

function renderNotes(item, body, id) {
  const transcript = item.lines.map(l => l.t).join(' ');
  body.innerHTML = `
    <div class="strat-tip"><b>Listen once.</b> Write the topic, the speaker's view and attitude, the main points, and any term or example the speaker stresses. Key words only: 고령화 ↑, 원인 = 저출산.</div>
    <div class="player" id="pl"></div>
    ${notepadHtml()}
    <div id="qzone"></div>`;
  const ta = wireNotepad(body);
  const showQs = () => {
    if ($('#qs', body)) return;
    $('#qzone', body).innerHTML = `<div id="qs"><h3 style="margin:22px 0 4px;">Answer using only your notes</h3><p class="hint" style="margin-top:0;">The talk won't play again.</p>${mcqHtml(item.questions, 'nt')}${checkRow()}</div>`;
    $('[data-check]', body).addEventListener('click', e => {
      e.target.disabled = true; const r = gradeMcq(item.questions, 'nt', body, { task: id, item });
      record(id, r, item.questions.length); $('[data-result]', body).innerHTML = stampHtml(r, item.questions.length);
      afterCheck(body, id, `
        <div style="text-align:left;">
          <div class="row" style="margin-top:20px;"><button class="btn ai-only" id="revBtn">Review my notes with Claude</button></div>
          <div id="revOut"></div>
          ${item.model ? `<div class="lbl" style="margin-top:18px;">Model notes</div><div class="model notes-font">${esc(item.model)}</div>` : ''}
          ${retellHtml()}
          <div class="lbl" style="margin-top:18px;">Transcript</div>
          <p class="hint" style="margin:0 0 6px;"><mark class="att">Highlighted</mark> words show the speaker's attitude. <span class="tw">Underlined</span> words are connectors.</p>
          <div class="transcript" style="margin-top:0;" lang="ko">${markAttitude(transcript, item.attitude)}</div>
        </div>`);
      wireRetell(body, transcript, ta.value);
      const rb = $('#revBtn', body);
      if (rb) rb.addEventListener('click', () => {
        if (wordCount(ta.value) < 3) { $('#revOut', body).innerHTML = '<div class="notice err">Your notes are empty. Take notes on the next set and try this again.</div>'; return; }
        reviewNotes($('#revOut', body), rb, transcript, ta.value);
      });
    });
  };
  mountPlayer($('#pl', body), item.lines, { label: '▶ Start the talk (plays once)', once: true, onFirstEnd: showQs });
}

function renderByo(item, body, id) {
  let secs = 0, h = null;
  body.innerHTML = `
    <div class="strat-tip"><b>Use real speakers.</b> Real voices carry tone and speed that synthetic voices can't. Open a 3 to 8 minute Korean talk in another tab or on another device: a 세바시 (세상을 바꾸는 시간 15분) talk, a KBS or YTN news report, an EBS documentary clip, or a Korean podcast. Press start, listen <b>once</b> without pausing, and take notes here.</div>
    <label class="lbl" for="src">What are you listening to? (optional)</label>
    <input id="src" class="field-in" placeholder="e.g. 세바시: 습관을 바꾸는 방법">
    <div class="write-bar" style="margin-top:14px;"><button class="btn" id="startBtn">Start listening</button><span class="timer" id="clock">0:00</span></div>
    ${notepadHtml('메모… (your notes)')}
    <div class="row" style="margin-top:10px;"><button class="btn" id="doneBtn" disabled>I've finished listening</button></div>
    <div id="after"></div>`;
  const ta = wireNotepad(body), clock = $('#clock', body);
  const stopClock = () => { clearInterval(h); h = null; };
  onLeave(stopClock);
  $('#startBtn', body).addEventListener('click', e => {
    e.target.disabled = true; $('#doneBtn', body).disabled = false; ta.focus();
    h = setInterval(() => { secs++; clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; }, 1000);
  });
  $('#doneBtn', body).addEventListener('click', e => {
    e.target.disabled = true; stopClock();
    const after = $('#after', body);
    after.innerHTML = `
      <h3 style="margin:24px 0 6px;">From your notes alone</h3>
      <label class="lbl" for="sum">In one or two sentences, what was the main idea? (Korean or English)</label>
      <textarea id="sum" class="write" style="min-height:70px;" lang="ko"></textarea>
      <label class="lbl" for="att" style="margin-top:12px;">What was the speaker's attitude (태도)? What made you think so?</label>
      <textarea id="att" class="write" style="min-height:70px;" lang="ko"></textarea>
      <div class="ai-only" style="margin-top:22px;">
        <h3 style="margin:0 0 6px;">Check yourself with Claude</h3>
        <p class="hint" style="margin-top:0;">Paste the Korean transcript. On YouTube, open the description and choose "Show transcript" (스크립트 표시). Claude will quiz you in TOPIK style from your notes and then review them.</p>
        <textarea id="tx" class="write" style="min-height:120px;" lang="ko" placeholder="Paste the transcript here…"></textarea>
        <div class="row" style="margin-top:10px;"><button class="btn" id="quizBtn">Quiz me on my notes</button></div>
      </div>
      <div id="selfCheck">
        <p class="hint" style="margin-top:18px;">Self-check: listen a second time and compare. Did your notes catch the main idea, every example, and the moment the speaker's attitude showed? Mark each missed point so you can see your pattern.</p>
      </div>
      <div id="qz"></div>`;
    if (sample) $('#selfCheck', body).hidden = true;
    const qb = $('#quizBtn', body);
    if (qb) qb.addEventListener('click', async () => {
      const tx = $('#tx', body).value.trim(), qz = $('#qz', body);
      if (tx.length < 200) { qz.innerHTML = '<div class="notice err">Paste the full transcript (at least a paragraph) so Claude can write questions.</div>'; return; }
      qb.disabled = true; qz.innerHTML = '<p class="thinking">Claude is writing questions about the talk…</p>';
      const ctl = new AbortController(); onLeave(() => ctl.abort());
      try {
        const data = await sample.json(`You write TOPIK II listening questions. From the Korean transcript below, write exactly 5 multiple-choice questions in Korean in TOPIK style: 1 중심 생각 or 주제, 2 들은 내용과 같은 것 (detail), 1 about the speaker's 태도, and 1 about 말하는 의도 or 이유. Each has 4 Korean options and one clearly correct answer, plus a short "why" in ${SETTINGS.english !== false ? 'English' : 'Korean'}. Also identify the main idea and the speaker's attitude.

TRANSCRIPT
"""${tx.slice(0, 30000)}"""

Reply with only JSON:
{"main_idea": "one sentence", "attitude": "one sentence describing the speaker's attitude and the words or cues that show it", "questions": [{"q": "...", "options": ["...", "...", "...", "..."], "answer": 0, "why": "short explanation"}]}
Vary which option index is correct.`, { signal: ctl.signal });
        if (!isMcq(data.questions)) throw { code: 'invalid_json' };
        qz.innerHTML = `<h3 style="margin:22px 0 4px;">Answer from your notes</h3><p class="hint" style="margin-top:0;">Don't look at the transcript.</p>${mcqHtml(data.questions, 'by')}${checkRow()}`;
        $('#tx', body).style.display = 'none';
        $('[data-check]', qz).addEventListener('click', ev => {
          ev.target.disabled = true; const r = gradeMcq(data.questions, 'by', qz);
          record(id, r, data.questions.length);
          $('[data-result]', qz).innerHTML = stampHtml(r, data.questions.length) + `
            <div style="text-align:left; margin-top:18px;">
              <div class="prompt-box"><b>Main idea:</b> ${esc(data.main_idea)}<br><span class="hint">You wrote: ${esc($('#sum', body).value || '(nothing)')}</span></div>
              <div class="prompt-box"><b>Speaker's attitude:</b> ${esc(data.attitude)}<br><span class="hint">You wrote: ${esc($('#att', body).value || '(nothing)')}</span></div>
              <div class="row"><button class="btn" id="revBtn2">Review my notes with Claude</button></div>
              <div id="revOut2"></div>
            </div>`;
          const rb = $('#revBtn2', qz);
          rb.addEventListener('click', () => reviewNotes($('#revOut2', qz), rb, tx, ta.value, `\nThe student's own summary: ${$('#sum', body).value}\nThe student's description of the attitude: ${$('#att', body).value}\nComment briefly on whether these match the talk.`));
        });
      } catch (err) { const m = aiErrorText(err); qz.innerHTML = m ? `<div class="notice err">${esc(m)}</div>` : ''; qb.disabled = false; }
    });
  });
}

// ---------- Note-taking: guided notes, segment notes, summary ----------
const normNote = s => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
function gapOk(input, alts) {
  const v = normNote(input).replace(/[.,;:!]+$/, '');
  if (!v) return false;
  return alts.some(a => { a = normNote(a); return v === a || v.includes(a) || (v.length >= 2 && a.includes(v)); });
}
function renderGuided(item, body, id) {
  const gaps = [];
  // Parse the raw outline (not the escaped one) so answers stay intact
  const skel = item.skeleton.split(/\[\[([^\]]+)\]\]/).map((part, k) => {
    if (k % 2 === 0) return esc(part);
    const alts = part.split('|'); const i = gaps.length; gaps.push(alts);
    return `<input class="gap-in" data-g="${i}" style="width:calc(${Math.max(6, alts[0].length * 2 + 3)}ch)" autocomplete="off" autocapitalize="off" spellcheck="false" lang="ko" aria-label="Gap ${i + 1}">`;
  }).join('');
  body.innerHTML = `
    <div class="strat-tip"><b>Guided notes.</b> Read the outline first, so you know what to listen for. Then start the talk and fill each gap as you hear it. One word is enough. The talk plays once.</div>
    <div class="player" id="pl"></div>
    <div class="skeleton" lang="ko">${skel}</div>
    <div class="row" style="margin-top:12px;"><button class="btn" data-check disabled>Check my notes</button><span class="hint" id="ckHint">You can check after the talk ends.</span></div>
    <div class="result" data-result></div>`;
  const ins = $$('.gap-in', body);
  ins.forEach((inp, i) => inp.addEventListener('keydown', e => { if (enterKey(e) && ins[i + 1]) { e.preventDefault(); ins[i + 1].focus(); } }));
  mountPlayer($('#pl', body), item.lines, { label: '▶ Start the talk (plays once)', once: true, onFirstEnd: () => { $('[data-check]', body).disabled = false; $('#ckHint', body).textContent = ''; } });
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; let r = 0;
    ins.forEach((inp, i) => {
      inp.disabled = true; const ok = gapOk(inp.value, gaps[i]);
      inp.classList.add(ok ? 'ok' : 'bad'); if (ok) r++;
      if (!ok) inp.insertAdjacentHTML('afterend', `<span class="fix">${esc(gaps[i][0])}</span>`);
    });
    record(id, r, gaps.length);
    $('[data-result]', body).innerHTML = stampHtml(r, gaps.length);
    const transcript = item.lines.map(l => l.t).join(' ');
    afterCheck(body, id, `<div style="text-align:left;">${retellHtml()}<div class="lbl" style="margin-top:18px;">Transcript</div><div class="transcript" style="margin-top:0;" lang="ko">${markSignals(esc(transcript))}</div></div>`);
    wireRetell(body, transcript, '');
  });
}

function renderSegment(item, body, id) {
  const notes = [], scores = [];
  let i = 0;
  const intro = () => {
    body.innerHTML = `
      <div class="strat-tip"><b>One note per chunk.</b> You'll hear the talk in ${item.segments.length} short pieces, each played once. After each piece, write its key idea in <b>8 words (어절) or fewer</b>. Drop endings and particles: write 수면 부족 → 집중력 ↓, not full sentences.</div>
      <div class="row"><button class="btn" id="go">Start</button></div>`;
    $('#go', body).addEventListener('click', step);
  };
  const step = () => {
    if (i >= item.segments.length) return finish();
    const seg = item.segments[i];
    body.innerHTML = `<div class="big-step">Part ${i + 1} of ${item.segments.length}</div>
      <div class="player" id="pl"></div>
      <div id="zone"><p class="hint">Listen first. The note box opens when this part ends.</p></div>`;
    const zone = $('#zone', body);
    const write = () => {
      zone.innerHTML = `<label class="lbl" for="nt">Your note for part ${i + 1}</label>
        <input id="nt" class="field-in notes-font" autocomplete="off" autocapitalize="off" spellcheck="false" lang="ko" placeholder="핵심 내용, 8어절 이내">
        <div class="write-bar"><span id="wc">0 / 8 words</span><span class="timer" id="tm"></span></div>
        <div class="row"><button class="btn" id="save">Save note</button></div>`;
      const nt = $('#nt', body), wc = $('#wc', body);
      nt.focus();
      const timer = makeTimer($('#tm', body), 25, () => { $('#tm', body).textContent = "time's up"; });
      timer.start();
      nt.addEventListener('input', () => { const n = wordCount(nt.value); wc.textContent = `${n} / 8 words`; wc.style.color = n > 8 ? 'var(--red)' : ''; });
      nt.addEventListener('keydown', e => { if (enterKey(e)) $('#save', body).click(); });
      $('#save', body).addEventListener('click', () => {
        timer.stop();
        const v = nt.value.trim(); notes[i] = v;
        const hits = seg.keys.map(alts => alts.some(a => normNote(v).includes(normNote(a))));
        const got = hits.filter(Boolean).length; scores[i] = got / seg.keys.length;
        const over = wordCount(v) > 8;
        zone.innerHTML = `
          <div class="prompt-box notes-font" style="margin-bottom:8px;"><span class="hint">Your note</span><br>${esc(v || '(empty)')}</div>
          <div class="prompt-box notes-font"><span class="hint">Model note</span><br>${esc(seg.model)}</div>
          <p class="hint">Key ideas caught: ${got} of ${seg.keys.length}${over ? '. Your note ran over 8 words: drop particles and endings and keep the nouns.' : ''}</p>
          <details class="transcript"><summary>What was said</summary><p lang="ko">${markSignals(esc(seg.t))}</p></details>
          <div class="row" style="margin-top:12px;"><button class="btn" id="nx">${i + 1 < item.segments.length ? 'Next part' : 'See all my notes'}</button></div>`;
        $('#nx', body).addEventListener('click', () => { i++; step(); });
      });
    };
    mountPlayer($('#pl', body), [{ s: item.s || 0, t: seg.t }], { label: `▶ Play part ${i + 1} (once)`, once: true, onFirstEnd: write });
  };
  const finish = () => {
    const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    record(id, Math.round(avg * item.segments.length * 10) / 10, item.segments.length);
    const transcript = item.segments.map(s => s.t).join(' ');
    body.innerHTML = `<div class="result">${stampHtml(Math.round(avg * 100), 100).replace(' / 100', '%')}</div>
      <p class="hint" style="text-align:center;">of key ideas captured</p>
      <div class="two-col">
        <div><div class="lbl">Your notes</div><div class="model notes-font">${notes.map((n, k) => `${k + 1}. ${esc(n || '—')}`).join('\n')}</div></div>
        <div><div class="lbl">Model notes</div><div class="model notes-font">${item.segments.map((s, k) => `${k + 1}. ${esc(s.model)}`).join('\n')}</div></div>
      </div>
      ${retellHtml()}
      <div class="result" data-result></div>`;
    wireRetell(body, transcript, notes.join('\n'));
    afterCheck(body, id);
  };
  intro();
}

// Summarize the talk from your notes in written Korean, then score it with
// Claude. If your notes let you rebuild the talk, they worked, and it's
// practice for the -다 style writing of questions 53 and 54.
function retellHtml() {
  return `<div class="retell">
    <h3 style="margin:24px 0 4px;">Summarize it from your notes (요약하기)</h3>
    <p class="hint" style="margin-top:0;">Looking only at your notes, write 3 to 5 Korean sentences in -다 style: the topic, the main points, an example, and the speaker's view. If you can rebuild the talk, your notes worked.</p>
    ${templateHtml('retell')}
    <textarea class="write" data-rt-ta style="min-height:110px;" lang="ko" placeholder="이 강연은 …에 대한 내용이다."></textarea>
    <div class="write-bar"><span data-rt-cc>0자</span><span>Aim for 150–250자</span></div>
    <div class="row"><button class="btn ai-only" data-rt-fb>Score my summary with Claude</button><button class="btn ghost" data-rt-ask>Score in Claude ↗</button></div>
    <div data-rt-out></div>
  </div>`;
}
function retellPrompt(transcript, notesText, text, json) {
  return `You are a TOPIK II coach. A learner of Korean listened ONCE to a Korean talk, took notes, and then wrote a short Korean summary from the notes. Score it 0 to 5 (half points allowed) on accuracy and completeness (topic, main points, a key example, the speaker's view), organization, and accurate written Korean in -다 style.

TALK TRANSCRIPT
"""${transcript.slice(0, json ? 20000 : 8000)}"""
${notesText ? `\nNOTES\n"""${notesText.slice(0, 3000)}"""\n` : ''}
SUMMARY
"""${text.slice(0, 4000)}"""
${json ? `
Reply with only JSON:
{"score": 3.5, "summary": "one or two sentences", "strengths": ["..."], "improvements": ["specific advice, including what was missing or inaccurate and how better notes would have helped"], "corrections": [{"original": "Korean phrase they wrote", "better": "corrected Korean", "why": "short reason"}], "sample": "a model Korean summary of 150-220 characters in -다 style"}
Give 2-3 strengths, 2-3 improvements, and up to 5 corrections.${fbLang()}` : `
Please give my score, what I did well, what I missed or got wrong, corrections of my Korean (original → better, with a reason), and a model 150 to 220 character summary in -다 style.${fbLang()}`}`;
}
function wireRetell(root, transcript, notesText) {
  const ta = $('[data-rt-ta]', root), out = $('[data-rt-out]', root), cc = $('[data-rt-cc]', root);
  if (!ta) return;
  ta.addEventListener('input', () => { cc.textContent = `${charCount(ta.value)}자`; });
  const ready = () => { if (charCount(ta.value.trim()) < 40) { out.innerHTML = '<div class="notice err">Write your summary first, at least two sentences.</div>'; return false; } return true; };
  $('[data-rt-ask]', root).addEventListener('click', e => { if (ready()) askClaude(retellPrompt(transcript, notesText, ta.value.trim(), false), e.target); });
  $('[data-rt-fb]', root).addEventListener('click', async e => {
    if (!ready()) return;
    const btn = e.target; btn.disabled = true;
    out.innerHTML = '<div class="fb"><p class="thinking">Claude is comparing your summary with the talk…</p></div>';
    const ctl = new AbortController(); onLeave(() => ctl.abort());
    try {
      const fb = await sample.json(retellPrompt(transcript, notesText, ta.value.trim(), true), { signal: ctl.signal });
      out.innerHTML = `<div class="fb">${feedbackHtml(fb, 5)}</div>`;
    } catch (err) { const m = aiErrorText(err); out.innerHTML = m ? `<div class="notice err">${esc(m)}</div>` : ''; btn.disabled = false; }
  });
}

// ---------- Writing strategy: Build a sentence ----------
// Korean sentences are built from 어절 (a word plus its particle or ending).
// One extra chunk with a wrong particle or ending doesn't belong.
function renderBuild(item, body, id) {
  const states = item.items.map(it => {
    const words = it.answer.split(/\s+/);
    const tiles = shuffle(words.concat(it.distractor ? [it.distractor] : []));
    return { it, tiles, placed: [] };
  });
  body.innerHTML = states.map((st, i) => `
    <div class="build-item" data-bi="${i}">
      <div><span class="bubble" lang="ko">${i + 1}. ${esc(st.it.context)}</span> <button class="btn ghost small" data-say="${i}" aria-label="Hear it">🔊</button></div>
      <div class="answer-line" aria-label="Your sentence" lang="ko"></div>
      <div class="tile-pool" lang="ko"></div>
      <div class="correct-ans" hidden></div>
    </div>`).join('') + checkRow();
  let locked = false;
  const paint = i => {
    const st = states[i], wrap = $(`[data-bi="${i}"]`, body);
    const line = $('.answer-line', wrap), poolEl = $('.tile-pool', wrap);
    line.innerHTML = st.placed.length
      ? st.placed.map((ti, k) => `<button class="tile placed" data-k="${k}" ${locked ? 'disabled' : ''}>${esc(st.tiles[ti])}</button>`).join('') + `<span>${esc(st.it.end || '.')}</span>`
      : '<span class="ph">Tap the chunks below to build the sentence</span>';
    poolEl.innerHTML = st.tiles.map((w, ti) => st.placed.includes(ti) ? '' : `<button class="tile" data-ti="${ti}" ${locked ? 'disabled' : ''}>${esc(w)}</button>`).join('');
    $$('[data-k]', line).forEach(b => b.addEventListener('click', () => { st.placed.splice(+b.dataset.k, 1); paint(i); }));
    $$('[data-ti]', poolEl).forEach(b => b.addEventListener('click', () => { st.placed.push(+b.dataset.ti); paint(i); }));
  };
  states.forEach((_, i) => paint(i));
  $$('[data-say]', body).forEach(b => b.addEventListener('click', () => speak([{ s: 1, t: states[+b.dataset.say].it.context }])));
  $('[data-check]', body).addEventListener('click', e => {
    e.target.disabled = true; locked = true; let r = 0;
    const norm = s => s.replace(/[.,?!]/g, '').replace(/\s+/g, ' ').trim();
    states.forEach((st, i) => {
      const built = norm(st.placed.map(ti => st.tiles[ti]).join(' '));
      const ok = [st.it.answer].concat(st.it.alts || []).some(a => norm(a) === built);
      if (ok) r++;
      paint(i);
      const wrap = $(`[data-bi="${i}"]`, body);
      $('.answer-line', wrap).classList.add(ok ? 'ok' : 'bad');
      const c = $('.correct-ans', wrap); c.hidden = false;
      c.innerHTML = `${ok ? '' : `Correct: <b lang="ko">${esc(st.it.answer + (st.it.end || '.'))}</b>`}${st.it.why ? `<div class="why">${esc(st.it.why)}</div>` : ''}`;
    });
    record(id, r, states.length); $('[data-result]', body).innerHTML = stampHtml(r, states.length); afterCheck(body, id);
  });
}

// ---------- Writing (쓰기, questions 51-54) ----------
function makeTimer(el, seconds, onEnd) {
  let left = seconds, h = null;
  const fmt = s => `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
  const paint = () => { el.textContent = left >= 0 ? fmt(left) : '0:00'; el.classList.toggle('out', left <= 0); };
  paint();
  const t = {
    start() { if (h) return; h = setInterval(() => { left--; paint(); if (left === 0) { onEnd && onEnd(); } if (left <= 0) t.stop(); }, 1000); },
    stop() { clearInterval(h); h = null; },
    get running() { return !!h; }
  };
  onLeave(() => t.stop());
  return t;
}
// Rough share of the official marks: 53 = content 7, structure 7, language 16;
// 54 = content 12, structure 12, language 26.
const RUBRIC = {
  w51: 'Each blank is worth 5 points: it must fit the purpose and context of the text, connect grammatically with the words before and after it, and match the text\'s level of politeness (e.g. -습니다 in a formal notice). One sentence per blank.',
  w52: 'Each blank is worth 5 points: it must fit the logic signalled by the surrounding sentences and connectors, connect grammatically, and use the written -ㄴ다/-다 style like the rest of the paragraph.',
  w53: 'Score out of 30 using the TOPIK rubric: 내용 및 과제 수행 (content and task completion, about 7 points: describes all the given information accurately, without adding opinions), 글의 전개 구조 (organization, about 7: clear order such as introduction of the survey → main results → comparison or change → reasons or outlook, with appropriate connectors), and 언어 사용 (language, about 16: range and accuracy of grammar and vocabulary, written -다 style, appropriate expressions for data such as 차지하다, 증가하다, 감소하다, -(으)로 나타났다). Responses under 200 or over 300 characters lose points; a title is not allowed.',
  w54: 'Score out of 50 using the TOPIK rubric: 내용 및 과제 수행 (content, about 12 points: answers every guiding question with relevant, well-developed ideas), 글의 전개 구조 (organization, about 12: introduction, body and conclusion, logical paragraphs and connectors), and 언어 사용 (language, about 26: range and accuracy of advanced grammar and vocabulary, written -다 style throughout, no spoken forms). Responses under 600 or over 700 characters lose points; copying the prompt is penalized.'
};
function feedbackHtml(fb, max) {
  const list = a => Array.isArray(a) && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">None noted.</p>';
  return `
    <div class="row" style="justify-content:space-between;"><span class="score">${esc(fb.score ?? '?')} / ${max}</span><span class="hint">Estimated by Claude, not an official score</span></div>
    ${Array.isArray(fb.breakdown) && fb.breakdown.length ? `<div class="score-list" style="margin-top:6px;">${fb.breakdown.map(b => `<div><span>${esc(b.name)}</span><span>${esc(b.score)}${b.max ? ` / ${esc(b.max)}` : ''}</span></div>`).join('')}</div>` : ''}
    ${fb.summary ? `<p style="margin:6px 0 0;">${esc(fb.summary)}</p>` : ''}
    <h4>What worked</h4>${list(fb.strengths)}
    <h4>What to improve</h4>${list(fb.improvements)}
    ${Array.isArray(fb.corrections) && fb.corrections.length ? `<h4>Corrections</h4>${fb.corrections.map(c => `<div class="corr"><span class="o" lang="ko">${esc(c.original)}</span> → <span class="n" lang="ko">${esc(c.better)}</span><div class="w">${esc(c.why)}</div></div>`).join('')}` : ''}
    ${fb.revised ? `<h4>Revised version</h4><div class="model" style="margin-top:4px;" lang="ko">${esc(fb.revised)}</div>` : ''}
    ${fb.sample ? `<h4>A stronger sample answer</h4><div class="model" style="margin-top:4px;" lang="ko">${esc(fb.sample)}</div>` : ''}`;
}
// The task as plain text, for Claude prompts.
function writingTaskText(id, item) {
  if (id === 'w51' || id === 'w52') return `${TASKS[id].ko}\n\n${item.text}`;
  if (id === 'w53') return `${TASKS.w53.ko}\n\n${item.prompt}\n${item.charts.map(chartText).join('\n')}${item.notes ? '\n' + item.notes.map(n => '- ' + n).join('\n') : ''}`;
  return `${TASKS.w54.ko}\n\n${item.intro}\n${item.points.map(p => '- ' + p).join('\n')}`;
}
function chartText(c) {
  return `[${c.title}${c.unit ? ` (단위: ${c.unit})` : ''}] ` + c.series.map(s => `${s.name ? s.name + ': ' : ''}${c.labels.map((l, i) => `${l} ${s.values[i]}`).join(', ')}`).join(' / ');
}
function answerText(id, ans) { return id === 'w51' || id === 'w52' ? `㉠ ${ans.a || '(blank)'}\n㉡ ${ans.b || '(blank)'}` : ans; }
function scorePrompt(id, item, ans, json) {
  const t = TASKS[id];
  const text = answerText(id, ans);
  const len = typeof ans === 'string' ? ` (${charCount(ans)} characters including spaces)` : '';
  return `You are an experienced, fair TOPIK II writing rater. Score ${json ? 'the' : 'my'} answer to TOPIK II writing question ${t.nums} ("${t.name}"). ${RUBRIC[id]} Be encouraging but honest, and judge it as a real TOPIK rater would.

TASK
${writingTaskText(id, item)}

${json ? 'ANSWER' : 'MY ANSWER'}${len}
"""${String(text).slice(0, 4000)}"""
${json ? `
Reply with only JSON in this shape:
{"score": ${Math.round(t.max * 0.6)}, "breakdown": [{"name": "${id === 'w51' || id === 'w52' ? '㉠' : '내용 및 과제 수행'}", "score": 0, "max": 0}], "summary": "one or two sentences on overall level", "strengths": ["..."], "improvements": ["specific, actionable advice"], "corrections": [{"original": "exact Korean phrase from the answer", "better": "corrected Korean", "why": "short reason"}], "revised": "a revised version that keeps the writer's ideas but fixes errors and improves flow"}
"score" is out of ${t.max}. ${id === 'w51' || id === 'w52' ? 'Give the breakdown as ㉠ and ㉡, each out of 5.' : 'Give the breakdown as 내용 및 과제 수행, 글의 전개 구조, 언어 사용.'} Give 2-3 strengths, 2-3 improvements, and up to 6 corrections of real errors only.${fbLang()}` : `
Please give me:
1. My score out of ${t.max}${id === 'w51' || id === 'w52' ? ' (㉠ and ㉡ out of 5 each)' : ', with points for 내용 및 과제 수행, 글의 전개 구조, and 언어 사용'}, and a one-sentence summary
2. Two or three strengths
3. Two or three specific improvements
4. Corrections of real errors (original → better, with a short reason)
5. A revised version that keeps my ideas but fixes errors${fbLang()}`}`;
}
// Shared buttons and Claude scoring for every writing question.
function writingActions(body, id, item, getAnswer, isEmpty, modelHtml) {
  const t = TASKS[id], out = $('#out', body);
  let counted = false; const countOnce = () => { if (!counted) { counted = true; recordAI(id, null); } };
  $('#askBtn', body).addEventListener('click', e => {
    if (isEmpty()) { out.innerHTML = '<div class="notice err">Write your answer first so Claude has something to score.</div>'; return; }
    countOnce(); askClaude(scorePrompt(id, item, getAnswer(), false), e.target);
  });
  $('#modelBtn', body).addEventListener('click', e => {
    e.target.disabled = true; countOnce();
    out.insertAdjacentHTML('beforeend', modelHtml);
  });
  if (!sample) out.innerHTML = `<p class="hint" style="margin-top:14px;">${id === 'w51' ? 'Self-check: does each sentence fit what comes right after the blank, and does it keep the same politeness level as the text?' : id === 'w52' ? 'Self-check: did you follow the connector before each blank, and did you keep the -다 style?' : 'Self-check: written -다 style throughout, no title, within the character range, and every point of the task covered?'}</p>`;
  $('#fbBtn', body).addEventListener('click', async e => {
    if (isEmpty()) { out.innerHTML = '<div class="notice err">Write your answer first so Claude has something to score.</div>'; return; }
    const btn = e.target; btn.disabled = true;
    const box = document.createElement('div'); box.className = 'fb'; box.innerHTML = '<p class="thinking">Claude is reading your answer…</p>';
    out.prepend(box);
    const ctl = new AbortController(); onLeave(() => ctl.abort());
    try {
      const fb = await sample.json(scorePrompt(id, item, getAnswer(), true), { signal: ctl.signal });
      countOnce(); setLast(id, typeof fb.score === 'number' ? fb.score : null, t.max);
      if (current.daily && DAILY && DAILY.steps[DAILY.i] && DAILY.steps[DAILY.i].id === id && typeof fb.score === 'number') dailyResult(fb.score, t.max);
      box.innerHTML = feedbackHtml(fb, t.max);
    } catch (err) { const m = aiErrorText(err); box.innerHTML = m ? `<div class="notice err" style="margin:0;">${esc(m)}</div>` : ''; }
    btn.disabled = false;
  });
}
const writingButtons = () => `<div class="row">
      <button class="btn ai-only" id="fbBtn">Score with Claude</button>
      <button class="btn ghost" id="askBtn">Score in Claude ↗</button>
      <button class="btn ghost" id="modelBtn">Show model answer</button>
    </div>
    <div id="out"></div>`;
const gapText = s => esc(s).replace(/\(\s*㉠\s*\)/, '<span class="gapmark">(&nbsp;&nbsp;㉠&nbsp;&nbsp;)</span>').replace(/\(\s*㉡\s*\)/, '<span class="gapmark">(&nbsp;&nbsp;㉡&nbsp;&nbsp;)</span>').replace(/\n/g, '<br>');

// 51 and 52: two blanks, one sentence or clause each.
function renderGap(item, body, id) {
  const t = TASKS[id], draftKey = `topik2-draft-${id}-${item.title}`;
  const d = store.get(draftKey, { a: '', b: '' });
  body.innerHTML = `
    ${templateHtml(id)}
    <div class="prompt-box" lang="ko">${item.kind ? `<span class="kind">${esc(item.kind)}</span>` : ''}${gapText(item.text)}</div>
    <div class="write-bar"><span>Suggested time: about ${t.mins} minutes</span><span class="timer" id="tm"></span></div>
    <label class="lbl" for="ga">㉠</label><input id="ga" class="field-in" lang="ko" autocomplete="off" spellcheck="false">
    <label class="lbl" for="gb" style="margin-top:12px;">㉡</label><input id="gb" class="field-in" lang="ko" autocomplete="off" spellcheck="false">
    <div style="height:14px;"></div>
    ${writingButtons()}`;
  const ga = $('#ga', body), gb = $('#gb', body);
  ga.value = d.a || ''; gb.value = d.b || '';
  const timer = makeTimer($('#tm', body), t.mins * 60, () => toast("Suggested time is up. Move on, as you would in the test."));
  const upd = () => { if (!timer.running) timer.start(); store.set(draftKey, { a: ga.value, b: gb.value }); };
  ga.addEventListener('input', upd); gb.addEventListener('input', upd);
  writingActions(body, id, item, () => ({ a: ga.value.trim(), b: gb.value.trim() }), () => !ga.value.trim() && !gb.value.trim(),
    `<div class="lbl" style="margin-top:16px;">Model answers</div><div class="model" lang="ko">㉠ ${esc(item.model.a)}\n㉡ ${esc(item.model.b)}</div>${item.tip ? `<p class="hint">${esc(item.tip)}</p>` : ''}`);
}

// A simple chart, drawn from the data so it works offline and in dark mode.
function chartSvg(c) {
  const W = 340, H = 210, L = 38, R = 10, T = 26, B = 40;
  const all = c.series.flatMap(s => s.values), top = Math.max(...all) * 1.15 || 1;
  const x0 = L, x1 = W - R, y0 = H - B, y1 = T;
  const y = v => y0 - (v / top) * (y0 - y1);
  const n = c.labels.length, band = (x1 - x0) / n;
  const colors = ['var(--pine)', 'var(--gold)', 'var(--red)'];
  let g = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" class="ch-axis"/>`;
  if (c.type === 'line') {
    c.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [x0 + band * (i + 0.5), y(v)]);
      g += `<polyline points="${pts.map(p => p.map(q => q.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${colors[si]}" stroke-width="2.5"/>`;
      g += pts.map(([px, py], i) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${colors[si]}"/><text x="${px.toFixed(1)}" y="${(py - 7).toFixed(1)}" class="ch-val">${s.values[i]}</text>`).join('');
    });
  } else {
    const k = c.series.length, bw = Math.min(34, (band * 0.7) / k);
    c.series.forEach((s, si) => s.values.forEach((v, i) => {
      const bx = x0 + band * i + (band - bw * k) / 2 + bw * si;
      g += `<rect x="${bx.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y0 - y(v)).toFixed(1)}" fill="${colors[si]}" rx="2"/><text x="${(bx + bw / 2 - 1).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" class="ch-val">${v}</text>`;
    }));
  }
  g += c.labels.map((l, i) => `<text x="${(x0 + band * (i + 0.5)).toFixed(1)}" y="${y0 + 16}" class="ch-lbl">${esc(l)}</text>`).join('');
  const legend = c.series.length > 1 || c.series[0].name ? `<div class="ch-legend">${c.series.map((s, si) => `<span><i style="background:${colors[si]}"></i>${esc(s.name || '')}</span>`).join('')}</div>` : '';
  return `<figure class="chart" lang="ko"><figcaption>${esc(c.title)}${c.unit ? ` <span class="hint">(단위: ${esc(c.unit)})</span>` : ''}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(chartText(c))}">${g}</svg>${legend}</figure>`;
}
function essayBox(body, id, item, promptHtml) {
  const t = TASKS[id], draftKey = `topik2-draft-${id}-${item.title}`;
  const [lo, hi] = t.chars;
  body.innerHTML = `
    ${templateHtml(id)}
    <div class="prompt-box" lang="ko">${promptHtml}</div>
    <div class="write-bar"><span>Suggested time: about ${t.mins} minutes. Timer starts when you type.</span><span class="timer" id="tm"></span></div>
    <textarea class="write" id="ta" lang="ko" placeholder="여기에 쓰십시오… (written -다 style, no title)" spellcheck="false"></textarea>
    <div class="write-bar"><span id="cc">0자</span><span>Target: ${lo}–${hi}자 (spaces count)</span></div>
    ${writingButtons()}`;
  const ta = $('#ta', body), cc = $('#cc', body);
  const timer = makeTimer($('#tm', body), t.mins * 60, () => toast("Suggested time is up. In the real test, keep an eye on the clock for the other questions."));
  ta.value = store.get(draftKey, '');
  const upd = () => {
    const n = charCount(ta.value);
    cc.textContent = `${n}자`; cc.className = n === 0 ? '' : n < lo ? 'cc-low' : n > hi ? 'cc-high' : 'cc-ok';
    store.set(draftKey, ta.value);
  };
  upd();
  ta.addEventListener('input', () => { if (!timer.running) timer.start(); upd(); });
  writingActions(body, id, item, () => ta.value.trim(), () => charCount(ta.value.trim()) < 30,
    `<div class="lbl" style="margin-top:16px;">Model answer (${charCount(item.model)}자)</div><div class="model" lang="ko">${esc(item.model)}</div>`);
}
const w53PromptHtml = item => `<p style="margin:0 0 10px;">${esc(item.prompt)}</p>${item.charts.map(chartSvg).join('')}${item.notes ? `<ul class="ch-notes">${item.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
const w54PromptHtml = item => `<p style="margin:0 0 8px;">${esc(item.intro)}</p><ul>${item.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
function renderChart(item, body, id) { essayBox(body, id, item, w53PromptHtml(item)); }
function renderEssay(item, body, id) { essayBox(body, id, item, w54PromptHtml(item)); }

// ---------- 어휘 Words tab: vocabulary and grammar cards with spaced review ----------
// Leitner boxes: a correct answer moves a card up one box, a miss sends it
// back to box 1. Each box waits longer before the card is due again.
const BOX_DAYS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };
let SRS = store.get('topik2-srs', {});
const saveSRS = () => store.set('topik2-srs', SRS);
const dayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); };
// Decks: themed vocabulary decks, plus one grammar deck (DATA.grammar).
const DECKS = () => (DATA.words || []).map(d => Object.assign({ kind: 'word' }, d)).concat(DATA.grammar ? [{ n: 'g', name: '문법 표현 Grammar', kind: 'grammar', words: DATA.grammar }] : []);
const WORDS_ALL = () => DECKS().flatMap(d => d.words.map(w => Object.assign({ deck: d.n, deckName: d.name, kind: d.kind }, w)));
const wkey = w => (w.kind === 'grammar' ? 'g:' : '') + w.t;
const boxOf = w => (SRS[wkey(w)] || {}).box || 0; // 0 = never studied
const isDue = w => { const r = SRS[wkey(w)]; return !r || r.due <= dayStr(); };
function srsAnswer(w, ok) {
  const r = SRS[wkey(w)] || { box: 0 };
  r.box = ok ? Math.min(5, Math.max(1, r.box + 1)) : 1;
  r.due = addDays(BOX_DAYS[r.box]); SRS[wkey(w)] = r; saveSRS();
}
// Due today: cards studied before whose review date has come (new cards aren't "due").
const dueWords = list => list.filter(w => SRS[wkey(w)] && isDue(w));

const WORD_MODES = [
  { id: 'def', label: 'Meaning → type the Korean' },
  { id: 'cloze', label: 'Sentence → fill the blank' },
  { id: 'listen', label: '🔊 Hear it → type it' },
  { id: 'mean', label: 'Korean → recall the meaning' }
];
function renderWordsTab() {
  setHeader('어휘 Words', false);
  const all = WORDS_ALL();
  const due = dueWords(all);
  const known = all.filter(w => boxOf(w) >= 5).length;
  const mode = SETTINGS.wordMode || 'def';
  stage.innerHTML = `
    <h1>어휘 · 문법 <span class="h-ko">Vocabulary and grammar</span></h1>
    <p class="sub">${all.length} TOPIK II cards in ${DECKS().length} decks, with English meanings and example sentences. Cards you miss come back sooner; cards you know come back less often.</p>
    <button class="home-card primary" id="dueBtn" ${due.length ? '' : 'disabled'}>
      <span class="hc-kicker">Review</span>
      <span class="hc-title">${due.length ? `${due.length} card${due.length > 1 ? 's' : ''} due today` : 'Nothing due today'}</span>
      <span class="hc-sub">${due.length ? 'Spaced review across all decks' : 'Study a deck below to add cards to your review.'} · ${known} known</span></button>
    <div><span class="lbl">How to practice vocabulary</span>
      <div class="seg" id="modeSeg">${WORD_MODES.map(m => `<button data-mode="${m.id}" class="${mode === m.id ? 'active' : ''}">${m.label}</button>`).join('')}</div>
      <p class="hint" style="margin:6px 0 0;">Grammar cards always use recall: see the pattern in a sentence, then check its meaning.</p></div>
    <section class="sec" style="margin-top:14px;">
      <div class="sec-head"><h2>Decks</h2><span class="sec-meta">known / total</span></div>
      ${DECKS().map(s => {
        const ws = all.filter(w => w.deck === s.n);
        const k = ws.filter(w => boxOf(w) >= 5).length, d = dueWords(ws).length, seen = ws.filter(w => boxOf(w) > 0).length;
        return `<div class="deck">
          <div class="deck-top"><b lang="ko">${esc(s.name)}</b><span class="badge ${k ? 'on' : ''}">${k}/${ws.length} known</span></div>
          <div class="deck-sub" lang="ko">${esc(ws.slice(0, 4).map(w => w.t).join(', '))}…${seen ? ` · ${seen} studied${d ? `, ${d} due` : ''}` : ''}</div>
          <div class="sk-bar" aria-hidden="true"><i style="width:${Math.round(100 * k / ws.length)}%"></i></div>
          <div class="row" style="margin-top:10px; gap:8px;">
            <button class="btn small" data-study="${s.n}">▶ Study</button>
            <button class="btn ghost small" data-preview="${s.n}">👀 Preview</button>
          </div></div>`;
      }).join('')}
    </section>`;
  $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SETTINGS.wordMode = b.dataset.mode; saveSettings(); $$('#modeSeg button').forEach(x => x.classList.toggle('active', x === b)); });
  $('#dueBtn').addEventListener('click', () => { if (due.length) go(() => runWords(shuffle(due).slice(0, 30), { title: 'Review due cards' })); });
  $$('[data-study]').forEach(b => b.addEventListener('click', () => {
    const n = b.dataset.study, ws = WORDS_ALL().filter(w => String(w.deck) === n);
    // Due cards first, then new ones, then the rest: about 15 cards per round.
    const d = shuffle(dueWords(ws)), fresh = ws.filter(w => !boxOf(w)), rest = shuffle(ws.filter(w => boxOf(w) && !isDue(w)));
    const cards = [...d, ...fresh, ...rest].slice(0, 15);
    go(() => runWords(cards, { title: ws[0] ? ws[0].deckName : 'Words' }));
  }));
  $$('[data-preview]').forEach(b => b.addEventListener('click', () => go(() => previewWords(WORDS_ALL().filter(w => String(w.deck) === b.dataset.preview)))));
}

// Example sentences mark the word as it appears with {{double braces}}.
const exForm = x => ((x || '').match(/\{\{(.+?)\}\}/) || [])[1] || '';
const fillEx = x => esc(x).replace(/\{\{(.+?)\}\}/, '<b>$1</b>');
const blankEx = x => esc(x).replace(/\{\{(.+?)\}\}/, (m, f) => '<span class="blank">' + '＿'.repeat(Math.max(2, f.replace(/\s+/g, '').length)) + '</span>');
function previewWords(words) {
  enterSub(); setHeader(`${words[0] ? words[0].deckName : 'Deck'} preview`, true);
  let i = 0;
  const paint = () => {
    const w = words[i];
    stage.innerHTML = `<div class="wcard">
      <div class="w-eyebrow">Preview ${i + 1} of ${words.length}${w.p ? ` · ${esc(w.p)}` : ''}</div>
      <div class="w-term" lang="ko">${esc(w.t)} ${w.kind === 'grammar' ? '' : '<button class="btn ghost small" data-say aria-label="Hear the word">🔊</button>'}</div>
      ${w.h ? `<div class="w-hanja">${esc(w.h)}</div>` : ''}
      <p class="w-def">${esc(w.e)}</p>
      ${(w.x || []).map(x => `<p class="w-ex" lang="ko">${fillEx(x)}</p>`).join('')}
      <div class="row" style="justify-content:space-between; margin-top:20px;">
        <button class="btn ghost" id="pv" ${i ? '' : 'disabled'}>◀ Previous</button>
        <button class="btn" id="nx">${i + 1 < words.length ? 'Next ▶' : 'Done'}</button></div></div>`;
    const sb = $('[data-say]'); if (sb) sb.addEventListener('click', () => speak([{ s: 1, t: w.t }]));
    $('#pv').addEventListener('click', () => { i--; paint(); });
    $('#nx').addEventListener('click', () => { if (i + 1 < words.length) { i++; paint(); } else goBack(); });
  };
  paint();
}

// Typo-tolerant grading on letters (자모), not syllables: one slip in a word
// of 6+ letters counts as correct, flagged "Close". Conjugated forms from the
// example sentence count too.
function editDist(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
function gradeWord(typed, targets) {
  const norm = s => s.replace(/[\s.,!?;:'"]+/g, '').normalize('NFD');
  const a = norm(typed);
  for (const t of targets.filter(Boolean)) if (a === norm(t)) return { ok: true, close: false };
  for (const t of targets.filter(Boolean)) { const b = norm(t); if (b.length >= 6 && editDist(a, b) === 1) return { ok: true, close: true, want: t }; }
  return { ok: false, close: false };
}

// Runs a round of cards. opts: { title, mode, onDone(right, total) }
function runWords(cards, opts = {}) {
  if (!opts.daily) enterSub();
  const baseMode = opts.mode || SETTINGS.wordMode || 'def';
  let i = 0, right = 0; const missed = [];
  if (!cards.length) { stage.innerHTML = '<p class="sub">No cards to study right now.</p>'; return; }
  keepAwake(baseMode === 'listen');
  const card = () => {
    const w = cards[i];
    const ex = (w.x || []).length ? w.x[Math.floor(Math.random() * w.x.length)] : '';
    const m = w.kind === 'grammar' ? 'mean' : baseMode === 'cloze' && !exForm(ex) ? 'def' : baseMode;
    setHeader(opts.daily ? dailyTitle() : `${opts.title || 'Words'} · ${i + 1}/${cards.length}`, true);
    const prompt = m === 'def' ? `<p class="w-prompt">${esc(w.e)}</p>${w.p ? `<div class="w-ko">${esc(w.p)}</div>` : ''}`
      : m === 'cloze' ? `<p class="w-prompt" lang="ko">${blankEx(ex)}</p><p class="hint" style="text-align:center;">${esc(w.e)}</p>`
      : m === 'listen' ? `<div class="row" style="justify-content:center; margin:12px 0;"><button class="btn" data-say>🔊 Play the word</button></div>`
      : `<div class="w-term" lang="ko">${esc(w.t)} ${w.kind === 'grammar' ? '' : '<button class="btn ghost small" data-say aria-label="Hear the word">🔊</button>'}</div>${w.kind === 'grammar' && ex ? `<p class="w-ex" lang="ko">${fillEx(ex)}</p>` : ''}`;
    stage.innerHTML = `<div class="wcard">
      <div class="pbar static" aria-hidden="true"><i style="width:${Math.round(100 * i / cards.length)}%"></i></div>
      <div class="w-eyebrow">${{ def: 'Meaning', cloze: 'Complete the sentence', listen: 'Listen and spell', mean: w.kind === 'grammar' ? 'What does this grammar mean?' : 'What does it mean?' }[m]} · <span lang="ko">${esc(w.deckName || '')}</span></div>
      ${prompt}
      ${m === 'mean'
        ? `<div class="row" style="justify-content:center; margin-top:16px;"><button class="btn" id="reveal">Show the meaning</button></div>`
        : `<div class="w-answer"><input id="ans" class="field-in" lang="ko" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="한국어로 쓰세요…" aria-label="Your answer"><button class="btn" id="sub">Check</button></div>`}
      <div id="fb"></div></div>`;
    const say = () => speak([{ s: 1, t: w.t }]);
    const sayBtn = $('[data-say]'); if (sayBtn) sayBtn.addEventListener('click', say);
    if (m === 'listen') say();
    const after = (ok, close, given, want) => {
      if (ok) right++; else missed.push({ w, given });
      srsAnswer(w, ok); buzz(ok ? 20 : [25, 70, 25]);
      const r = SRS[wkey(w)];
      $('#fb').innerHTML = `<div class="w-feedback">
        ${m !== 'mean' ? `<div class="stamp ${ok ? (close ? 'mid' : 'good') : 'low'}" style="font-size:17px;">${ok ? (close ? 'Close!' : 'Correct') : 'Not quite'}</div>` : ''}
        <div class="w-term" style="margin-top:12px;" lang="ko">${esc(w.t)} ${w.kind === 'grammar' ? '' : '<button class="btn ghost small" data-say2 aria-label="Hear the word">🔊</button>'}</div>
        ${close ? `<p class="hint">One letter off. It's spelled <b lang="ko">${esc(want)}</b>.</p>` : ''}
        ${!ok && given ? `<p class="hint">You wrote: <span lang="ko">${esc(given)}</span></p>` : ''}
        ${w.h ? `<div class="w-hanja">${esc(w.h)}</div>` : ''}
        <p class="w-def">${esc(w.e)}</p>
        ${ex ? `<p class="w-ex" lang="ko">${fillEx(ex)}</p>` : ''}
        <p class="hint">${ok ? `Level ${r.box} of 5 · next review in ${BOX_DAYS[r.box]} day${BOX_DAYS[r.box] > 1 ? 's' : ''}` : 'Back to level 1 · you\'ll see it again tomorrow'}</p>
        <div class="row" style="justify-content:center; margin-top:10px;"><button class="btn" id="nx">${i + 1 < cards.length ? 'Next card ▶' : 'See results'}</button></div></div>`;
      const s2 = $('[data-say2]'); if (s2) s2.addEventListener('click', say);
      const nx = $('#nx'); nx.addEventListener('click', () => { i++; i < cards.length ? card() : done(); }); nx.focus();
    };
    if (m === 'mean') {
      $('#reveal').addEventListener('click', () => {
        $('#reveal').parentElement.remove();
        $('#fb').innerHTML = `<div class="w-feedback">${w.h ? `<div class="w-hanja">${esc(w.h)}</div>` : ''}<p class="w-def">${esc(w.e)}</p>${ex && w.kind !== 'grammar' ? `<p class="w-ex" lang="ko">${fillEx(ex)}</p>` : ''}
          <p class="hint">Did you know it?</p><div class="row" style="justify-content:center;"><button class="btn" data-g="1">I knew it</button><button class="btn ghost" data-g="0">I didn't</button></div></div>`;
        $$('[data-g]').forEach(b => b.addEventListener('click', () => after(b.dataset.g === '1', false, '')));
      });
    } else {
      const ans = $('#ans'), sub = $('#sub');
      const check = () => {
        if (!ans.value.trim()) { ans.focus(); return; }
        ans.disabled = sub.disabled = true;
        const g = gradeWord(ans.value, [w.t, m === 'cloze' ? exForm(ex) : '']);
        after(g.ok, g.close, ans.value.trim(), g.want);
      };
      sub.addEventListener('click', check);
      ans.addEventListener('keydown', e => { if (enterKey(e)) check(); });
      if (m !== 'listen') ans.focus();
    }
  };
  const done = () => {
    keepAwake(false);
    if (opts.onDone) return opts.onDone(right, cards.length);
    record('words', right, cards.length);
    setHeader(opts.title || 'Words', true);
    stage.innerHTML = `<div class="result">${stampHtml(right, cards.length)}</div>
      ${missed.length ? `<h3>To review</h3>${missed.map(({ w, given }) => `<div class="corr"><b lang="ko">${esc(w.t)}</b>: ${esc(w.e)}${given ? `<div class="w">You wrote: <span lang="ko">${esc(given)}</span></div>` : ''}</div>`).join('')}` : '<p class="sub" style="text-align:center;">Every card correct.</p>'}
      <div class="row" style="justify-content:center; margin-top:18px;">
        ${missed.length ? '<button class="btn ghost" id="retry">Retry missed cards</button>' : ''}
        <button class="btn" id="back">Back to 어휘</button></div>`;
    const rt = $('#retry'); if (rt) rt.addEventListener('click', () => runWords(shuffle(missed.map(m => m.w)), Object.assign({}, opts, { title: 'Missed cards' })));
    $('#back').addEventListener('click', goBack);
  };
  card();
}

// ---------- Daily 15: a short mixed session ----------
// Five steps in about 15 minutes: card review, then one reading, listening,
// and writing task. Mixing skills in one session builds stronger recall than
// repeating one task type. Picks your weakest or untried tasks.
const DAILY_SLOTS = [
  { label: 'Words', kind: 'words' },
  { label: 'Reading', pick: ['rgram', 'rblank', 'rorder', 'rhead', 'rinsert', 'trans', 'vic'] },
  { label: 'Listening', pick: ['lnext', 'laction', 'lmatch', 'lcentral', 'lpair'] },
  { label: 'Writing', pick: ['w51', 'w52', 'build'] }
];
let DAILY = store.get('topik2-daily', null);
if (DAILY && DAILY.date !== dayStr()) DAILY = null; // yesterday's unfinished session expires
const saveDaily = () => store.set('topik2-daily', DAILY);
const dailyTitle = () => `Daily 15 · ${DAILY.i + 1} of ${DAILY.steps.length}`;
function pickTask(ids) {
  const score = id => { const s = STATS[id]; if (!s || !s.sets) return -1; return s.tot ? s.pts / s.tot : s.max && s.last != null ? s.last / s.max : 0.7; };
  return ids.filter(id => pool(id).length).map(id => ({ id, v: score(id) + Math.random() * 0.1 })).sort((a, b) => a.v - b.v)[0].id;
}
function startDaily() {
  const md = dueMistakes().length;
  const slots = md ? [DAILY_SLOTS[0], { label: 'Mistakes', kind: 'mistakes' }, ...DAILY_SLOTS.slice(1)] : DAILY_SLOTS;
  const steps = slots.map(sl => {
    if (sl.kind === 'mistakes') return { label: sl.label, kind: 'mistakes' };
    if (sl.kind === 'words') return { label: sl.label, kind: 'words' };
    const id = pickTask(sl.pick), n = pool(id).length;
    return { label: sl.label, kind: 'task', id, idx: ((CURSOR[id] || 0) + (STATS[id] && STATS[id].sets ? 1 : 0)) % n };
  });
  DAILY = { date: dayStr(), steps, i: 0, results: [] }; saveDaily();
  runDailyStep();
}
function dailyWordCards() {
  const all = WORDS_ALL(), due = shuffle(dueWords(all));
  const fresh = all.filter(w => !boxOf(w) && w.kind === 'word'); // next unseen words, in deck order
  return [...due, ...fresh].slice(0, 10);
}
function runDailyStep() {
  enterSub();
  const st = DAILY.steps[DAILY.i];
  if (!st) return finishDaily();
  if (st.kind === 'mistakes') {
    setHeader(dailyTitle(), true);
    runMistakes(shuffle(dueMistakes()).slice(0, 5), { daily: true, onDone: (r, t) => { dailyResult(r, t); dailyContinueScreen(); } });
  } else if (st.kind === 'words') {
    setHeader(dailyTitle(), true);
    runWords(dailyWordCards(), { daily: true, mode: 'def', onDone: (r, t) => { dailyResult(r, t); dailyContinueScreen(); } });
  } else {
    openTask(st.id, st.idx, { daily: true });
    // Writing has no "check" step, so it gets its own way to move on.
    if (TASKS[st.id].writing) {
      $('#body').insertAdjacentHTML('beforeend', `<div class="row" style="justify-content:center; margin-top:20px;"><button class="btn" id="dailyGo">${dailyNextLabel()}</button></div>`);
      $('#dailyGo').addEventListener('click', () => { if (!DAILY.results[DAILY.i]) dailyResult(0, 0); dailyNext(); });
    }
  }
}
function dailyResult(pts, tot) {
  if (!DAILY) return;
  DAILY.results[DAILY.i] = { pts, tot }; saveDaily();
}
function dailyNext() { DAILY.i++; saveDaily(); go(() => runDailyStep()); }
function dailyNextLabel() {
  const nx = DAILY.steps[DAILY.i + 1];
  return nx ? `Next: ${nx.label} ▶` : 'Finish Daily 15 ▶';
}
function dailyContinueScreen() {
  const r = DAILY.results[DAILY.i];
  stage.innerHTML = `<div class="result">${r ? stampHtml(r.pts, r.tot) : ''}<p class="sub">Step ${DAILY.i + 1} of ${DAILY.steps.length} done.</p>
    <button class="btn" id="dn">${dailyNextLabel()}</button></div>`;
  $('#dn').addEventListener('click', dailyNext);
}
function markStudyDay() {
  const days = store.get('topik2-days', []);
  const t = dayStr(); if (!days.includes(t)) { days.push(t); store.set('topik2-days', days.slice(-400)); }
}
function streak() {
  const days = new Set(store.get('topik2-days', []));
  let n = 0; const d = new Date();
  if (!days.has(dayStr(d))) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
  while (days.has(dayStr(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function finishDaily() {
  markStudyDay();
  const res = DAILY.steps.map((s, k) => ({ s, r: DAILY.results[k] }));
  DAILY.finished = true; saveDaily();
  setHeader('Daily 15 done', true);
  stage.innerHTML = `<h1>Daily 15 complete 🎉</h1>
    <p class="sub">${streak()}-day streak. Come back tomorrow for a new mix; your missed cards will be waiting.</p>
    <div class="score-list">${res.map(({ s, r }) => `<div><span>${s.label}${s.id ? `: ${esc(TASKS[s.id].name)}` : ''}</span><span>${r && r.tot ? `${Math.round(100 * r.pts / r.tot)}%` : '—'}</span></div>`).join('')}</div>
    <div class="row" style="justify-content:center; margin-top:20px;"><button class="btn" id="home">Back to Home</button></div>`;
  $('#home').addEventListener('click', () => go(() => renderTab('home')));
}

// ---------- Answer templates ----------
const TEMPLATES = {
  w51: {
    ko: '글의 목적 파악 → 빈칸 앞뒤 확인 → 높임 수준 맞추기 → 한 문장으로',
    steps: [
      ['Find the purpose', 'Who is writing to whom, and why? (초대, 부탁, 안내, 감사, 사과)'],
      ['Read right after each blank', 'The next word decides the form: "?" needs a question, "-(으)니까" a reason, "그래서" a cause before it.'],
      ['Match the politeness', 'A notice or email uses -습니다/-(으)ㅂ니다; a text to a friend may use -아/어요.'],
      ['Write one complete sentence', 'Use the text\'s own words where you can. No extra details.']
    ],
    phrases: [
      ['Asking', '-아/어 주시기 바랍니다 / -아/어 주실 수 있을까요? / -(으)면 좋겠습니다'],
      ['Informing', '-기로 했습니다 / -게 되었습니다 / -(으)니 참고하시기 바랍니다'],
      ['Reasons', '-기 때문입니다 / -아/어서 -지 못했습니다'],
      ['Apologizing, thanking', '-아/어서 죄송합니다 / -아/어 주셔서 감사합니다']
    ],
    tips: ['A blank is usually one clause of 10 to 25 characters.', 'An answer with the right idea but the wrong politeness level loses points.', 'Spend about 5 minutes on 51 and 52 together, then move on.']
  },
  w52: {
    ko: '주제 파악 → 빈칸 앞 접속 표현 → 문어체(-다) → 앞 문장의 핵심어 활용',
    steps: [
      ['Find the topic', 'The first sentence usually states the general idea.'],
      ['Follow the connector', '그러나 → the opposite; 따라서/그래서 → a result; 즉/다시 말해 → the same idea restated; 예를 들어 → a case.'],
      ['Use written style', 'End with -ㄴ다/-는다/-다, like the rest of the paragraph. Never -아/어요.'],
      ['Reuse key words', 'Echo nouns from nearby sentences so the clause connects.']
    ],
    phrases: [
      ['Explaining', '-기 때문이다 / -는 것이다 / -(으)ㄹ 수 있다'],
      ['Advising', '-는 것이 좋다 / -아/어야 한다 / -지 않도록 해야 한다'],
      ['Contrasting', '-는 반면에 / -와/과 달리']
    ],
    tips: ['Read the sentence after the blank too: it often repeats or explains the missing idea.', 'Short and accurate beats long and risky.']
  },
  w53: {
    ko: '도입(조사 소개) → 결과 1 → 결과 2(비교·변화) → 원인·전망 · 200~300자 · 제목 쓰지 않기',
    steps: [
      ['Introduce the survey (1 sentence)', '○○에서 20대 이상 성인 500명을 대상으로 ‘…’에 대해 조사하였다.'],
      ['Main result', '그 결과 ‘…’이/가 45%로 가장 높게 나타났으며, 그 다음으로 ‘…’이/가 30%로 뒤를 이었다.'],
      ['Comparison or change', '…은/는 2010년 …에서 2020년 …(으)로 두 배 이상 증가하였다. / 반면 …은/는 감소하였다.'],
      ['Reasons or outlook (if given)', '이러한 변화의 원인으로는 …을/를 들 수 있다. / 앞으로 …(으)ㄹ 것으로 전망된다.']
    ],
    phrases: [
      ['Rising, falling', '증가하다, 늘어나다, 상승하다 / 감소하다, 줄어들다, 하락하다'],
      ['Ranking', '가장 높게(많이) 나타났다, 그 뒤를 이었다, 가장 낮았다'],
      ['Comparing', '…에 비해, …보다 …배 많았다, …와/과 달리'],
      ['Share', '…이/가 …%를 차지하였다, …(으)로 조사되었다']
    ],
    tips: ['Describe every number given, but add no opinion of your own.', 'Written -다 style only; no title.', 'Aim for 230 to 280 characters, and spend about 10 to 15 minutes.']
  },
  w54: {
    ko: '서론(화제 + 질문 1) → 본론(질문 2·3) → 결론(정리·주장) · 600~700자',
    steps: [
      ['Introduction: question 1', 'Introduce the issue in your own words, then answer the first question. 최근 …에 대한 관심이 높아지고 있다. …이/가 필요한 이유는 …기 때문이다.'],
      ['Body: question 2', 'One paragraph. 그러나 …에는 몇 가지 문제점이 있다. 첫째, … 둘째, …'],
      ['Body: question 3', 'One paragraph. 이러한 문제를 해결하기 위해서는 …아/어야 한다.'],
      ['Conclusion', 'Sum up and restate your view. 따라서 …(으)ㄹ 필요가 있다고 생각한다.']
    ],
    phrases: [
      ['Introducing', '…은/는 우리 사회의 중요한 문제로 떠오르고 있다'],
      ['Ordering points', '첫째, 둘째, 마지막으로 / 또한, 게다가'],
      ['Arguing', '-다고 생각한다, -아/어야 할 것이다, -는 것이 바람직하다'],
      ['Conceding', '물론 …는 측면도 있다. 그러나 …']
    ],
    tips: ['Answer all three questions, in order, one paragraph each.', 'Written -다 style throughout: no -아/어요, no -습니다, no spoken forms like 근데 or 너무.', 'Don\'t copy the prompt\'s sentences. Spend about 5 minutes planning and keep 3 minutes to check.']
  },
  retell: {
    ko: '주제 → 핵심 내용 → 예 → 화자의 생각',
    steps: [
      ['Topic', '이 강연은 …에 대한 내용이다.'],
      ['Main points', '화자는 먼저 …다고 설명한다. 또한 …'],
      ['Example', '예를 들어 …'],
      ['Speaker\'s view', '화자는 …아/어야 한다고 주장한다. / 화자는 …에 대해 우려하고 있다.']
    ],
    phrases: [], tips: []
  }
};
function templateHtml(kind, open = false) {
  const t = TEMPLATES[kind]; if (!t) return '';
  return `<details class="tmpl"${open ? ' open' : ''}><summary>📝 Answer template</summary>
    <p class="hint" lang="ko" style="margin:8px 0 0;">${t.ko}</p>
    <ol class="tmpl-steps">${t.steps.map(([h, ex]) => `<li><b>${esc(h)}</b><br><span lang="ko">${esc(ex)}</span></li>`).join('')}</ol>
    ${t.phrases.length ? `<div class="lbl">Useful expressions</div><div class="tmpl-phrases">${t.phrases.map(([h, ex]) => `<div><b>${esc(h)}:</b> <span lang="ko">${esc(ex)}</span></div>`).join('')}</div>` : ''}
    ${t.tips.length ? `<div class="lbl" style="margin-top:10px;">Tips</div><ul class="tmpl-tips">${t.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </details>`;
}

// ---------- Practice tests: full timed sections in TOPIK question order ----------
// Each part is one page: a group of short items (n of them) or one longer
// recording or passage. Question numbers match the real test. Listening
// skips questions 1-3, which use pictures. In Reading and Writing you can go
// back to earlier parts, as on paper; in Listening each recording plays once.
const pairs = (task, from, count, q) => Array.from({ length: count }, (_, k) => ({ task, from: from + k * q, q }));
const TEST_PLANS = {
  ltest: { section: 'Listening', tab: 'listening', back: false, parts: [
    { task: 'lnext', n: 5, from: 4 }, { task: 'laction', n: 4, from: 9 }, { task: 'lmatch', n: 4, from: 13 }, { task: 'lcentral', n: 4, from: 17 },
    ...pairs('lpair', 21, 15, 2)] },
  rtest: { section: 'Reading', tab: 'reading', back: true, minutes: 70, parts: [
    { task: 'rgram', n: 4, from: 1 }, { task: 'rtopic', n: 4, from: 5 }, { task: 'rmatch', n: 4, from: 9 }, { task: 'rorder', n: 3, from: 13 }, { task: 'rblank', n: 3, from: 16 },
    ...pairs('rpair', 19, 3, 2), { task: 'rhead', n: 3, from: 25 }, { task: 'rblank', n: 4, from: 28 }, { task: 'rmatch', n: 3, from: 32 }, { task: 'rmain', n: 4, from: 35 },
    { task: 'rinsert', n: 3, from: 39 }, ...pairs('rpair', 42, 3, 2), { task: 'rpair', from: 48, q: 3 }] },
  wtest: { section: 'Writing', tab: 'writing', back: true, minutes: 50, parts: [{ task: 'w51', from: 51 }, { task: 'w52', from: 52 }, { task: 'w53', from: 53 }, { task: 'w54', from: 54 }] }
};
let TEST = null;
let TEST_USED = store.get('topik2-testused', {});
const useKey = (task, title, qi) => `${task}|${title}${qi != null ? '|' + qi : ''}`;
// Pick the least-used content, never repeating within one test.
function pickTestSets(planId) {
  const taken = new Set();
  const least = cands => { const m = Math.min(...cands.map(c => TEST_USED[c.key] || 0)); return shuffle(cands.filter(c => (TEST_USED[c.key] || 0) === m)); };
  return TEST_PLANS[planId].parts.map(p => {
    if (p.n) {
      const all = pool(p.task).flatMap(set => set.items.map((x, qi) => ({ key: useKey(p.task, set.title, qi), set, qi, x }))).filter(c => !taken.has(c.key));
      const chosen = least(all).slice(0, p.n);
      if (chosen.length < p.n) chosen.push(...shuffle(all.filter(c => !chosen.includes(c))).slice(0, p.n - chosen.length));
      chosen.forEach(c => taken.add(c.key));
      return Object.assign({}, p, { picks: chosen });
    }
    let cands = pool(p.task).map(set => ({ key: useKey(p.task, set.title), set })).filter(c => !taken.has(c.key));
    if (p.q) { const exact = cands.filter(c => c.set.questions.length === p.q); if (exact.length) cands = exact; }
    if (!cands.length) cands = pool(p.task).map(set => ({ key: useKey(p.task, set.title), set }));
    const c = least(cands)[0]; taken.add(c.key);
    return Object.assign({}, p, { key: c.key, item: c.set });
  });
}
const partQs = p => p.picks ? p.picks.map(c => itemQuestion(p.task, c.x)) : p.item.questions || [];
const partCount = p => TASKS[p.task].writing ? 1 : partQs(p).length;
const partLabel = p => { const n = partCount(p); return n > 1 ? `${p.from}–${p.from + n - 1}` : `${p.from}`; };
const syl = s => s.replace(/\s+/g, '').length;
function audioSecs(p) {
  const lines = p.picks ? p.picks.flatMap(c => c.x.lines) : p.item.lines || [];
  return lines.reduce((n, l) => n + syl(l.t), 0) / 6.5 / (SETTINGS.rate || 1) + (p.picks ? p.picks.length : 1) * 3;
}
function testSecs(planId, parts) {
  const plan = TEST_PLANS[planId];
  if (plan.minutes) return plan.minutes * 60;
  return Math.round(parts.reduce((n, p) => n + audioSecs(p) + partCount(p) * 15, 0));
}
const fmtMin = s => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const sectionKo = { Listening: '듣기', Reading: '읽기', Writing: '쓰기' };

function openTest(planId) {
  enterSub();
  const plan = TEST_PLANS[planId];
  currentTab = plan.tab; paintTabbar();
  setHeader(`${sectionKo[plan.section]} practice test`, true);
  const parts = pickTestSets(planId);
  const q = parts.reduce((n, p) => n + partCount(p), 0), secs = testSecs(planId, parts);
  const hist = (HIST[planId] || []);
  const last = hist[hist.length - 1];
  const writing = planId === 'wtest';
  stage.innerHTML = `<h1>${sectionKo[plan.section]} ${plan.section} practice test</h1>
    <p class="task-how">${writing ? 'Questions 51 to 54 in 50 minutes, like the real test. Move between questions freely. At the end you see model answers, and Claude can score all four.'
      : planId === 'ltest' ? 'Questions 4 to 50 in test order (1 to 3 use pictures and are left out). Each recording plays <b>once</b>; read the questions before you press play, as the booklet allows. You can\'t go back to earlier parts.'
      : 'All 50 questions in test order, in 70 minutes. You can move back and forth between parts, as on paper. Your score and explanations come at the end.'}</p>
    <div class="stat-row"><div class="stat"><b>${q}</b><span>${writing ? 'questions' : `questions in ${parts.length} parts`}</span></div><div class="stat"><b>${Math.ceil(secs / 60)}</b><span>minutes</span></div></div>
    <div class="score-list">${parts.map(p => `<div><span>${partLabel(p)}. ${esc(TASKS[p.task].name)}</span><span>${writing ? TASKS[p.task].max + '점' : partCount(p) + ' q'}</span></div>`).join('')}</div>
    <p class="hint">${writing ? 'Keep about 5 minutes for 51 and 52 together, 10 to 15 for 53, and the rest for 54.' : 'Each question is worth 2 points in the real test, so the score shown is out of 100.'}${last ? ` Your last result: ${Math.round(last.v * 100)} / 100 on ${new Date(last.t).toLocaleDateString()}.` : ''}</p>
    ${planId === 'ltest' ? '<p class="hint">Use headphones and keep the screen on. Taking notes on paper is fine.</p>' : ''}
    <div class="row" style="justify-content:center; margin-top:12px;"><button class="btn" id="startTest">Start the test</button></div>`;
  $('#startTest').addEventListener('click', () => startTest(planId, parts, secs));
}

function startTest(planId, parts, secs) {
  const plan = TEST_PLANS[planId];
  TEST = { planId, plan, parts, i: 0, answers: [], left: Math.round(secs), total: Math.round(secs), running: true, timer: null };
  document.body.classList.add('in-test');
  if (planId === 'ltest') keepAwake(true);
  TEST.timer = setInterval(() => {
    if (!TEST || !TEST.running) return;
    TEST.left--;
    const tm = $('#testClock'); if (tm) { tm.textContent = fmtMin(Math.max(0, TEST.left)); tm.classList.toggle('out', TEST.left <= 60); }
    if (TEST.left <= 0) { toast("Time's up. Your test has been submitted."); finishTest(); }
  }, 1000);
  onLeave(() => endTestState());
  renderTestPart();
}
function endTestState() {
  if (!TEST) return;
  clearInterval(TEST.timer); TEST.running = false;
  document.body.classList.remove('in-test');
}
function testUnanswered() {
  const p = TEST.parts[TEST.i], box = $('#testPart'); if (!box) return 0;
  if (TASKS[p.task].writing) return $$('input, textarea', box).filter(x => !x.value.trim()).length;
  const groups = new Set($$('input[type=radio]', box).map(x => x.name));
  return [...groups].filter(n => !$(`input[name="${n}"]:checked`, box)).length;
}
function paintTestBar() {
  const left = $('#testLeft'); if (!left) return;
  const u = testUnanswered();
  left.textContent = u ? `${u} unanswered` : 'All answered';
}
function renderTestPart() {
  const p = TEST.parts[TEST.i], t = TASKS[p.task], last = TEST.i === TEST.parts.length - 1, plan = TEST.plan;
  setHeader(`${sectionKo[plan.section]} test · ${partLabel(p)}`, true);
  const hdr = $('.sticky-header'); if (hdr) document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');
  useWide(p.task === 'rpair');
  stage.innerHTML = `
    <div class="test-bar"><span><b>${partLabel(p)}</b> · <span id="testLeft"></span></span><span class="timer" id="testClock">${fmtMin(TEST.left)}</span></div>
    <p class="topik-ko" lang="ko">※ [${partLabel(p).replace('–', '~')}] ${esc(t.ko)}</p>
    <div id="testPart"></div>
    <div class="check-bar"><span class="answered">Part ${TEST.i + 1} of ${TEST.parts.length}</span>${plan.back && TEST.i ? '<button class="btn ghost" id="testPrev">◀ Back</button>' : ''}<button class="btn" id="testNext">${last ? 'Finish test' : 'Next ▶'}</button></div>`;
  const box = $('#testPart'), saved = TEST.answers[TEST.i];
  const mcq = (qs, pfx) => mcqHtml(qs.map(q => ({ q: q.q, qHtml: q.qHtml, options: q.options })), pfx, p.from);
  if (p.picks) {
    box.innerHTML = p.picks.map((c, i) => `<div class="resp-item">${itemCtxHtml(p.task, c.x, i, 'tp')}${mcqHtml([(q => ({ q: q.q, qHtml: q.qHtml, options: q.options }))(itemQuestion(p.task, c.x))], 'tq' + i, p.from + i)}</div>`).join('');
    mountItemPlayers(p.task, p.picks.map(c => c.x), box, 'tp', { start: p.from, player: { once: true } });
  } else if (p.task === 'lpair') {
    box.innerHTML = `<div class="player" id="tpl"></div>${mcq(p.item.questions, 'tq')}`;
    mountPlayer($('#tpl'), p.item.lines, { label: '▶ Play the recording (once)', once: true });
  } else if (p.task === 'rpair') {
    box.innerHTML = `<div class="split"><div class="split-left"><div class="passage" tabindex="0">${passageHtml(p.item)}</div></div><div class="split-right">${mcq(p.item.questions, 'tq')}</div></div>`;
  } else if (p.task === 'w51' || p.task === 'w52') {
    box.innerHTML = `<div class="prompt-box" lang="ko">${p.item.kind ? `<span class="kind">${esc(p.item.kind)}</span>` : ''}${gapText(p.item.text)}</div>
      <label class="lbl" for="ga">㉠</label><input id="ga" class="field-in" lang="ko" autocomplete="off" spellcheck="false">
      <label class="lbl" for="gb" style="margin-top:12px;">㉡</label><input id="gb" class="field-in" lang="ko" autocomplete="off" spellcheck="false">`;
    if (saved) { $('#ga').value = saved.a || ''; $('#gb').value = saved.b || ''; }
  } else if (t.writing) {
    const [lo, hi] = t.chars;
    box.innerHTML = `<div class="prompt-box" lang="ko">${p.task === 'w53' ? w53PromptHtml(p.item) : w54PromptHtml(p.item)}</div>
      <textarea class="write" id="ta" lang="ko" spellcheck="false" placeholder="여기에 쓰십시오…"></textarea>
      <div class="write-bar"><span id="cc">0자</span><span>${lo}–${hi}자</span></div>`;
    const ta = $('#ta'), cc = $('#cc');
    const upd = () => { const n = charCount(ta.value); cc.textContent = `${n}자`; cc.className = n === 0 ? '' : n < lo ? 'cc-low' : n > hi ? 'cc-high' : 'cc-ok'; };
    if (saved) ta.value = saved; upd(); ta.addEventListener('input', upd);
  }
  // Restore earlier choices when coming back to a part.
  if (saved && !t.writing) saved.forEach((v, i) => { if (v == null) return; const name = p.picks ? `tq${i}-0` : `tq-${i}`; const r = $(`input[name="${name}"][value="${v}"]`, box); if (r) r.checked = true; });
  box.addEventListener('change', paintTestBar); box.addEventListener('input', paintTestBar);
  paintTestBar();
  const pv = $('#testPrev'); if (pv) pv.addEventListener('click', () => { collectTestPart(); TEST.i--; renderTestPart(); window.scrollTo(0, 0); });
  $('#testNext').addEventListener('click', () => {
    const u = testUnanswered();
    const go2 = () => { collectTestPart(); if (last) finishTest(); else { stopSpeech(); TEST.i++; renderTestPart(); window.scrollTo(0, 0); } };
    if (u && (last || !plan.back)) showConfirm(`${u} question${u > 1 ? 's' : ''} unanswered`, last ? 'Finish the test anyway?' : "You can't come back to this part. Continue anyway?", last ? 'Finish test' : 'Next part', go2);
    else go2();
  });
}
function collectTestPart() {
  const p = TEST.parts[TEST.i], box = $('#testPart');
  if (!box) return;
  if (p.task === 'w51' || p.task === 'w52') TEST.answers[TEST.i] = { a: $('#ga', box).value.trim(), b: $('#gb', box).value.trim() };
  else if (TASKS[p.task].writing) TEST.answers[TEST.i] = $('#ta', box).value.trim();
  else if (p.picks) TEST.answers[TEST.i] = p.picks.map((_, i) => { const c = $(`input[name="tq${i}-0"]:checked`, box); return c ? +c.value : null; });
  else TEST.answers[TEST.i] = p.item.questions.map((_, i) => { const c = $(`input[name="tq-${i}"]:checked`, box); return c ? +c.value : null; });
}
function gradeTestPart(p, ans) {
  ans = ans || [];
  return partQs(p).map((q, i) => ({ q: q.q, yours: ans[i] != null ? q.options[ans[i]] : '', right: q.options[q.answer], ok: ans[i] === q.answer, why: q.why, n: p.from + i, qi: i }));
}
function finishTest() {
  if (!TEST || !TEST.running) return;
  collectTestPart(); stopSpeech();
  const { planId, plan, parts } = TEST;
  const used = TEST.total - Math.max(0, TEST.left);
  endTestState(); keepAwake(false); useWide(false);
  parts.forEach(p => { (p.picks || [p]).forEach(c => { TEST_USED[c.key] = (TEST_USED[c.key] || 0) + 1; }); });
  store.set('topik2-testused', TEST_USED);
  if (typeof markStudyDay === 'function') markStudyDay();
  const answers = TEST.answers, total = TEST.total;
  TEST = null;
  if (planId === 'wtest') return finishWritingTest(parts, answers, used, total);
  const graded = parts.map((p, i) => ({ p, rows: gradeTestPart(p, answers[i]) }));
  const right = graded.reduce((n, g) => n + g.rows.filter(r => r.ok).length, 0);
  const count = graded.reduce((n, g) => n + g.rows.length, 0);
  const pct = count ? right / count : 0, score = Math.round(pct * 100);
  // Save: overall test result, each part toward its task's stats, mistakes.
  graded.forEach(({ p, rows }) => {
    recordQuiet(p.task, rows.filter(r => r.ok).length, rows.length);
    rows.forEach((r, i) => p.picks ? noteResult(p.task, p.picks[i].set, p.picks[i].qi, r.ok) : noteResult(p.task, p.item, i, r.ok));
  });
  recordQuiet(planId, right, count);
  buzz(pct >= 0.8 ? 25 : [25, 70, 25]);
  const byTask = {};
  graded.forEach(({ p, rows }) => { const b = byTask[p.task] = byTask[p.task] || { r: 0, t: 0 }; b.r += rows.filter(r => r.ok).length; b.t += rows.length; });
  const lv = levelOf(score * 3);
  setHeader(`${sectionKo[plan.section]} test results`, true);
  stage.innerHTML = `<h1>${sectionKo[plan.section]} ${plan.section} results</h1>
    <div class="result">${stampHtml(right, count)}</div>
    <div class="stat-row" style="margin-top:14px;">
      <div class="stat"><b>${score}</b><span>estimated score out of 100${planId === 'ltest' ? ' (scaled from 47 questions)' : ''}</span></div>
      <div class="stat"><b>${fmtMin(used)}</b><span>time used of ${fmtMin(total)}</span></div></div>
    <p class="hint">If your other sections matched this one, your total would be about ${score * 3} of 300: ${lv ? `<b>${lv}급</b>` : 'below 3급'}. A rough practice estimate, not an official score.</p>
    <h3>By question type</h3>
    <div class="score-list">${Object.entries(byTask).map(([k, v]) => `<div><span>${esc(TASKS[k].name)}</span><span>${v.r}/${v.t} (${Math.round(100 * v.r / v.t)}%)</span></div>`).join('')}</div>
    <h3 style="margin-top:22px;">Review every question</h3>
    ${graded.map(({ p, rows }) => {
      const r = rows.filter(x => x.ok).length;
      const lines = p.picks ? null : p.item.lines;
      return `<details class="test-review"${r < rows.length ? ' open' : ''}><summary><b>${partLabel(p)}. ${esc(TASKS[p.task].name)}</b> <span class="badge ${r === rows.length ? 'on' : ''}">${r}/${rows.length}</span></summary>
        ${lines ? transcriptHtml(lines) : ''}
        ${p.task === 'rpair' ? `<details class="transcript"><summary>Passage</summary>${passageHtml(p.item)}</details>` : ''}
        ${rows.map(x => {
          const c = p.picks && p.picks[x.qi];
          const ctx = c ? (c.x.lines ? transcriptHtml(c.x.lines) : itemCtxHtml(p.task, c.x, x.qi, 'rv')) : '';
          const item = c ? c.set : p.item, qi = c ? c.qi : x.qi;
          return `<div class="corr">
          ${ctx}
          <div><b>${x.n}.</b> ${p.task === 'rgram' ? fmtInline(x.q) : esc(x.q)}</div>
          ${x.ok ? `<span class="n">✓ ${esc(x.right)}</span>` : `<span class="o">${x.yours ? esc(x.yours) : '(no answer)'}</span> → <span class="n">${esc(x.right)}</span>`}
          ${x.why ? `<div class="w">${esc(x.why)}</div>` : ''}
          ${x.ok ? '' : `<div class="ask-row">${askBtnHtml(explainPrompt(p.task, item, reviewQuestion(p.task, item, qi), x.yours, qi), 'Ask Claude why ↗', 'btn ghost small')}</div>`}</div>`;
        }).join('')}
      </details>`;
    }).join('')}
    <div class="row" style="justify-content:center; margin-top:20px;"><button class="btn ghost" id="again">Take another test</button><button class="btn" id="back">Back to ${sectionKo[plan.section]}</button></div>`;
  $('#again').addEventListener('click', () => go(() => openTest(planId)));
  $('#back').addEventListener('click', goBack);
  window.scrollTo(0, 0);
}
// Writing results: model answers, then Claude scores all four questions (in
// the app with an API key, or on claude.ai). The total out of 100 feeds the
// level estimate on Home.
function finishWritingTest(parts, answers, used, total) {
  setHeader('쓰기 test results', true);
  const ansOf = i => answers[i] || (parts[i].task === 'w51' || parts[i].task === 'w52' ? { a: '', b: '' } : '');
  const combined = `You are an experienced, fair TOPIK II writing rater. Below are my answers to TOPIK II writing questions 51 to 54, written in 50 minutes. Score each question on the TOPIK rubric and give a total out of 100.
- 51 and 52 (10 points each): each blank is worth 5; it must fit the context, connect grammatically, and match the style (polite -습니다 for 51 notices or emails, written -다 for 52).
- 53 (30 points): 내용 및 과제 수행 about 7, 글의 전개 구조 about 7, 언어 사용 about 16; 200-300 characters, -다 style, no title, no personal opinion.
- 54 (50 points): 내용 about 12, 구조 about 12, 언어 사용 about 26; 600-700 characters, -다 style, answers all three guiding questions.

${parts.map((p, i) => `=== Question ${p.from} ===\n${writingTaskText(p.task, p.item)}\n\nMY ANSWER${typeof ansOf(i) === 'string' ? ` (${charCount(ansOf(i))} characters)` : ''}:\n${answerText(p.task, ansOf(i))}`).join('\n\n')}

Please give me: a score for each question and the total out of 100, two strengths, the three changes that would raise my score most, and corrections of my biggest Korean errors (original → better, with a reason).${fbLang()}`;
  stage.innerHTML = `<h1>쓰기 Writing results</h1>
    <div class="stat-row"><div class="stat"><b>${fmtMin(used)}</b><span>time used of ${fmtMin(total)}</span></div><div class="stat"><b id="wTotal">—</b><span>score out of 100</span></div></div>
    <div class="row"><button class="btn ai-only" id="scoreAll">Score all four with Claude</button>${askBtnHtml(combined, 'Score all in Claude ↗')}</div>
    <div class="row" style="margin-top:10px;"><label class="hint" for="selfScore">Scored on claude.ai? Enter the total to track it:</label><input id="selfScore" class="field-in" style="width:6em;" inputmode="numeric" placeholder="0–100"><button class="btn ghost small" id="saveScore">Save</button></div>
    <div id="wOut"></div>
    ${parts.map((p, i) => `<details class="test-review" open><summary><b>${p.from}. ${esc(TASKS[p.task].name)}</b> <span class="badge">${TASKS[p.task].max}점</span></summary>
      <div class="lbl" style="margin-top:10px;">Your answer${typeof ansOf(i) === 'string' ? ` (${charCount(ansOf(i))}자)` : ''}</div>
      <div class="model" lang="ko">${esc(answerText(p.task, ansOf(i))) || '(blank)'}</div>
      <div class="lbl" style="margin-top:10px;">Model answer</div>
      <div class="model" lang="ko">${esc(p.task === 'w51' || p.task === 'w52' ? `㉠ ${p.item.model.a}\n㉡ ${p.item.model.b}` : p.item.model)}</div>
      <div data-wfb="${i}"></div></details>`).join('')}
    <div class="row" style="justify-content:center; margin-top:20px;"><button class="btn ghost" id="again">Take another test</button><button class="btn" id="back">Back to 쓰기</button></div>`;
  const saveTotal = n => { recordQuiet('wtest', n, 100); $('#wTotal').textContent = n; };
  $('#saveScore').addEventListener('click', () => { const n = Math.round(+$('#selfScore').value); if (!(n >= 0 && n <= 100)) { toast('Enter a number from 0 to 100.'); return; } saveTotal(n); toast('Saved. It now counts toward your level estimate.'); });
  const sa = $('#scoreAll');
  sa.addEventListener('click', async () => {
    sa.disabled = true; $('#wOut').innerHTML = '<p class="thinking">Claude is scoring your four answers…</p>';
    const ctl = new AbortController(); onLeave(() => ctl.abort());
    let sum = 0, okAll = true;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], a = ansOf(i), box = $(`[data-wfb="${i}"]`);
      const empty = typeof a === 'string' ? !a.trim() : !a.a && !a.b;
      if (empty) { box.innerHTML = '<p class="hint">Blank: 0 points.</p>'; continue; }
      try {
        const fb = await sample.json(scorePrompt(p.task, p.item, a, true), { signal: ctl.signal });
        if (typeof fb.score === 'number') { sum += fb.score; setLast(p.task, fb.score, TASKS[p.task].max); }
        box.innerHTML = `<div class="fb">${feedbackHtml(fb, TASKS[p.task].max)}</div>`;
      } catch (err) { okAll = false; const m = aiErrorText(err); box.innerHTML = m ? `<div class="notice err">${esc(m)}</div>` : ''; }
    }
    if (okAll) { saveTotal(Math.round(sum)); $('#wOut').innerHTML = `<p class="hint">Total: <b>${Math.round(sum)} / 100</b>, estimated by Claude. Feedback for each question is below.</p>`; }
    else { $('#wOut').innerHTML = '<p class="hint">Some answers couldn\'t be scored. Try again.</p>'; sa.disabled = false; }
  });
  $('#again').addEventListener('click', () => go(() => openTest('wtest')));
  $('#back').addEventListener('click', goBack);
  window.scrollTo(0, 0);
}
function recordQuiet(id, pts, tot) {
  const s = STATS[id] || { sets: 0, pts: 0, tot: 0 };
  s.sets++; s.pts += pts; s.tot += tot; STATS[id] = s; store.set('topik2-stats', STATS);
  if (tot) pushHist(id, pts / tot);
}
function showConfirm(title, body, okLabel, onOk, cancelLabel = 'Stay') {
  const ov = document.createElement('div'); ov.className = 'welcome'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="welcome-card"><h2 class="w-title">${esc(title)}</h2><div class="w-body"><p>${esc(body)}</p></div>
    <div class="w-nav"><button class="btn ghost" data-c="no">${esc(cancelLabel)}</button><button class="btn" data-c="ok">${esc(okLabel)}</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  $('[data-c=no]', ov).addEventListener('click', close);
  $('[data-c=ok]', ov).addEventListener('click', () => { close(); onOk(); });
  $('[data-c=no]', ov).focus();
}

// ---------- Ask Claude on claude.ai (no API key needed) ----------
// Copies a ready-made prompt and opens claude.ai, prefilled where supported.
// Uses the learner's own claude.ai subscription.
const ASK = {}; let askSeq = 0;
function askBtnHtml(prompt, label = 'Score in Claude ↗', cls = 'btn ghost') {
  const k = 'a' + (++askSeq); ASK[k] = prompt;
  return `<button class="${cls}" data-ask="${k}">${esc(label)}</button>`;
}
function askClaude(prompt, btn) {
  let copied = null;
  try { copied = navigator.clipboard && navigator.clipboard.writeText(prompt); } catch (e) { copied = null; }
  const url = 'https://claude.ai/new' + (prompt.length < 4000 ? '?q=' + encodeURIComponent(prompt) : '');
  try { window.open(url, '_blank', 'noopener'); } catch (e) { }
  const host = btn.closest('.row') || btn.parentElement;
  const note = document.createElement('div'); note.className = 'notice info ask-note';
  const showFallback = () => {
    note.innerHTML = `Copy this prompt, then paste it into a new chat on <b>claude.ai</b>:<textarea class="write" readonly style="min-height:120px; margin-top:8px; font-size:13px;"></textarea>`;
    const ta = $('textarea', note); ta.value = prompt; ta.addEventListener('focus', () => ta.select());
  };
  $$('.ask-note', host.parentElement).forEach(n => n.remove());
  host.insertAdjacentElement('afterend', note);
  if (copied && copied.then) {
    note.innerHTML = '<b>Copied.</b> claude.ai is opening. If the message box is empty, paste the prompt (long-press → Paste) and send.';
    copied.catch(showFallback);
  } else showFallback();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ask]'); if (!b || !ASK[b.dataset.ask]) return;
  askClaude(ASK[b.dataset.ask], b);
});
const linesText = ls => ls.map(l => `${l.name || '화자'}: ${l.t}`).join('\n');
function itemContext(task, item, qi) {
  if (!item) return '';
  const x = item.items && qi != null ? item.items[qi] : null;
  if (x && task !== 'vic') {
    if (x.lines) return linesText(x.lines);
    if (x.sents) return x.sents.join('\n');
    if (x.given) return `주어진 문장: ${x.given}\n\n${x.text}`;
    return x.text || '';
  }
  if (task === 'vic' && x) return x.text.replace(/\{\{|\}\}|\[\[|\]\]/g, '');
  if (item.text && task !== 'trans') return item.text;
  if (item.paras) return `${item.title}\n\n${item.paras.join('\n\n')}`;
  if (item.lines) return linesText(item.lines);
  return '';
}
function explainPrompt(task, item, q, mine, qi) {
  const ctx = itemContext(task, item, qi).slice(0, 5000);
  const listening = /Listening/.test((TASKS[task] || {}).section || '');
  const opts = q.options ? q.options.map((o, i) => `${CIRCLED[i]} ${o}`).join('\n') : '';
  return `I'm practicing for TOPIK II${TASKS[task] && TASKS[task].nums ? ` (questions ${TASKS[task].nums}, "${TASKS[task].name}")` : ''}. I got this question wrong. Please explain why the correct answer is right and why my answer is wrong, point to the exact words in the ${listening ? 'transcript' : 'text'} that decide it, explain any grammar or vocabulary I may have missed, and give me one tip for questions like this.${fbLang()}
${ctx ? `\n${listening ? 'TRANSCRIPT' : 'TEXT'}\n${ctx}\n` : ''}
QUESTION
${q.q || '알맞은 것을 고르십시오.'}
${opts ? `\nOPTIONS\n${opts}\n` : ''}
MY ANSWER: ${mine || '(no answer)'}
CORRECT ANSWER: ${q.options ? q.options[q.answer] : q.right}`;
}

// ---------- Mistake review ----------
// Every missed question returns after 1 day, then 3, then 7. Each correct
// review moves it to the next step; a miss starts it over. After three
// correct reviews it's cleared.
const MISTAKE_DAYS = { 1: 1, 2: 3, 3: 7 };
let MISTAKES = store.get('topik2-mistakes', {});
const saveMistakes = () => store.set('topik2-mistakes', MISTAKES);
const ITEM_TASKS = ['lnext', 'laction', 'lmatch', 'lcentral', 'rgram', 'rtopic', 'rmatch', 'rorder', 'rblank', 'rhead', 'rmain', 'rinsert'];
const REVIEWABLE = [...ITEM_TASKS, 'lpair', 'rpair', 'skim', 'trans', 'vic', 'notes'];
function noteResult(task, item, qi, ok) {
  if (!REVIEWABLE.includes(task) || !item || !item.title) return;
  const key = `${task}|${item.title}|${qi}`, m = MISTAKES[key];
  if (!ok) MISTAKES[key] = { task, title: item.title, qi, box: 1, due: addDays(1), n: (m ? m.n : 0) + 1 };
  else if (m && m.due <= dayStr()) advanceMistake(key);
  saveMistakes();
}
function advanceMistake(key) {
  const m = MISTAKES[key]; if (!m) return;
  m.box++;
  if (m.box > 3) delete MISTAKES[key]; else m.due = addDays(MISTAKE_DAYS[m.box]);
}
function findMistake(m) {
  const item = (pool(m.task) || []).find(x => x.title === m.title);
  if (!item) return null;
  const q = reviewQuestion(m.task, item, m.qi);
  return q ? { item, q } : null;
}
function reviewQuestion(task, item, qi) {
  if (ITEM_TASKS.includes(task)) { const x = item.items[qi]; return x && itemQuestion(task, x); }
  if (task === 'vic') { const x = item.items[qi]; return x && { q: '굵은 단어의 뜻으로 가장 알맞은 것은?', options: x.options, answer: x.answer, why: x.why }; }
  if (task === 'trans') return item.predict && item.predict[qi];
  return item.questions && item.questions[qi];
}
function dueMistakes() {
  const t = dayStr();
  Object.keys(MISTAKES).forEach(k => { if (!findMistake(MISTAKES[k])) delete MISTAKES[k]; });
  return Object.entries(MISTAKES).filter(([, m]) => m.due <= t).map(([key, m]) => Object.assign({ key }, m));
}
function runMistakes(list, opts = {}) {
  if (!opts.daily) enterSub();
  let i = 0, right = 0; const missed = [];
  if (!list.length) { setHeader('Mistake review', true); stage.innerHTML = '<p class="sub">No mistakes are due for review. Nice work.</p>'; return; }
  const card = () => {
    const m = list[i], f = findMistake(m);
    if (!f) { i++; return i < list.length ? card() : done(); }
    const { item, q } = f, t = m.task;
    const x = item.items ? item.items[m.qi] : null;
    setHeader(opts.daily ? dailyTitle() : `Mistake review · ${i + 1}/${list.length}`, true);
    let ctx = '';
    if (ITEM_TASKS.includes(t)) ctx = itemCtxHtml(t, x, 0, 'mr');
    else if (t === 'rpair') ctx = `<details class="guide" open><summary>📄 Passage</summary><div class="passage" style="margin:10px 0 0;">${passageHtml(item)}</div></details>`;
    else if (t === 'skim') ctx = `<details class="guide" open><summary>📄 ${esc(item.title)}</summary><div class="passage" style="margin:10px 0 0;">${item.paras.map((p, k) => `<p><span class="pnum">¶${k + 1}</span>${esc(p)}</p>`).join('')}</div></details>`;
    else if (t === 'vic') ctx = `<p class="vic-text" lang="ko">${esc(x.text).replace(/\{\{(.+?)\}\}/, '<b class="target">$1</b>').replace(/\[\[(.+?)\]\]/, '$1')}</p>`;
    else if (item.lines) ctx = `<div class="player" id="mp"></div>`;
    stage.innerHTML = `<div class="pbar static" aria-hidden="true"><i style="width:${Math.round(100 * i / list.length)}%"></i></div>
      <div class="w-eyebrow">${esc(TASKS[t].name)} · ${esc(item.title)}${m.n > 1 ? ` · missed ${m.n} times` : ''}</div>
      ${ctx}
      <div id="mq">${mcqHtml([q], 'mr')}</div>
      <div class="row" style="justify-content:center;"><button class="btn" id="mchk">Check</button></div>
      <div id="mfb"></div>`;
    if (ITEM_TASKS.includes(t)) mountItemPlayers(t, [x], stage, 'mr', { player: { label: '▶ Play' } });
    else if (item.lines && $('#mp')) mountPlayer($('#mp'), item.lines, { label: '▶ Play the recording' });
    const lines = x && x.lines ? x.lines : item.lines;
    $('#mchk').addEventListener('click', () => {
      const chosen = $('input[name="mr-0"]:checked');
      if (!chosen) { toast('Choose an answer first.'); return; }
      $('#mchk').remove();
      const ok = gradeMcq([q], 'mr', $('#mq')) === 1;
      if (ok) { right++; advanceMistake(m.key); }
      else { missed.push(m); MISTAKES[m.key] = Object.assign(MISTAKES[m.key] || m, { box: 1, due: addDays(1), n: (m.n || 1) + 1 }); }
      saveMistakes(); buzz(ok ? 20 : [25, 70, 25]);
      const after = MISTAKES[m.key];
      $('#mfb').innerHTML = `<div class="w-feedback">
        <div class="stamp ${ok ? 'good' : 'low'}" style="font-size:17px;">${ok ? 'Correct' : 'Not yet'}</div>
        <p class="hint">${ok ? (after ? `Next review in ${MISTAKE_DAYS[after.box]} days.` : 'Cleared from your review list. 🎉') : 'It will come back tomorrow.'}</p>
        ${lines ? `<div style="text-align:left;">${transcriptHtml(lines)}</div>` : ''}
        <div class="row" style="justify-content:center; margin-top:10px;">
          ${ok ? '' : askBtnHtml(explainPrompt(t, item, q, q.options[+chosen.value], m.qi), 'Ask Claude why ↗', 'btn ghost')}
          <button class="btn" id="mnx">${i + 1 < list.length ? 'Next ▶' : 'See results'}</button></div></div>`;
      $('#mnx').addEventListener('click', () => { stopSpeech(); i++; i < list.length ? card() : done(); window.scrollTo(0, 0); });
    });
  };
  const done = () => {
    if (opts.onDone) return opts.onDone(right, list.length);
    markStudyDay();
    setHeader('Mistake review', true);
    const left = dueMistakes().length;
    stage.innerHTML = `<div class="result">${stampHtml(right, list.length)}</div>
      <p class="sub" style="text-align:center;">${missed.length ? `${missed.length} will come back tomorrow.` : 'All correct.'} ${left ? `${left} more due today.` : ''}</p>
      <div class="row" style="justify-content:center; margin-top:16px;">${left ? '<button class="btn ghost" id="more">Review more</button>' : ''}<button class="btn" id="back">Done</button></div>`;
    const mo = $('#more'); if (mo) mo.addEventListener('click', () => go(() => runMistakes(shuffle(dueMistakes()).slice(0, 10))));
    $('#back').addEventListener('click', goBack);
  };
  card();
}

// ---------- Backup and restore ----------
const BACKUP_PREFIX = 'topik2-';
function backupData() {
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BACKUP_PREFIX)) data[k] = localStorage.getItem(k);
    }
  } catch (e) { }
  // Never put the API key in a backup file.
  if (data['topik2-settings']) { try { const s = JSON.parse(data['topik2-settings']); delete s.apiKey; data['topik2-settings'] = JSON.stringify(s); } catch (e) { } }
  return { app: 'topik-practice', version: 1, created: new Date().toISOString(), data };
}
function exportBackup(out) {
  const b = backupData();
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `topik-progress-${dayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  store.set('topik2-lastbackup', dayStr());
  out.textContent = `Saved topik-progress-${dayStr()}.json to your Downloads. Keep it somewhere safe, like Google Drive.`;
}
function importBackup(file, out) {
  const r = new FileReader();
  r.onload = () => {
    let b;
    try { b = JSON.parse(r.result); } catch (e) { out.textContent = "That file isn't a backup from this app."; return; }
    if (!b || b.app !== 'topik-practice' || !b.data) { out.textContent = "That file isn't a backup from this app."; return; }
    const when = b.created ? new Date(b.created).toLocaleDateString() : 'an unknown date';
    showConfirm('Restore this backup?', `It's from ${when}. It replaces all progress on this device.`, 'Restore', () => {
      const keep = { apiKey: SETTINGS.apiKey, model: SETTINGS.model };
      try {
        Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).forEach(k => localStorage.removeItem(k));
        Object.entries(b.data).forEach(([k, v]) => { if (k.startsWith(BACKUP_PREFIX) && typeof v === 'string') localStorage.setItem(k, v); });
        const s = JSON.parse(localStorage.getItem('topik2-settings') || '{}');
        if (keep.apiKey) s.apiKey = keep.apiKey; if (keep.model) s.model = keep.model;
        localStorage.setItem('topik2-settings', JSON.stringify(s));
      } catch (e) { out.textContent = "Couldn't restore on this device: storage isn't available."; return; }
      location.reload();
    }, 'Cancel');
  };
  r.readAsText(file);
}

window.addEventListener('popstate', () => {
  if (closeSheet()) { try { history.pushState({ topik: 'sub' }, ''); } catch (e) { } return; } // back closes the passage sheet first
  if (TEST && TEST.running) { // leaving mid-test: confirm first
    try { history.pushState({ topik: 'sub' }, ''); } catch (e) { }
    showConfirm('Leave the test?', 'Your answers will be lost, and the test won\'t be scored.', 'Leave test', () => { endTestState(); TEST = null; go(() => renderTab(currentTab)); });
    return;
  }
  if (screen === 'sub') go(() => renderTab(currentTab));
});
// When the keyboard opens on a phone, keep the focused field in view
stage.addEventListener('focusin', e => {
  if (!COARSE || !e.target.matches('input[type=text], input:not([type]), textarea, select')) return;
  setTimeout(() => { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { } }, 350);
});
renderTab('home');
if (!store.get('topik2-welcomed', 0)) showWelcome();

// ---------- Offline support ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
