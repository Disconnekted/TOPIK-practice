# Writing new practice sets

This guide is for anyone adding practice sets to `data/content.js` or cards
to `data/words.js`. Every set is a plain JavaScript object added to the end of
one task's array. The build checks both files before publishing
(`node scripts/validate-content.mjs`) and records audio for new spoken lines.

## General rules

- Add new sets to the **end** of the task's array. Don't reorder existing
  sets: progress points at set positions.
- Every set needs a short, unique `title`.
- Korean: natural, accurate, TOPIK 3–6급 level. Facts must be true.
- Write everything originally. Never copy past TOPIK papers or textbooks.
- Multiple choice: exactly 4 `options` (the app adds ①–④), and `answer` is
  the index of the correct one (0 = first). Vary the correct index.
- Every question gets a `why`: one short English sentence explaining the
  answer, quoting the Korean.
- Spoken lines: `{ s, name, t }`. **`s: 0` is always 남자 (the man) and
  `s: 1` is always 여자 (the woman)**; the voice follows `s`. Write numbers as
  they are spoken (삼천 원, not 3,000원) so the voices read them naturally.
- Inline marks: `[[text]]` underlines (밑줄 친 부분), `(    )` with at least
  two spaces is a blank, `{{word}}` marks a target word.
- Escape double quotes inside strings as `\"`.

## Listening

**lnext, laction, lmatch, lcentral** (4–20): sets of items,
`{ title, items: [{ lines, q?, options, answer, why }] }`. `q` is optional;
each task has a default question. For laction, set `q` when it's 남자가.

**lpair** (21–50): `{ title, kind, lines, questions }`. `kind` is 대화,
인터뷰, 대담, 강연, 인사말, 다큐멘터리 or 뉴스. Exactly 2 questions.

**guided**: `{ title, lines, skeleton }`. One speaker. `skeleton` is the
notes outline (`\n` between lines) with gaps `[[answer|alternative]]`.

**segment**: `{ title, s, segments: [{ t, keys, model }] }`. `s` is the
speaker's voice; `keys` is a list of keyword alternatives, e.g.
`[["빛", "조명"], ["공해"]]`; `model` is a note of 8 어절 or fewer.

**notes**: `{ title, lines, attitude, model, questions }`. `attitude` lists
exact phrases from the talk that show the speaker's attitude; `model` is
model notes.

## Reading

All of these except rpair are sets of items, `{ title, items: [...] }`.

- **rgram** (1–4): `{ type: "blank" | "similar", q, options, answer, why }`.
  `q` is the sentence, with `(    )` for blank items or `[[ ]]` around the
  target for similar items.
- **rtopic** (5–8): `{ text, options, ... }`. A short ad or sign; `\n` for
  line breaks; options are short nouns.
- **rmatch** (9–12, 32–34): `{ kind, text, options, ... }`.
- **rorder** (13–15): `{ sents: ["(가) …", "(나) …", "(다) …", "(라) …"],
  options: ["(나)-(가)-(라)-(다)", …], ... }`.
- **rblank** (16–18, 28–31): `{ text with (    ), options, ... }`.
- **rhead** (25–27): `{ text: headline, options, ... }`.
- **rmain** (35–38): `{ text, options, ... }`.
- **rinsert** (39–41): `{ given, text with ( ㉠ ) ( ㉡ ) ( ㉢ ) ( ㉣ ),
  options: ["㉠", "㉡", "㉢", "㉣"], ... }`.

**rpair** (19–24, 42–50): `{ title, kind, text, questions }`. `kind` is
설명문, 기사, 칼럼, 수필, 소설 or 논설문; `\n` between paragraphs. Two
questions, or three for a 48–50 style set. The test needs at least six
2-question sets and one 3-question set.

## Strategy drills

- **skim**: `{ title, paras: [4 paragraphs], questions }`. Questions must be
  answerable from the first and last sentence of each paragraph.
- **trans**: `{ title, text, predict }`. Gaps are
  `[[function:Correct|Wrong|Wrong|Wrong]]` with the correct connector first;
  function is contrast, cause, result, example, addition, restate, shift or
  concession.
- **vic**: `{ title, items: [{ text, options, answer, clue, why }] }`. Mark
  the word `{{like this}}` and the clue `[[like this]]`; `clue` is
  definition, synonym, contrast, example, general sense or hanja.
- **build**: `{ title, items: [{ context, answer, end, distractor, alts?, why }] }`.
  `answer` is the sentence with chunks separated by spaces, without final
  punctuation; `end` is the punctuation.

## Writing

- **w51, w52**: `{ title, kind?, text, model: { a, b }, tip }`. Gaps are
  written `(    ㉠    )` and `(    ㉡    )`. 51 is a practical text in
  polite style; 52 is an explanation in -다 style.
- **w53**: `{ title, prompt, charts, notes?, model }`. Each chart is
  `{ type: "bar" | "line", title, unit, labels, series: [{ name, values }] }`
  with one value per label. `model` is 250–290자.
- **w54**: `{ title, intro, points: [3 questions], model }`. `model` is
  620–690자 in -다 style, with paragraphs separated by `\n`.

## Words (data/words.js)

`DATA.words` is a list of decks `{ n, name, words }`. Each word is
`{ t, p, e, h?, x }`: the word, part of speech, English meaning, hanja
(optional) and example sentences with the word as it appears marked
`{{like this}}`. `DATA.grammar` uses the same shape, with `p` naming what the
pattern expresses (원인, 대조, 추측…).
