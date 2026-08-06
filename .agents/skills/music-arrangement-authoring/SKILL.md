---
name: music-arrangement-authoring
description: >-
  把一段风格/情绪/参考描述编成可导入「电子编曲器」(music-arranger 小工具)的整曲 JSON —— 含五层(节奏鼓组 / 贝斯 /
  和声铺底 / 旋律 Hook / 音效)的循环片段,以及段落结构(前奏 Intro→主歌 Verse→铺垫 Build→高潮 Drop→尾奏 Outro)。
  Use this skill whenever the user wants to arrange / compose / generate an electronic music track, beat, loop, or
  full song structure — Chinese cues: 编曲、编一首、做一首电子乐/beat、生成编曲、鼓组/贝斯/和弦/旋律铺排、歌曲结构、
  前奏主歌高潮尾奏、House/Techno/Trance/Lofi/Synthwave. Trigger even if the user doesn't say "skill" — e.g.
  "帮我编一首 124 的 house", "make a trance drop", "把这个情绪做成一段电子乐导入编曲器". Produces one importable
  arrangement JSON. Do NOT use for editing the tool's engine code, mixing/mastering advice, or non-music JSON.
---

# 电子编曲生成 · Music Arrangement Authoring

Turn a **brief** (genre, mood, BPM, key, or a reference track) into a **validated arrangement JSON** that the
Electron tool `src/tools/music-arranger.js` imports (🎹 电子编曲 → 导入) and plays. You author the whole song; the
tool only imports and plays it.

> 给用户的一句话:这个 skill 把你的一句风格描述,编成一个可直接导入编曲器的整曲工程(片段 + 段落结构),点 ▶ 就能听。

## Inputs & outputs

- **Input**: a natural-language brief. Useful bits: genre/reference (House, Trance, Lo-fi, "像 XX 那种"), mood,
  BPM, key/scale, energy, length, whether to use realistic samples. If the brief is thin, **pick sensible genre
  defaults and say what you chose** (don't stall) — but if it's empty, ask for at least a vibe or reference.
- **Output**: one arrangement JSON file. Default path `arrangements/<slug>-<YYYY-MM-DD>.json`, pretty-printed,
  2-space indent, UTF-8. There's no watched folder — the user imports it via the tool's 导入 button.
- **The contract is authoritative.** Before emitting JSON, read [references/schema.md](references/schema.md)
  (exact fields, enums, ranges, a full worked example). For the musical choices, use
  [references/genres.md](references/genres.md). If your JSON drifts from the schema the importer silently clamps
  it and your intent is lost — treat the schema as fixed.

## The pipeline

Run these five phases in order. Build one pattern fully before the next; assemble the song last.

```
brief  →  ① 定基调  →  ② 编片段(五层)  →  ③ 搭结构(段落)  →  ④ 校验  →  ⑤ 写入 JSON
```

---

## ① 定基调 — set the foundation

From the brief choose: **genre**, **BPM**, **key + scale**, **grid.bars** (2 for simple loops, 4 when the
progression needs four bars), and **sound source** (synth = offline default; `sf:*` samples only if the user wants
realistic timbre and accepts first-load internet). Look the genre up in [genres.md](references/genres.md) for its
tempo range, groove, and structure. State these choices to the user in one line before building.

Everything downstream must respect the key/scale: bass roots and chord roots agree; melody notes stay in-scale.

## ② 编片段 — build the pattern(s), five layers

Most songs need **two** patterns: **A** (main groove) and **B** (drop variant). Build A completely, then derive B
(denser hats, `pluck` chords, hook higher but ≤ C6 (midi 84), add an `impact`). For each pattern fill the five layers — this is
the same five-layer model the tool exposes:

1. **节奏 Drums** — the skeleton. Lay `kick` first (genre groove), then `snare`/`clap` backbeat, `chh` for the
   16th/offbeat groove, `ohh` accents, `perc` fills. Use accent value `2` for the notes that should pop. Step
   arrays must be length `grid.bars*16`.
2. **贝斯 Bassline** — locks with the kick. Root-following, in the low octave (midi ~32–40), with `sidechain`
   on `kick` so it pumps. Don't let bass hits collide with every kick — sit between them or lean on the SC duck.
3. **和声 Harmony/Pad** — the color. One chord **per bar** (`chords` length = `grid.bars`), in key; choose
   `mode` (pad = sustained beds, arp = motion, pluck = rhythmic). 7th/9th chords read as "electronic".
4. **旋律 Melody/Hook** — the identity. A short, memorable motif **in the declared scale**; leave space; put the
   catchy version in the drop pattern (often higher — but keep every melody midi ≤ 84 / C6).
5. **音效 FX** — glue. `riser`/`downlifter` into/out of sections, `impact` on downbeats, `reverse` before a hit,
   `sweep` for filter motion. Per-pattern events re-fire each loop; section-level auto-FX (below) handle transitions.

Concrete step positions and per-genre choices are in [genres.md](references/genres.md). Keep notes on the grid
(integer steps) so everything locks.

## ③ 搭结构 — arrange the sections (the upper abstraction)

This is what makes it a *song* and not a loop. Order sections on the timeline; each references a pattern and sets
**which layers play** + **dynamics**. A reliable arc:

```
前奏 Intro → 主歌 Verse → 铺垫 Build → 高潮 Drop → (间奏 Break) → 主歌/Drop2 → 尾奏 Outro
```

- **Intro** — set the tone: strip to pad+melody, `fadeIn`, filter low→mid. Simple.
- **Verse** — build atmosphere: add drums+bass, filter fairly open.
- **Build** — raise energy: all layers, filter opening (`filterFrom`≪`filterTo`), `autoRiser` in the last bar.
- **Drop / Chorus** — the payoff: all layers, filter fully open, `autoImpact` at the start, use Pattern **B**.
- **Outro** — wind down: drop layers, filter closing (high→low), `fadeOut`.

Each section's `repeats × grid.bars` sets its length — intro/build short (2–4 bars), verse/drop longer (8). Use
the **preset defaults per type** in [schema.md](references/schema.md#section) unless the brief asks otherwise, and
set `playMode:"song"`, `song.loop` per the user's wish. Energy comes from *layer gating + dynamics*, not from
rewriting notes each section.

## ④ 校验 — validate before writing

Do not skip. The importer clamps bad data silently, so an error doesn't crash — it quietly changes the music. Run
the full checklist in [schema.md → Validation rules](references/schema.md#validation-rules): step-array lengths,
step/midi ranges, chords length = bars & valid roots (sharps only, `G#` not `Ab`), every enum string exact, every
`section.pattern` resolves to a real pattern id, and **musicality** (melody in scale, bass agrees with chords,
kick/bass don't fight). Then do a quick **mental playback**: does the arc rise into the drop and resolve at the
outro? Fix anything that reads wrong; if a section is muddy, simplify it rather than shipping it broken.

## ⑤ 写入 JSON — write the file

Emit the single top-level object (see the full example in schema.md) to the output path. Then report to the user:
the genre/BPM/key you chose, the pattern list, the section arc with bar counts and total length, the file path, and
the reminder: **open 🎹 电子编曲 → 导入 → pick the file → set ▶ to 整首歌曲 → play**. Keep intermediate notes only if
asked — the JSON is the deliverable.

## Quality bar (why these rules exist)

The point is a track that sounds intentional and plays back correctly on the first import. Locking notes to the
grid keeps the groove tight; key/scale discipline keeps it consonant; the section arc gives it shape; validation
stops silent clamping from eating your intent. If a part sounds busy or off, thin it out — space is what makes
electronic music breathe.

## Playback & mixing (runs in the tool, not here)

You author structure and notes; the tool renders audio (Tone.js synths, optional smplr samples), applies the
per-section filter/fade/sidechain, and plays the song. You don't mix or master here — but emit sane `master`,
`gain`, and `sidechain` values so it sounds balanced on import.
