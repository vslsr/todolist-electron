---
name: exam-question-authoring
description: >-
  把 Markdown 知识库自动出成可导入的试题 JSON(单选题 single_choice + 填空题 fill_blank),用于检验掌握程度。
  Use this skill whenever the user wants to generate exam / quiz / test questions from notes or a knowledge
  base — Chinese cues: 出题、试题、题目、题库、考题、测验、根据笔记出题、检验掌握. Especially when the source is
  Markdown study notes and the output should be 选择题 (multiple-choice) or 填空题 (fill-in-the-blank), or a
  reusable question bank / question JSON for an app to import. Trigger even if the user does not say "skill" —
  e.g. "根据这份笔记帮我出10道选择题", "generate a quiz from these markdown docs", "把知识库做成题库导入到我的应用".
  Do NOT use for grading a student's answers (that runs in the app) or for non-Markdown sources unless asked.
---

# 试题生成 · Exam Question Authoring

Turn a Markdown knowledge base into a **validated question-bank JSON file** that the Electron app imports and
renders. Scope of this skill: two question types — `single_choice` (单选) and `fill_blank` (填空). The bank JSON
carries the correct answers and accepted variants, so the app has everything it needs to render *and* grade.

> 给用户的一句话:这个 skill 让任意 Agent 读你的 Markdown 笔记,产出一个题库 JSON;Electron 端只负责导入、答题、判分。

## Inputs & outputs

- **Input**: one or more `.md` files (the knowledge base). The caller gives you the paths (a file, a glob, or a
  folder). If none is given, ask which notes to use — do not invent knowledge.
- **Output**: a single bank JSON file. Default path `question-bank/<slug>-<YYYY-MM-DD>.json`, pretty-printed with
  2-space indent, UTF-8 (mirror the repo's `Todo-history/*.json` style so import stays consistent).
- **The contract is authoritative.** Before writing any JSON, read [references/schema.md](references/schema.md).
  If the JSON you emit drifts from that schema, the Electron importer breaks — so treat the schema as fixed.

## The pipeline

Run these four phases in order. Phases 1–3 can be done note-by-note; only assemble the bank at the end.

```
*.md  →  ① 抽取知识点  →  ② 出题  →  ③ 校验(盲答对拍)  →  ④ 写入题库 JSON
```

---

## ① Extract knowledge points

Split each Markdown file by headings, then pull out **atomic, testable ideas** — one idea per knowledge point.
Good candidates: definitions, rules, key parameters, cause→effect, ordered steps, "A vs B" distinctions.
Skip anything you can't turn into a question with a single unambiguous answer (intros, opinions, navigation, TODOs).

For each knowledge point keep: a short `concept` label, the `content` it's drawn from, and its `source`
(`file` + heading, and line range if you have it). Source matters — it lets phase ③ check answers against the
original text, and lets the app show "where this came from" and regenerate when notes change.

Why atomic: a question that secretly tests two ideas can't cleanly measure mastery of either. One point, one fact.

## ② Generate questions

For each knowledge point, write the requested number and type(s) of questions. Every question must be answerable
**from that knowledge point alone** — the answer has to be derivable from the source `content`, not from outside
knowledge you happen to have.

### single_choice (单选)
- Exactly **1 correct** option + **3 distractors**. One correct answer only (this skill's `single_choice` is
  single-answer; don't produce two defensible options).
- Build distractors from **real misconceptions**, not random noise. A good distractor is what a learner who
  half-understands would actually pick. Tag each wrong option with the `misconception` it represents so the app
  can tell the user *which trap* they fell into — but when a distractor is just a plausible alternative with no
  distinct named trap (e.g. a permuted ordering), leaving `misconception` as `null` is fine; don't force a label.
- Keep options parallel in length, grammar, and specificity. If the correct one is the longest/most-detailed
  every time, the format leaks the answer.
- Never restate the answer verbatim in the stem.

### fill_blank (填空)
- Blank out the **key term or result**, not filler. Mark blanks in the stem with `{{1}}`, `{{2}}` (1–2 per
  question). Blanking a particle or an obvious word tests nothing.
- For each blank give an `accept` list covering reasonable equivalents: synonyms, EN/中文 variants, common
  spellings. The app normalizes case/width before matching, so you don't need to list case variants — but do list
  genuinely different acceptable answers.
- The stem must stay unambiguous: exactly the intended answers should fit, given the source.
- **Mind the words next to a blank.** The app matches each blank *whole*, not as a substring — so if the answer
  is `块级` and the stem continues "…{{1}} 作用域", a learner may type "块级作用域" and be marked wrong. Either pull
  the shared word into the blank ("…是 {{1}}" → answer "块级作用域"), or add the fuller phrase to that blank's `accept`.

Add a plain-language `explanation` to every question (why the answer is right / the key point). It's shown after
the user answers.

**Worked examples and the exact field layout live in [references/schema.md](references/schema.md).** Read it
before generating so your objects are valid on the first pass.

## ③ Validate — blind-answer cross-check

This is the highest-value step; do not skip it. A wrong key or a second-correct option silently *mis*-measures
mastery, which is worse than having no question. For each draft question:

1. **Answer it blind.** Using only the source `content` (not the marked answer), solve the question yourself.
   For `single_choice`, look at the stem + options and pick; for `fill_blank`, fill each blank.
2. **Compare & audit** against the key and the source:
   - Does your blind answer match the marked correct answer? If not → the question or key is wrong. Fix or drop.
   - Is any distractor *also* arguably correct? → rewrite it.
   - Any ambiguity, or does the stem/options leak the answer? → fix.
   - For `fill_blank`, is the `accept` list missing a reasonable answer? → add it.
3. **Set `status`.** `validated` if it passes; otherwise fix and re-check **once**. If it still fails, set
   `rejected`, leave it out of the bank, and note why so the user can see what was dropped.

Prefer fewer solid questions over many shaky ones. When a knowledge point is too vague to test cleanly, skip it
and say so — don't force it.

## ④ Write the bank

Collect the `validated` questions into one bank object (see schema) and write it to the output path. Report a
short summary to the user: how many questions by type, how many were dropped in validation and why, and the file
path. Keep the intermediate knowledge points only if the user asks — the bank JSON is the deliverable.

## Quality bar (why these rules exist)

The whole point is to *measure mastery accurately*. Every rule above defends that: atomic points isolate what's
tested, misconception-based distractors make "getting it right" mean something, and blind-answer validation stops
broken questions from reaching the learner. If you're ever unsure whether a question is sound, it isn't — drop it.

## Grading (runs in the app, not here)

You don't grade in this skill. But so the contract is complete: everything the app needs is in the JSON —
`options[].correct` for single choice, `blanks[].accept` for fill-in-the-blank. The exact matching rules the
Electron side should implement are documented under "Grading semantics" in
[references/schema.md](references/schema.md).
