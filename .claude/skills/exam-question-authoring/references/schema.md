# 题库 JSON 契约 · Question Bank Schema

This is the authoritative contract between the authoring skill (which produces the JSON) and the Electron app
(which imports, renders, and grades it). Keep the two in sync — if a field changes here, the importer must change too.

## Contents
- [Bank object](#bank-object) — the top-level file
- [Question object](#question-object) — shared fields
- [single_choice](#single_choice-单选) — full example
- [fill_blank](#fill_blank-填空) — full example
- [Field reference](#field-reference)
- [Grading semantics](#grading-semantics-electron-side) — how the app judges answers
- [File layout](#file-layout)

---

## Bank object

The file is one JSON object: metadata + an array of questions.

```json
{
  "bankId": "frontend-basics-2026-07-09",
  "title": "前端基础测验",
  "sources": ["notes/react.md", "notes/http.md"],
  "generatedAt": "2026-07-09",
  "schemaVersion": 1,
  "questions": []
}
```

- `bankId` — stable slug + date, unique per file.
- `sources` — the Markdown files this bank was generated from (traceability). **All paths — here and in every
  `source.file` — are relative to the project root** (e.g. `knowledge/react.md`); not absolute, not a bare
  basename. `sources` must equal the distinct set of `source.file` values across all questions.
- `schemaVersion` — bump when the shape changes so the importer can migrate. Current: `1`.
- `questions` — array of Question objects (below). Only `validated` questions belong here.

## Question object

Two `type`s share most fields. Type-specific fields:
`single_choice` uses `options` (and sets `blanks: null`); `fill_blank` uses `blanks` (and sets `options: null`).

## single_choice (单选)

```json
{
  "id": "q-20260709-0001",
  "kpId": "kp-http-304",
  "type": "single_choice",
  "difficulty": "medium",
  "bloom": "understand",
  "stem": "HTTP 状态码 304 Not Modified 的含义是?",
  "options": [
    { "key": "A", "text": "请求的资源不存在",                         "correct": false, "misconception": "把 304 与 404 混淆" },
    { "key": "B", "text": "资源自上次请求以来未修改,可直接使用缓存", "correct": true,  "misconception": null },
    { "key": "C", "text": "请求被永久重定向到新地址",                 "correct": false, "misconception": "把 304 与 301 混淆" },
    { "key": "D", "text": "服务器内部发生错误",                       "correct": false, "misconception": "把 3xx 与 5xx 混淆" }
  ],
  "blanks": null,
  "explanation": "304 表示协商缓存命中:资源未变化,服务器不返回主体,客户端使用本地缓存副本。",
  "source": { "file": "notes/http.md", "heading": "缓存与状态码", "lines": [42, 55] },
  "status": "validated"
}
```

## fill_blank (填空)

Blanks are marked inline in `stem` as `{{1}}`, `{{2}}`; each has an entry in `blanks` keyed by the same `id`.

```json
{
  "id": "q-20260709-0002",
  "kpId": "kp-useeffect-deps",
  "type": "fill_blank",
  "difficulty": "medium",
  "bloom": "remember",
  "stem": "React 中 useEffect 的第二个参数是 {{1}} 数组;当它为空数组时,副作用只在组件 {{2}} 时执行一次。",
  "options": null,
  "blanks": [
    { "id": 1, "accept": ["依赖", "dependency", "deps"], "caseSensitive": false },
    { "id": 2, "accept": ["挂载", "mount", "首次渲染"],   "caseSensitive": false }
  ],
  "explanation": "空依赖数组表示没有依赖项,effect 仅在挂载后运行一次,组件卸载时执行清理函数。",
  "source": { "file": "notes/react.md", "heading": "useEffect", "lines": [12, 20] },
  "status": "validated"
}
```

## Field reference

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `id` | string | all | Unique within the bank. Suggested: `q-<YYYYMMDD>-<seq>`. |
| `kpId` | string | all | Which knowledge point it tests; multiple questions may share one. Use a stable kebab-case slug per point (e.g. `kp-enharmonic`). For a question spanning two facts, use the primary point's id. |
| `type` | `"single_choice"` \| `"fill_blank"` | all | Selects which of `options`/`blanks` is used. |
| `difficulty` | `"easy"` \| `"medium"` \| `"hard"` | all | Best-effort. easy=回忆, medium=理解/辨析, hard=应用/推理. |
| `bloom` | `"remember"` \| `"understand"` \| `"apply"` | all | Optional cognitive level; the app may ignore it. If you're not classifying, omit the key entirely (don't set it to `null`). |
| `stem` | string | all | The question. For `fill_blank`, contains `{{n}}` markers. |
| `options` | array \| `null` | single_choice | `{ key, text, correct, misconception }`. Exactly one `correct: true`. |
| `options[].key` | string | single_choice | Display key, e.g. `"A"`. Unique within the question. |
| `options[].correct` | boolean | single_choice | The answer key. |
| `options[].misconception` | string \| `null` | single_choice | The named trap a wrong pick represents; shown as feedback. `null` on the correct option — and also allowed on a distractor that is merely a plausible alternative (e.g. a permuted ordering) with no distinct named misconception. |
| `blanks` | array \| `null` | fill_blank | `{ id, accept, caseSensitive }`, one per `{{n}}`. |
| `blanks[].id` | number | fill_blank | Matches the `{{n}}` marker in `stem`. |
| `blanks[].accept` | string[] | fill_blank | All acceptable answers for that blank. |
| `blanks[].caseSensitive` | boolean | fill_blank | Usually `false`. |
| `explanation` | string | all | Shown after answering. |
| `source` | object | all | `{ file, heading?, lines? }` back-reference into the knowledge base. |
| `status` | `"validated"` \| `"rejected"` | all | Only `validated` questions ship in the bank. |

## Grading semantics (Electron side)

The app implements this; it's spec'd here so the JSON's meaning is unambiguous. Grading is deterministic — no LLM needed.

- **single_choice** — correct iff the set of keys the user selected equals the set of keys where `correct === true`.
  (For single-answer questions that's just: selected key's option has `correct: true`.)
- **fill_blank** — grade each blank independently, then combine:
  - `normalize(s)` = trim → collapse internal whitespace → full-width→half-width (全角转半角) →
    if `!caseSensitive`, lowercase.
  - A blank is correct iff `normalize(userAnswer)` equals `normalize(x)` for some `x` in `accept`.
  - Whole question correct iff all blanks correct. (Partial credit optional: score = correctBlanks / totalBlanks.)
- **Feedback** — on a wrong single_choice pick, show the chosen option's `misconception`; always show `explanation`
  after answering.
- **Optional self-improvement** — if a `fill_blank` answer looks semantically right but isn't in `accept`, the app
  may flag it for review and (once confirmed) append it to that blank's `accept`, so the bank sharpens over time.

## File layout

```
question-bank/
  frontend-basics-2026-07-09.json     # one bank object per file
  ...
```

Default output dir is `question-bank/` at the project root (parallel to `Todo-history/`). Write pretty-printed
(2-space indent) UTF-8 JSON. The importer reads the whole file, validates `schemaVersion`, and loads `questions`.
