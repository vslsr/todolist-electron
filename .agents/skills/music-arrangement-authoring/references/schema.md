# 编曲工程 JSON 契约 · Arrangement Schema (v2)

This is the authoritative contract between the arranging skill (which **produces** the JSON) and the Electron
tool `src/tools/music-arranger.js` (which **imports and plays** it via its 导入 button). If a field changes in the
tool's `coerceProject` / `defaultProject`, change it here too. The importer is tolerant — missing fields get
defaults, out-of-range values are clamped, and a v1 file (single top-level `layers`) is migrated to Pattern A —
but the skill should still emit **complete, valid** objects so nothing silently degrades.

## Contents
- [Top-level object](#top-level-object)
- [Pattern & the five layers](#pattern--the-five-layers)
- [Section (the song-structure layer)](#section)
- [Enumerations](#enumerations-exact-strings)
- [Full worked example](#full-worked-example)
- [Validation rules](#validation-rules)
- [How it is imported](#how-it-is-imported)

---

## Top-level object

```json
{
  "format": "todo-music-arranger",
  "version": 2,
  "tempo":  { "bpm": 128, "swing": 0 },
  "grid":   { "bars": 2, "stepsPerBar": 16 },
  "master": { "volume": -8, "filter": 20000, "reverb": 0.15 },
  "activePattern": 0,
  "patterns": [ /* Pattern objects */ ],
  "playMode": "song",
  "song": { "loop": true, "sections": [ /* Section objects */ ] }
}
```

| field | meaning | range / notes |
|---|---|---|
| `format` | fixed id | must be `"todo-music-arranger"` |
| `version` | schema version | `2` |
| `tempo.bpm` | tempo | 60–200 typical (clamped 40–240) |
| `tempo.swing` | swing % on 16ths | 0–80 |
| `grid.bars` | bars per **pattern** (shared by all patterns) | one of `1, 2, 4, 8` |
| `grid.stepsPerBar` | fixed | always `16` (16th-note grid) |
| `master.volume` | master gain, dB | −40…0 (default −8) |
| `master.filter` | master low-pass base cutoff, Hz | 100–20000 (20000 = open) |
| `master.reverb` | master reverb wet | 0–1 |
| `activePattern` | index into `patterns` shown in the editor | 0-based |
| `patterns` | ≥1 Pattern | see below |
| `playMode` | what ▶ plays | `"song"` (whole arrangement) or `"pattern"` (loop active pattern) |
| `song.loop` | loop the whole song | boolean |
| `song.sections` | ordered Section list | may be empty in `pattern` mode; **required for a full song** |

A **step index** is `0 … grid.bars*16 − 1`. Bar `b`, beat `q` (0–3), sixteenth `s` (0–3) → `step = b*16 + q*4 + s`.

## Pattern & the five layers

A pattern is one loop of `grid.bars` bars, holding all five layers' content.

```json
{
  "id": "p1",
  "name": "A",
  "enabled": { "drums": true, "bass": true, "harmony": true, "melody": true, "fx": true },
  "layers": {
    "drums":   { "engine": "synth", "machine": "TR-808", "tracks": [ /* 6 tracks */ ] },
    "bass":    { "instrument": "MonoSynth", "sidechain": { "on": true, "source": "kick", "amount": 0.75 }, "notes": [] },
    "harmony": { "instrument": "poly-saw", "mode": "pad", "rate": "16n", "octave": 4, "reverb": 0.4, "chorus": 0.2, "chords": [] },
    "melody":  { "instrument": "FMSynth", "key": "C", "scale": "minor", "reverb": 0.25, "notes": [] },
    "fx":      { "events": [] }
  }
}
```

- `id` — unique within the file (`"p1"`, `"p2"`, …). **Sections reference patterns by this id.**
- `name` — short label shown on the chip (`"A"`, `"B"`, `"Drop"`).
- `enabled` — **optional** `{drums,bass,harmony,melody,fx}` booleans, default all `true`. Gates which whole layers
  sound in **pattern-loop** playback (the pattern bar's 启用层 toggles). In song mode a layer plays only if
  `enabled[k]` **and** the section's `layers[k]` are both true. Omit to keep all layers on (the usual case).

### drums
Fixed **6 tracks**, in this order and with these `id`s (do not rename ids):

| id | name | typical role |
|---|---|---|
| `kick` | 底鼓 Kick | low-end pulse |
| `snare` | 军鼓 Snare | backbeat |
| `clap` | 拍手 Clap | backbeat layer / claps |
| `chh` | 闭镲 CH | closed hats (groove) |
| `ohh` | 开镲 OH | open hats (accents) |
| `perc` | 打击 Perc | shaker / tom / fills |

Each track:
```json
{ "id": "kick", "name": "底鼓 Kick", "color": "--kick", "sample": "kick",
  "steps": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, /* … length = bars*16 */],
  "gain": 0, "mute": false, "solo": false }
```
- `steps` — **array of length `grid.bars*16`**. Each value: `0` = off, `1` = hit, `2` = accent (louder).
- `color` — CSS var name, one of `--kick --snare --clap --hat --perc` (cosmetic; keep the defaults above).
- `sample` — friendly name used only in **sample** engine (`kick/snare/clap/hihat-close/hihat-open/tom`); auto-remapped to the machine's actual groups at runtime. Keep defaults.
- `gain` dB (−12…6), `mute`, `solo`.
- `engine`: `"synth"` (Tone.js, fully offline — **default & recommended**) or `"sample"` (smplr real drum machine, needs first-load internet). `machine` ∈ the drum-machine enum.

### bass
```json
{ "instrument": "MonoSynth", "sidechain": { "on": true, "source": "kick", "amount": 0.75 }, "notes": [ { "step": 0, "len": 2, "midi": 36 } ] }
```
- `notes` — `{ step, len, midi }`. `len` in 16th steps (≥1). `midi` bass range **24–50** (C1–D3) to be visible & musical.
- `sidechain.source` — a drum track id (usually `"kick"`); `amount` 0–1 (ducking depth). This is the kick↔bass "pump".

### harmony
```json
{ "instrument": "poly-saw", "mode": "pad", "rate": "16n", "octave": 4, "reverb": 0.4, "chorus": 0.2,
  "chords": [ { "root": "C", "quality": "min7" }, { "root": "G#", "quality": "maj7" } ] }
```
- `chords` — **one entry per bar** (length = `grid.bars`). `root` ∈ `C … B` (or `"—"` for a silent bar). `quality` ∈ chord enum.
- `mode` — `pad` (sustained), `arp` (arpeggiated at `rate`), `pluck` (staccato on beats). `octave` 1–6.

### melody
```json
{ "instrument": "FMSynth", "key": "C", "scale": "minor", "reverb": 0.25,
  "notes": [ { "step": 0, "len": 4, "midi": 72 } ] }
```
- `notes` — same shape as bass. `midi` melody range **48–84** (C3–C6). `key`+`scale` drive the editor's in-scale highlight; keep melody notes **in that scale**.

### fx
```json
{ "events": [ { "type": "impact", "step": 0, "len": 2 }, { "type": "riser", "step": 16, "len": 16 } ] }
```
- `events` — `{ type, step, len }`. `type` ∈ fx enum. `len` in 16th steps. Placed within the pattern; they re-fire each loop and (in song mode) whenever that pattern's section has its `fx` layer enabled.

## Section

The **song-structure layer**. Each section plays one pattern for `repeats × grid.bars` bars, gating layers and shaping dynamics.

```json
{
  "id": "s1",
  "type": "build",
  "pattern": "p1",
  "repeats": 2,
  "layers": { "drums": true, "bass": true, "harmony": true, "melody": true, "fx": true },
  "dyn": { "filterFrom": 2500, "filterTo": 18000, "fadeIn": false, "fadeOut": false, "autoRiser": true, "autoImpact": false }
}
```

| field | meaning |
|---|---|
| `type` | `intro` \| `verse` \| `build` \| `drop` \| `break` \| `outro` |
| `pattern` | id of a pattern in `patterns[]` |
| `repeats` | how many times the pattern loops (1–16); section length = `repeats × grid.bars` bars |
| `layers.*` | which layers sound in this section (booleans) — the core of intro/build energy |
| `dyn.filterFrom/To` | master LP cutoff Hz ramped across the section (100–20000) — "opening up" into a drop |
| `dyn.fadeIn/fadeOut` | volume fade over the first / last ~2 bars |
| `dyn.autoRiser` | fire a Riser in the section's last bar (great on `build`) |
| `dyn.autoImpact` | fire an Impact at the section start (great on `drop`) |

**Preset defaults per type** (the tool fills these when a section is created; emit values consistent with them):

| type | layers on | filterFrom→To | fade | auto |
|---|---|---|---|---|
| `intro` | harmony, melody | 700 → 6000 | fadeIn | — |
| `verse` | drums, bass, harmony, melody | 13000 → 14000 | — | — |
| `build` | all five | 2500 → 18000 | — | autoRiser |
| `drop` | all five | 20000 → 20000 | — | autoImpact |
| `break` | harmony, melody, fx | 9000 → 9000 | fadeIn | — |
| `outro` | drums, harmony | 12000 → 600 | fadeOut | — |

## Enumerations (exact strings)

- **drum machine** (`layers.drums.machine`): `TR-808` `Casio-RZ1` `LM-2` `MFB-512` `Roland CR-8000`
- **bass.instrument**: `MonoSynth` `FMSynth` `AMSynth` `DuoSynth` · samples: `sf:synth_bass_1` `sf:synth_bass_2` `sf:electric_bass_finger` `sf:acoustic_bass`
- **melody.instrument**: `FMSynth` `MonoSynth` `DuoSynth` `AMSynth` · samples: `sf:lead_1_square` `sf:lead_2_sawtooth` `sf:lead_8_bass__lead` `sf:voice_oohs`
- **harmony.instrument**: `poly-saw` `poly-square` `poly-sine` · samples: `sf:pad_2_warm` `sf:pad_1_new_age` `sf:choir_aahs` `sf:string_ensemble_1`
- **chord quality**: `maj` `min` `maj7` `min7` `7` `sus2` `sus4` `dim` `aug` `add9` `min9` `6`
- **scale**: `major` `minor` `dorian` `penta-min` `chromatic`
- **harmony.mode**: `pad` `arp` `pluck` · **arp rate**: `16n` `8n` `8t` `4n`
- **fx event type**: `riser` `downlifter` `impact` `reverse` `sweep`
- **note name (root / key)**: `C C# D D# E F F# G G# A A# B` (sharps only; use `G#`, not `Ab`)

> `sf:*` values are real GM samples loaded from a CDN on first use (then cached). **Default to the plain synth
> names** so the arrangement plays fully offline; only choose `sf:*` if the user asks for realistic/sampled timbre.

MIDI reference: middle C `C4 = 60`. So bass root `C2 = 36`, `G#1 = 32`; melody `C5 = 72`.

## Full worked example

A minimal but complete 2-bar, 2-pattern, 5-section House song (Pattern A groove + Pattern B drop-variant):

```json
{
  "format": "todo-music-arranger", "version": 2,
  "tempo": { "bpm": 124, "swing": 0 },
  "grid": { "bars": 2, "stepsPerBar": 16 },
  "master": { "volume": -8, "filter": 20000, "reverb": 0.18 },
  "activePattern": 0, "playMode": "song",
  "patterns": [
    { "id": "p1", "name": "A", "layers": {
      "drums": { "engine": "synth", "machine": "TR-808", "tracks": [
        { "id": "kick",  "name": "底鼓 Kick",  "color": "--kick",  "sample": "kick",        "steps": [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "snare", "name": "军鼓 Snare", "color": "--snare", "sample": "snare",       "steps": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "clap",  "name": "拍手 Clap",  "color": "--clap",  "sample": "clap",        "steps": [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "chh",   "name": "闭镲 CH",    "color": "--hat",   "sample": "hihat-close", "steps": [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], "gain": 0, "mute": false, "solo": false },
        { "id": "ohh",   "name": "开镲 OH",    "color": "--hat",   "sample": "hihat-open",  "steps": [0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "perc",  "name": "打击 Perc",  "color": "--perc",  "sample": "tom",         "steps": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], "gain": 0, "mute": false, "solo": false }
      ] },
      "bass": { "instrument": "MonoSynth", "sidechain": { "on": true, "source": "kick", "amount": 0.75 },
        "notes": [ {"step":0,"len":2,"midi":36},{"step":3,"len":2,"midi":36},{"step":6,"len":2,"midi":36},{"step":10,"len":2,"midi":36},{"step":13,"len":2,"midi":36},
                   {"step":16,"len":2,"midi":32},{"step":19,"len":2,"midi":32},{"step":22,"len":2,"midi":32},{"step":26,"len":2,"midi":32},{"step":29,"len":2,"midi":32} ] },
      "harmony": { "instrument": "poly-saw", "mode": "pad", "rate": "16n", "octave": 4, "reverb": 0.4, "chorus": 0.2,
        "chords": [ {"root":"C","quality":"min7"}, {"root":"G#","quality":"maj7"} ] },
      "melody": { "instrument": "FMSynth", "key": "C", "scale": "minor", "reverb": 0.25,
        "notes": [ {"step":0,"len":2,"midi":72},{"step":2,"len":2,"midi":75},{"step":4,"len":4,"midi":74},{"step":12,"len":4,"midi":70},{"step":26,"len":6,"midi":67} ] },
      "fx": { "events": [] }
    } },
    { "id": "p2", "name": "B", "layers": {
      "drums": { "engine": "synth", "machine": "TR-808", "tracks": [
        { "id": "kick",  "name": "底鼓 Kick",  "color": "--kick",  "sample": "kick",        "steps": [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "snare", "name": "军鼓 Snare", "color": "--snare", "sample": "snare",       "steps": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "clap",  "name": "拍手 Clap",  "color": "--clap",  "sample": "clap",        "steps": [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "chh",   "name": "闭镲 CH",    "color": "--hat",   "sample": "hihat-close", "steps": [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], "gain": 0, "mute": false, "solo": false },
        { "id": "ohh",   "name": "开镲 OH",    "color": "--hat",   "sample": "hihat-open",  "steps": [0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0], "gain": 0, "mute": false, "solo": false },
        { "id": "perc",  "name": "打击 Perc",  "color": "--perc",  "sample": "tom",         "steps": [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0], "gain": 0, "mute": false, "solo": false }
      ] },
      "bass": { "instrument": "MonoSynth", "sidechain": { "on": true, "source": "kick", "amount": 0.8 },
        "notes": [ {"step":0,"len":2,"midi":36},{"step":3,"len":2,"midi":36},{"step":6,"len":2,"midi":36},{"step":10,"len":2,"midi":36},{"step":13,"len":2,"midi":36},
                   {"step":16,"len":2,"midi":32},{"step":19,"len":2,"midi":32},{"step":22,"len":2,"midi":32},{"step":26,"len":2,"midi":32},{"step":29,"len":2,"midi":32} ] },
      "harmony": { "instrument": "poly-saw", "mode": "pluck", "rate": "16n", "octave": 4, "reverb": 0.4, "chorus": 0.2,
        "chords": [ {"root":"C","quality":"min7"}, {"root":"G#","quality":"maj7"} ] },
      "melody": { "instrument": "FMSynth", "key": "C", "scale": "minor", "reverb": 0.25,
        "notes": [ {"step":0,"len":2,"midi":79},{"step":2,"len":2,"midi":84},{"step":4,"len":4,"midi":82},{"step":12,"len":4,"midi":77},{"step":26,"len":6,"midi":74} ] },
      "fx": { "events": [ {"type":"impact","step":0,"len":2} ] }
    } }
  ],
  "song": { "loop": true, "sections": [
    { "id":"s1", "type":"intro", "pattern":"p1", "repeats":2, "layers":{"drums":false,"bass":false,"harmony":true,"melody":true,"fx":false}, "dyn":{"filterFrom":700,"filterTo":6000,"fadeIn":true,"fadeOut":false,"autoRiser":false,"autoImpact":false} },
    { "id":"s2", "type":"verse", "pattern":"p1", "repeats":4, "layers":{"drums":true,"bass":true,"harmony":true,"melody":true,"fx":false}, "dyn":{"filterFrom":13000,"filterTo":14000,"fadeIn":false,"fadeOut":false,"autoRiser":false,"autoImpact":false} },
    { "id":"s3", "type":"build", "pattern":"p1", "repeats":2, "layers":{"drums":true,"bass":true,"harmony":true,"melody":true,"fx":true}, "dyn":{"filterFrom":2500,"filterTo":18000,"fadeIn":false,"fadeOut":false,"autoRiser":true,"autoImpact":false} },
    { "id":"s4", "type":"drop", "pattern":"p2", "repeats":4, "layers":{"drums":true,"bass":true,"harmony":true,"melody":true,"fx":true}, "dyn":{"filterFrom":20000,"filterTo":20000,"fadeIn":false,"fadeOut":false,"autoRiser":false,"autoImpact":true} },
    { "id":"s5", "type":"outro", "pattern":"p1", "repeats":2, "layers":{"drums":true,"bass":false,"harmony":true,"melody":false,"fx":false}, "dyn":{"filterFrom":12000,"filterTo":600,"fadeIn":false,"fadeOut":true,"autoRiser":false,"autoImpact":false} }
  ] }
}
```

## Validation rules

Check every arrangement before writing — the tool won't crash on bad data (it clamps), but it will silently
*change* your intent. Verify:

1. **Step arrays** — every `drums.tracks[].steps` has length exactly `grid.bars*16`; values ∈ {0,1,2}.
2. **Note/event steps** in `0 … grid.bars*16−1`; `len ≥ 1`; `bass.midi ∈ 24–50`, `melody.midi ∈ 48–84`.
3. **Chords** — `harmony.chords` length = `grid.bars`; every `root` is a valid sharp note name or `"—"`; `quality` in enum.
4. **Enums** — all instrument / machine / mode / scale / fx-type / section-type strings match the lists above (sharps only, e.g. `G#`).
5. **Section refs** — every `section.pattern` equals some `patterns[].id`.
6. **Musicality** — melody notes fall in the declared `key`+`scale`; bass roots agree with the chord roots; kick and bass don't fight (bass often sits *between* kicks or is sidechained).
7. **Structure** — `playMode:"song"` has a non-empty `sections`; a sensible arc (usually intro→…→drop→…→outro); total length reasonable (≈32–96 bars).

## How it is imported

There is **no watched folder** for arrangements (unlike quiz's `question-bank/`). The user opens the tool
(🎹 电子编曲) and clicks **导入**, then picks your `.json`. So the output path is for the user's convenience only —
default `arrangements/<slug>-<YYYY-MM-DD>.json` at the project root. Tell the user the path and that they import
via the 导入 button, then press ▶ (整首歌曲) to play.
