# TOPIK II Practice

An installable, offline-capable app for practicing the TOPIK II (토픽 II) paper
test: Listening (듣기) questions 4–50, Reading (읽기) questions 1–50 and
Writing (쓰기) questions 51–54. It carries over the study methods from the
TOEFL practice app that also work for TOPIK: strategy drills, note-taking,
timed practice tests, spaced mistake review and word cards. Listening audio is
recorded with Korean neural voices that GitHub creates for free.

## What's inside
- **듣기 Listening:** next line (4–8), next action (9–12), what matches
  (13–16), central thought (17–20) and longer recordings with two questions
  (21–50). Questions 1–3 use pictures and aren't included. Note-taking
  drills: guided notes, one note per chunk, lecture notes with the speaker's
  attitude (태도), and notes on your own podcast.
- **읽기 Reading:** grammar (1–4), ads and signs (5–8), what matches (9–12,
  32–34), sentence order (13–15), blanks (16–18, 28–31), newspaper headlines
  (25–27), main idea (35–38), sentence placement (39–41) and longer passages
  including fiction (19–24, 42–50). Strategy drills: skimming the first and
  last sentence of each paragraph (Korean often puts the point last),
  connectors (접속 표현) and guessing words from context, including hanja.
- **쓰기 Writing:** questions 51 and 52 (fill ㉠ and ㉡), 53 (describe a
  chart in 200–300자) and 54 (essay in 600–700자), with a live character
  count, suggested times, answer templates and model answers. Build a
  sentence drills practice the grammar and written -다 style.
- **어휘 Words:** 160 TOPIK II words in 8 themed decks (with English meanings,
  hanja and examples), plus 40 grammar patterns, reviewed with spaced
  repetition.
- **Practice tests:** Listening (questions 4–50, each recording plays once),
  Reading (50 questions in 70 minutes) and Writing (51–54 in 50 minutes), with
  an estimated 급 (level) based on the TOPIK II cutoffs: 3급 120, 4급 150,
  5급 190 and 6급 230 out of 300.

## Set it up (about 20 minutes, mostly waiting)

You need a computer for the upload steps. Afterwards you use the app on your phone.

### 1. Create the repository
1. Go to https://github.com/new
2. Repository name: `topik-practice`
3. Choose **Public** (free GitHub Pages hosting needs a public repository).
4. Leave "Add a README" unticked. Click **Create repository**.

### 2. Turn on publishing and permissions
1. In the repository, open **Settings → Pages**.
   Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Open **Settings → Actions → General**.
   Under **Workflow permissions**, choose **Read and write permissions**, then **Save**.
   (This lets GitHub save the audio it creates.)

### 3. Add the files
Push this folder to the repository's `main` branch, or upload everything in
it through **Add file → Upload files**. If you upload by hand, check that
`.github/workflows/build-and-deploy.yml` arrived: folders starting with a dot
can be hidden (on a Mac, press **Cmd + Shift + .** in Finder to show them).

### 4. Wait for the first build
Open the **Actions** tab. A run called **Build audio and publish** starts automatically.
- The first run records about 320 audio clips with Microsoft Edge's Korean
  voices (a man, 인준, and a woman, 선히) and takes roughly 5–15 minutes.
- If the voice service is unavailable, the app is published anyway and reads
  those lines with your phone's own Korean voice. The next build fills in
  the missing clips; you can start one with **Run workflow**.

### 5. Open the app
Your address is:

`https://YOUR-GITHUB-USERNAME.github.io/topik-practice/`

(It's also shown under **Settings → Pages**.)

### 6. Install it on your phone
- **Android:** open the address in Chrome, then **⋮ → Install app**.
- **iPhone:** open it in Safari, then **Share → Add to Home Screen**.

On the welcome guide's last page, tap **Save audio now** (use Wi-Fi). You can
also do this later in **Settings (⚙️) → Save all audio for offline use**.
For the phone voice fallback, make sure a Korean voice is installed
(Android: Settings → Text-to-speech; iPhone: Settings → Accessibility →
Spoken Content → Voices → Korean).

## Typing Korean
Writing and word cards need a Korean keyboard. Android: Gboard → Languages →
Add keyboard → 한국어. iPhone: Settings → General → Keyboard → Keyboards →
Add New Keyboard → Korean. Character counts follow the TOPIK answer sheet:
spaces count, line breaks don't.

## Optional: Claude features
New practice sets, writing scores against the TOPIK rubric (내용 및 과제 수행,
글의 전개 구조, 언어 사용), note reviews and summaries use Claude.
1. Create an API key at https://console.anthropic.com
2. In the app: **Settings (⚙️) → Claude features → paste the key → Save**.

The key is stored only on your phone and sent only to Anthropic. **Never put
your key in this repository.** Without a key, **Score in Claude ↗** and
**Ask Claude why ↗** copy a ready-made prompt and open claude.ai, so you can
use your claude.ai subscription instead. Feedback is in English by default;
switch it to Korean in Settings.

## Changing content
Edit `data/content.js` (practice sets) or `data/words.js` (words and grammar)
and commit. GitHub records audio for any new or changed lines and republishes
the app. See `CONTENT_GUIDE.md` for the format of every task.

**Safety check:** before publishing, GitHub runs
`node scripts/validate-content.mjs`. If there's a typo, a wrong answer
number, or a 남자 line with the woman's voice number, the run stops with a
message saying what to fix, and the last working version stays online.

## Troubleshooting
- **Page not found (404):** wait a few minutes after the first green run, then
  check **Settings → Pages** for the exact address.
- **A run failed at "Safety check":** open the run in the **Actions** tab and
  click that step. The message names the set and question to fix.
- **Old version still showing:** close the app completely and open it again
  while online.

## Credits
Voices: Microsoft Edge neural text-to-speech, via the open-source
[edge-tts](https://github.com/rany2/edge-tts) tool. All practice content is
original and written for this app; it is not taken from past TOPIK papers.
