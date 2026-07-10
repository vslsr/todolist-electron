# 风格套路 · Genre Playbook

Opinionated starting points so an arrangement sounds *like the genre* instead of generic. Steps are 0-indexed
**within one bar** (16 steps: beats on 0/4/8/12, offbeat 8ths on 2/6/10/14, the "and"s). Apply the same pattern
to every bar (`step + bar*16`). Accent = value `2`. Pick a genre, then adapt to the user's mood/references.

Legend: K=kick S=snare/clap CH=closed-hat OH=open-hat P=perc. "SC" = kick→bass sidechain.

---

## House / Deep House — 120–126 BPM, key A/C minor, groove & warmth
- **K** four-on-floor `0,4,8,12`. **Clap** backbeat `4,12`. **CH** offbeat `2,6,10,14`. **OH** accent on the last "and" (`7`,`15` as accent 2). **P** light shaker/fill on `15`.
- **Bass**: rolling, sits under/between kicks, SC on ~0.7. `MonoSynth` sawtooth. Root of the bar's chord at C1–C2.
- **Harmony**: warm 7th pads (`min7`, `maj7`), `mode:"pad"`, `poly-saw`, reverb ~0.4. 2 chords looping (i → VI works: `Cmin7 → G#maj7`).
- **Melody**: sparse, soulful `FMSynth` hook in the minor scale; leave space.
- **Structure**: intro(pad) → verse → build(riser) → drop(fuller hats, pluck chords) → verse/break → outro. Drop uses Pattern B with denser `CH` + `mode:"pluck"`.

## Techno — 128–140 BPM, dark, hypnotic, minimal
- **K** `0,4,8,12` (dominant). **CH** straight 16ths `0..15` or offbeats; **OH** accent `2,6,10,14`. **Clap/S** sparse or none. **P** syncopated `3,11`.
- **Bass**: one-note driving offbeat stab (`2,6,10,14`) or rumble; `MonoSynth`/`FMSynth`, heavy SC 0.8.
- **Harmony**: minimal — a single sustained `min`/`sus2` stab or none; `mode:"pluck"`, dark. Often just 1 chord.
- **Melody**: atonal blips / a 3–4 note motif; sparse. Let the groove carry it.
- **Structure**: long intro, gradual layer adds, few big drops — energy via filter opening + adding `OH`/`perc`. Lean on `dyn.filterFrom→To` more than melody.

## Trance — 136–140 BPM, uplifting, epic
- **K** four-on-floor. **CH** offbeats `2,6,10,14`. **OH** on every offbeat for drive. **Clap** `4,12`.
- **Bass**: classic rolling **16th offbeat** — hits on `2,3,6,7,10,11,14,15` short notes, SC ~0.8 so it "breathes" under the kick.
- **Harmony**: big supersaw `poly-saw`, lush `mode:"pad"`; emotional 4-chord progression (e.g. `Fmin → G#maj → D#maj → A#min`) → use `grid.bars:4`, one chord per bar.
- **Melody**: soaring lead, longer notes, `FMSynth`/`DuoSynth`, higher octave (C5–C6).
- **Structure**: long **build** with `autoRiser`, filter 2000→18000, then **drop** with `autoImpact`. This is the genre's whole point — make the build/drop dynamics strong.

## Lo-fi / Chill-hop — 70–90 BPM, jazzy, mellow, swung
- Add **`tempo.swing` 15–30**. **K** `0,10` (laid-back) + soft `6`. **S/clap** backbeat `4,12`. **CH** `2,6,10,14` soft (low gain). **P** occasional.
- **Bass**: soft, few notes, walking-ish; `sf:acoustic_bass` or `MonoSynth` mellow; SC low/off.
- **Harmony**: jazzy `maj7`/`min7`/`min9`/`add9`, `mode:"pad"` or gentle `pluck`, `poly-sine`, reverb ~0.35. Rich 2–4 chord loops.
- **Melody**: simple, human, a little behind the beat; low velocity feel via fewer accents.
- **Structure**: short intro → long verse loop → tiny break → outro. Low energy variance; skip big drops (a `verse`/`break` centric arc). No/mild FX.

## Synthwave / Retrowave — 100–118 BPM, 80s nostalgia
- **K** `0,4,8,12`. **S/clap** big gated backbeat `4,12`. **CH** `2,6,10,14`. **P** tom fills at bar ends `14,15`.
- **Bass**: driving 8th-note or **arpeggiated** root-fifth-octave; `MonoSynth` saw, moderate SC.
- **Harmony**: `poly-saw`/`poly-square`, `mode:"arp"` rate `16n` for that pulsing arp, or `pad` for choruses; min/maj mix.
- **Melody**: bold, memorable lead (`sf:lead_2_sawtooth` or `FMSynth`), mid-high register.
- **Structure**: intro(arp) → verse → chorus(=drop, full) → verse → outro. Use `reverse`/`sweep` FX at transitions.

## Dubstep / Half-time bass — 140 BPM (half-time feel), heavy
- **K** on `0` (and `6`/`10` ghost). **S** on `8` only (half-time backbeat = the signature). **CH** 16ths with gaps; **P** syncopated.
- **Bass**: THE lead — aggressive `FMSynth`, growly, syncopated stabs; strong SC. Wide note movement.
- **Harmony**: minimal/dark, single `min` stab or dissonant `dim`; often just texture.
- **Melody**: a hook in the intro/build, then the bass IS the drop.
- **Structure**: intro → **build** (autoRiser, big filter open) → **drop** (autoImpact, half-time, bass-forward) → break → drop2. Dynamics + FX are everything.

---

## Cross-genre defaults
- Start at `grid.bars: 2` for simple loops; use `4` when the chord progression needs 4 bars.
- Two patterns is usually enough: **A** (main groove) + **B** (drop variant: denser hats, `pluck` chords, hook higher but ≤ C6, add an `impact`). More only if the song truly needs a distinct section.
- Keep `bass.midi` around 32–40 and `melody.midi` around 67–84; keep both in the declared key/scale.
- Prefer synth instruments (offline). Use `sf:*` samples only when the user wants realistic/analog timbre and accepts first-load internet.
- Energy is shaped mostly by **which layers each section enables** + **`dyn` filter/fade/auto-FX**, not by rewriting notes. Intro strips to pad+melody; build opens the filter and adds a riser; drop slams with impact and full layers; outro fades and closes the filter.
