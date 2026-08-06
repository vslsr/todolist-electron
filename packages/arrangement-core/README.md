# arrangement-core

Parse, validate & query the **`todo-music-arranger` (v2)** arrangement JSON — the
format authored by the Electron **🎹 电子编曲** tool and its `music-arrangement-authoring`
skill. One file of loops (drums / bass / harmony / melody / fx) plus a song
timeline (intro → verse → build → drop → break → drop → outro).

- **Zero dependencies.** No DOM, no Tone.js, no audio context. Pure data in → pure data out.
- **Faithful.** Normalization mirrors the tool's importer (`coerceProject`) exactly; the
  event query mirrors its playback triggers (layer gating, drum solo/mute, harmony
  pad/pluck/arp expansion). What you get here is what the tool plays.
- **Universal.** Ships UMD (`require` / `<script>` global `ArrangementCore`) + native ESM + TypeScript types.

> Use it to build your own player, visualizer, WAV/MIDI exporter, chord chart, or to
> validate arrangements in CI — in any project, without pulling in the Electron app.

## Install / use

No build step. Copy the `arrangement-core/` folder into your project, or install it as a
local package. Then:

```js
// ESM / bundler / TypeScript
import { parseArrangement, getSongEvents, validateArrangement } from 'arrangement-core';

// CommonJS
const AC = require('arrangement-core');

// Browser <script> (global)
// <script src="arrangement-core.js"></script>  →  window.ArrangementCore
```

## Quick start

```js
import { validateArrangement, summarize, getSongEvents, getChordChart } from 'arrangement-core';
import fs from 'node:fs';

const json = fs.readFileSync('microbe-bounce-2026-07-10.json', 'utf8');

// 1) Validate (strict, non-mutating) — great for CI / an authoring tool
const { ok, errors, warnings } = validateArrangement(json);
// ok: true, errors: [], warnings: []

// 2) One-line overview
summarize(json);
// { bpm: 126, key: 'D', scale: 'dorian', bars: 2, totalBars: 40, durationSec: 76.19,
//   playMode: 'song', patterns: [{id:'p1',name:'A'},{id:'p2',name:'B'}],
//   sections: [ {type:'intro',bars:4,startSec:0,durSec:7.62}, ... 7 sections ] }

// 3) Flatten the whole song into timed events (nominal tempo, seconds from start)
const events = getSongEvents(json);   // 1803 events for the microbe track
// [ { kind:'harmony', note:'D4', midi:62, timeSec:0,     bar:0, sectionType:'intro', ... },
//   { kind:'melody',  note:'D5', midi:74, timeSec:0,     bar:0, durSec:0.238, ... },
//   { kind:'harmony', note:'F4', midi:65, timeSec:0.119, bar:0, arpIndex:1, ... }, ... ]

// 4) Harmonic map, one entry per bar of the whole song
getChordChart(json);
// [ { bar:0, startSec:0,    root:'D', quality:'min9', notes:[62,65,69,72,76] },
//   { bar:1, startSec:1.90, root:'G', quality:'add9', notes:[67,71,74,81] }, ... ]
```

## API

### Parse & validate

| function | returns | notes |
|---|---|---|
| `parseArrangement(input)` | `Project` | Normalizes raw JSON (string **or** object) into a valid v2 project — fills defaults, clamps ranges, migrates v1 (`layers` → pattern A). Mirrors the tool's importer. Throws `SyntaxError` only when a JSON **string** can't be parsed. |
| `validateArrangement(input)` | `{ ok, errors[], warnings[] }` | Strict, **non-mutating** check of the raw input against the schema contract. `errors` = data that would be **dropped/corrupted** on import (bad step-array length, `chords.length ≠ bars`, unknown enum, unresolved `section.pattern`). `warnings` = imports but changes intent (out-of-range clamps, notes out of the declared scale, empty song, …). |
| `isArrangement(input)` | `boolean` | Cheap heuristic — does this look like an arrangement? |
| `coerceProject(raw)` / `defaultProject()` | `Project` | Lower-level building blocks. |

### Query (accept a Project, or raw JSON string/object — auto-normalized)

| function | returns | notes |
|---|---|---|
| `getTimeline(input)` | `Timeline` | `totalBars`, `totalSteps`, `durationSec`, `stepSec`, and per-section `{ startBar, bars, startStep, steps, startSec, durSec, layers, dyn }`. |
| `getDurationSeconds(input)` | `number` | Song length in seconds (nominal tempo). |
| `getSongEvents(input, opts?)` | `ArrangementEvent[]` | Every sounding event across the song timeline, time-ordered. Options: `onlyAudible` (default `true` — apply layer gating + drum solo/mute), `includeFx`, `includeAutoFx` (section `autoRiser`/`autoImpact`). |
| `getPatternEvents(input, patternRef?, opts?)` | `ArrangementEvent[]` | Events for **one loop** of a single pattern (by id, index, or object), times from 0. `opts.ignoreEnabled` to bypass the pattern's `enabled` flags. |
| `getChordChart(input)` | `ChordChartEntry[]` | One entry per bar of the whole song: `root`, `quality`, resolved `notes[]` (MIDI), `startSec` — independent of harmony mode. |
| `summarize(input)` | `Summary` | Compact human overview (see Quick start). |
| `patternById(project, id)` | `Pattern \| null` | |

### Music theory

`chordToMidi(chord, octave)` · `midiToNoteName(midi)` · `noteNameToPitchClass(name)` ·
`scaleSemitones(scale)` · `isInScale(midi, key, scale)` · `rateToSteps(rate)`

```js
chordToMidi({ root: 'C', quality: 'maj' }, 4); // [60, 64, 67]
midiToNoteName(38);                            // 'D2'
isInScale(73, 'D', 'dorian');                  // false (C# not in D dorian)
```

### Constants

`STEPS_PER_BAR` (16) · `NOTE_NAMES` · `CHORD_QUALITIES` · `SCALES` · `DRUM_ROWS` ·
`DRUM_MACHINES` · `FX_TYPES` · `SECTION_TYPES` · `SECTION_PRESET` · `RANGES` · `VERSION`

## The `ArrangementEvent`

```ts
{
  kind: 'drum' | 'bass' | 'melody' | 'harmony' | 'fx',
  step, localStep, stepInBar, bar,   // grid position (global step, step within pattern loop, 0..15, global bar)
  timeSec, durSec, lenSteps,         // timing (seconds are nominal — swing is NOT applied)
  audible, sectionId, sectionType, patternId,
  // drum:    track, name, accent, velocity, gain
  // bass/melody & arp-harmony: midi, note
  // pad/pluck-harmony:         mode, root, quality, octave, notes[], noteNames[]
  // fx:      fxType, auto      // auto=true → section-level autoRiser/autoImpact
}
```

## Interactive music (Wwise-style)

Drive different **game scenes / themes** from one arrangement — Wwise-style **vertical
layering** (fade stems in/out) + **horizontal re-sequencing** (switch which pattern's
content plays), with synchronized transitions and RTPC.

Add an optional `interactive` block to the JSON (existing files keep working):

```jsonc
"interactive": {
  "loopBars": 2,
  "channels": [                                   // stems, each bound to (pattern, layer) sources
    { "id": "pad",   "name": "氛围铺底", "sources": [{ "pattern": "p1", "layer": "harmony" }], "gain": 0 },
    { "id": "lead",  "name": "旋律",     "sources": [{ "pattern": "p1", "layer": "melody"  }], "gain": 0 },
    { "id": "drive", "name": "驱动鼓组", "sources": [{ "pattern": "p2", "layer": "drums" }, { "pattern": "p2", "layer": "bass" }], "gain": 0, "rtpc": "intensity" }
  ],
  "rtpc": [{ "id": "intensity", "name": "强度", "min": 0, "max": 1, "default": 0 }],
  "scenes": [                                      // game States: which channels are ON (+ master mood + rtpc)
    { "id": "explore", "name": "探索", "on": ["pad", "lead"],          "master": { "filter": 6000 } },
    { "id": "combat",  "name": "战斗", "on": ["pad", "lead", "drive"], "master": { "filter": 20000 }, "rtpc": { "intensity": 0.9 } }
  ],
  "default": "explore",
  "transition": { "sync": "nextBar", "fadeSec": 1.0 }   // sync: immediate | nextBeat | nextBar | nextLoop
}
```

**Bind channels to different patterns** to get horizontal re-sequencing (a scene that turns on
pattern-B channels literally plays a different 段落); **toggle channels within a scene** for
vertical layering. `generateDefaultInteractive(project)` scaffolds a starter block from any arrangement.

### Runtime — two ways to drive it

**A. Engine-agnostic controller** (your game renders audio; it just tells you the target mix + timing):

```js
import { InteractiveMusicController } from 'arrangement-core';
const sink = {
  now: () => myTransportSeconds(),
  setChannelGain: (id, db, at, ramp) => myMixer.rampGain(id, db, at, ramp),
  setMaster: (kind, val, at, ramp) => myMixer.ramp(kind, val, at, ramp),
};
const ctrl = new InteractiveMusicController(projectJson, sink);
ctrl.start();
ctrl.setScene('combat');              // synced at next bar, cross-faded
ctrl.setChannel('drive', false);      // toggle a stem
ctrl.setRTPC('intensity', 0.8);       // continuous tension
```

**B. Tone.js reference player** (plays out of the box; Tone is dependency-injected):

```js
import * as Tone from 'tone';
import ArrangementCore from 'arrangement-core';
import { InteractiveMusicPlayer } from 'arrangement-core/interactive-tone-player';

const player = new InteractiveMusicPlayer(projectJson, { Tone, ArrangementCore });
await player.play();                   // everything phase-locked; gains gate audibility
player.setScene('combat');
player.setChannel('drive', false);
player.setRTPC('intensity', 0.8);
```

Everything plays in sync and always running; a channel's **Gain node gates audibility**, so scene
changes are glitch-free cross-fades. Pure resolvers are also exported: `resolveScene`,
`getChannelClip`, `computeChannelGainDb`, `listScenes`, `listChannels`.

> Also wired into the Electron tool: 🎹 电子编曲 → **场景 Scenes** tab → 生成声道 → ▶ 试听 → click scenes / toggle channels / drag RTPC curves / fire stingers / export MIDI.

### Stingers — one-shot phrases

Short musical accents layered over the running music, quantized to a sync boundary (a hit, a
pickup, a UI sting). Add `interactive.stingers`, each bound to `(pattern, layer)` sources:

```jsonc
"stingers": [
  { "id": "hit", "name": "命中", "sources": [{ "pattern": "p2", "layer": "melody" }], "sync": "nextBeat", "gain": -2 }
]
```

```js
player.triggerStinger('hit');            // fires at the next beat, on top of the mix
ctrl.triggerStinger('hit', { sync: 'nextBar', gain: -6 });
```

### RTPC response curves

A channel's `rtpc` binding maps the (normalized) param value → gain multiplier through an
**editable piecewise-linear curve** (Wwise-style). String form = linear; object form gives a curve:

```jsonc
{ "id": "drive", "sources": [...], "rtpc": { "param": "intensity", "curve": [[0,0],[0.7,0.1],[1,1]] } }
```

```js
evalCurve([[0,0],[0.7,0.1],[1,1]], 0.5);          // → ~0.07 (ease-in)
ctrl.setChannelCurve('drive', [[0,0],[1,1]]);      // live re-shape (linear)
```

The tool's Scenes tab renders a draggable curve editor per binding (drag points, double-click to
add/remove, presets 线性/渐入/渐出/S) with a live operating-point marker.

### MIDI export

Encode the arrangement as a Standard MIDI File (format 1) — pure, returns bytes. Tracks: Drums
(GM percussion, ch 10), Bass, Harmony, Melody + a tempo conductor track.

```js
import { toMIDI } from 'arrangement-core';
const bytes = toMIDI(projectJson);                     // Uint8Array — whole song
const patt  = toMIDI(projectJson, { source: 'pattern', patternRef: 'p1', ppq: 960 });
fs.writeFileSync('song.mid', bytes);                   // or Blob + download in a browser
```

## Notes & limits

- **Timing is nominal.** `timeSec` uses `60/bpm/4` per 16th. The `swing` value is exposed on
  the timeline but **not** baked into event times — apply it yourself if you need swung playback.
- **Section dynamics** (filter sweep, fade in/out) are exposed per section (`section.dyn`) but are
  audio envelopes, not discrete events. `autoRiser`/`autoImpact` *are* emitted as `fx` events (`auto:true`).
- Normalization matches the **importer's** clamp ranges (bass MIDI 12–60, melody 36–96), which are
  wider than the schema's *recommended* ranges (24–50 / 48–84). `validateArrangement` warns on the
  recommended ranges so authoring tools can nudge toward musical values.
- Mirrors the tool as of arranger schema **v2**. If the tool's `coerceProject` changes, update this too.

## Test

```
node --test        # 11 tests, incl. an end-to-end check against a real arrangement
```

MIT.
