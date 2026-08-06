import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import AC from '../arrangement-core.js';            // CJS default (require path)
import * as ESM from '../arrangement-core.mjs';     // native ESM shim

const __dirname = dirname(fileURLToPath(import.meta.url));

// A compact but complete 2-bar, 2-pattern, song fixture.
const FIX = {
  format: 'todo-music-arranger', version: 2,
  tempo: { bpm: 120, swing: 0 }, grid: { bars: 2, stepsPerBar: 16 },
  master: { volume: -8, filter: 20000, reverb: 0.15 },
  activePattern: 0, playMode: 'song',
  patterns: [
    {
      id: 'p1', name: 'A', layers: {
        drums: { engine: 'synth', machine: 'TR-808', tracks: [
          { id: 'kick', name: 'k', color: '--kick', sample: 'kick', steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], gain: 0, mute: false, solo: false },
        ] },
        bass: { instrument: 'MonoSynth', sidechain: { on: true, source: 'kick', amount: 0.7 }, notes: [{ step: 2, len: 1, midi: 38 }] },
        harmony: { instrument: 'poly-saw', mode: 'arp', rate: '16n', octave: 4, reverb: 0.4, chorus: 0.2, chords: [{ root: 'D', quality: 'min9' }, { root: 'G', quality: 'add9' }] },
        melody: { instrument: 'FMSynth', key: 'D', scale: 'dorian', reverb: 0.25, notes: [{ step: 0, len: 2, midi: 74 }] },
        fx: { events: [{ type: 'sweep', step: 24, len: 8 }] },
      },
    },
    {
      id: 'p2', name: 'B', layers: {
        drums: { engine: 'synth', machine: 'TR-808', tracks: [] },
        bass: { instrument: 'MonoSynth', sidechain: { on: true, source: 'kick', amount: 0.7 }, notes: [] },
        harmony: { instrument: 'poly-saw', mode: 'pad', rate: '16n', octave: 4, reverb: 0.4, chorus: 0.2, chords: [{ root: 'D', quality: 'min7' }, { root: 'G', quality: 'maj' }] },
        melody: { instrument: 'FMSynth', key: 'D', scale: 'dorian', reverb: 0.25, notes: [{ step: 0, len: 2, midi: 81 }] },
        fx: { events: [{ type: 'impact', step: 0, len: 2 }] },
      },
    },
  ],
  song: { loop: true, sections: [
    { id: 's1', type: 'intro', pattern: 'p1', repeats: 2, layers: { drums: false, bass: false, harmony: true, melody: true, fx: false }, dyn: { filterFrom: 700, filterTo: 6000, fadeIn: true, fadeOut: false, autoRiser: false, autoImpact: false } },
    { id: 's2', type: 'drop', pattern: 'p2', repeats: 2, layers: { drums: true, bass: true, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 20000, filterTo: 20000, fadeIn: false, fadeOut: false, autoRiser: false, autoImpact: true } },
  ] },
};

test('CJS and ESM entries expose the same API', () => {
  assert.equal(typeof AC.parseArrangement, 'function');
  assert.equal(ESM.parseArrangement, AC.parseArrangement);
  assert.equal(ESM.default.getSongEvents, AC.getSongEvents);
});

test('parseArrangement accepts object and JSON string, and is idempotent', () => {
  const a = AC.parseArrangement(FIX);
  const b = AC.parseArrangement(JSON.stringify(FIX));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  const c = AC.parseArrangement(a); // re-parse normalized → same
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(c)));
  assert.equal(a.format, 'todo-music-arranger');
  assert.equal(a.version, 2);
});

test('normalization fills defaults, clamps ranges, migrates v1', () => {
  // v1: single `layers`, no patterns[]
  const v1 = { layers: FIX.patterns[0].layers, tempo: { bpm: 9999 }, grid: { bars: 3 /* invalid → 2 */ } };
  const p = AC.parseArrangement(v1);
  assert.equal(p.patterns.length, 1);
  assert.equal(p.patterns[0].name, 'A');
  assert.equal(p.tempo.bpm, 240);   // clamped 40..240
  assert.equal(p.grid.bars, 2);     // invalid 3 → default 2
  // chords array forced to bars length
  assert.equal(p.patterns[0].layers.harmony.chords.length, 2);
});

test('validateArrangement flags step-length, chord-length, enums, scale', () => {
  const bad = JSON.parse(JSON.stringify(FIX));
  bad.patterns[0].layers.drums.tracks[0].steps = [1, 0, 1]; // wrong length
  bad.patterns[0].layers.harmony.chords = [{ root: 'D', quality: 'min9' }]; // len 1 ≠ 2 bars
  bad.patterns[0].layers.melody.notes = [{ step: 0, len: 2, midi: 73 }]; // C#5 out of D dorian
  bad.song.sections.push({ type: 'nope' }); // invalid section type
  const r = AC.validateArrangement(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /steps length/.test(e)));
  assert.ok(r.errors.some((e) => /chords length/.test(e)));
  assert.ok(r.errors.some((e) => /section\[/.test(e)));
  assert.ok(r.warnings.some((w) => /out of D dorian/.test(w)));

  const good = AC.validateArrangement(FIX);
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test('validateArrangement rejects invalid JSON string', () => {
  const r = AC.validateArrangement('{ not json');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Invalid JSON/);
});

test('getTimeline computes bars, steps, seconds', () => {
  const tl = AC.getTimeline(FIX);
  // intro 2*2=4 bars, drop 2*2=4 bars → 8 bars, 128 steps
  assert.equal(tl.totalBars, 8);
  assert.equal(tl.totalSteps, 128);
  assert.equal(tl.sections.length, 2);
  assert.equal(tl.sections[1].startBar, 4);
  // 120bpm → 16th = 0.125s → 128 steps = 16s
  assert.equal(tl.stepSec, 0.125);
  assert.equal(tl.durationSec, 16);
  assert.equal(AC.getDurationSeconds(FIX), 16);
});

test('getSongEvents respects layer gating and section timeline', () => {
  const ev = AC.getSongEvents(FIX);
  // intro has drums:false → no drum events before bar 4 (step 64)
  const introDrums = ev.filter((e) => e.kind === 'drum' && e.step < 64);
  assert.equal(introDrums.length, 0);
  // drop (p2) has no drum tracks but bass:true (p2 bass empty) — melody plays
  const dropMelody = ev.filter((e) => e.kind === 'melody' && e.step >= 64);
  assert.ok(dropMelody.length > 0);
  // auto-impact fx at drop start (step 64)
  assert.ok(ev.some((e) => e.kind === 'fx' && e.auto && e.fxType === 'impact' && e.step === 64));
  // every event carries absolute time and section info
  for (const e of ev) {
    assert.equal(typeof e.timeSec, 'number');
    assert.ok(e.sectionId);
    assert.ok(['drum', 'bass', 'melody', 'harmony', 'fx'].includes(e.kind));
  }
  // events are time-ordered
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].step >= ev[i - 1].step);
});

test('arp harmony expands to one note per rate-step, in chord', () => {
  const ev = AC.getPatternEvents(FIX, 'p1');
  const harm = ev.filter((e) => e.kind === 'harmony');
  assert.ok(harm.length > 0);
  const dmin9 = AC.chordToMidi({ root: 'D', quality: 'min9' }, 4); // [D,F,A,C,E] from octave 4
  for (const h of harm.filter((e) => e.bar === 0)) assert.ok(dmin9.includes(h.midi), `arp note ${h.midi} in Dmin9`);
});

test('music theory helpers', () => {
  assert.deepEqual(AC.chordToMidi({ root: 'C', quality: 'maj' }, 4), [60, 64, 67]);
  assert.equal(AC.midiToNoteName(60), 'C4');
  assert.equal(AC.midiToNoteName(38), 'D2');
  assert.equal(AC.isInScale(74, 'D', 'dorian'), true);   // D
  assert.equal(AC.isInScale(73, 'D', 'dorian'), false);  // C#
  assert.equal(AC.rateToSteps('8n'), 2);
  assert.deepEqual(AC.chordToMidi({ root: '—', quality: 'min7' }, 4), []);
});

test('summarize returns a compact overview', () => {
  const s = AC.summarize(FIX);
  assert.equal(s.bpm, 120);
  assert.equal(s.key, 'D');
  assert.equal(s.scale, 'dorian');
  assert.equal(s.totalBars, 8);
  assert.equal(s.sections.length, 2);
});

// ── interactive music (Wwise-style) ──────────────────────────────────────
const IFIX = (() => {
  const f = JSON.parse(JSON.stringify(FIX));
  f.interactive = {
    loopBars: 2,
    channels: [
      { id: 'pad', name: 'Pad', sources: [{ pattern: 'p1', layer: 'harmony' }], gain: 0 },
      { id: 'lead', name: 'Lead', sources: [{ pattern: 'p1', layer: 'melody' }], gain: 0 },
      { id: 'drive', name: 'Drive', sources: [{ pattern: 'p1', layer: 'drums' }], gain: 0, rtpc: 'intensity' },
    ],
    rtpc: [{ id: 'intensity', name: 'Intensity', min: 0, max: 1, default: 0 }],
    scenes: [
      { id: 'explore', name: 'Explore', on: ['pad', 'lead'], master: { filter: 6000 } },
      { id: 'combat', name: 'Combat', on: ['pad', 'lead', 'drive'], master: { filter: 20000 }, rtpc: { intensity: 0.5 } },
    ],
    default: 'explore',
    transition: { sync: 'nextBar', fadeSec: 1 },
  };
  return f;
})();

function fakeSink(now0) {
  return {
    t: now0 || 0, calls: [],
    now() { return this.t; },
    advance(dt) { this.t += dt; },
    setChannelGain(id, db, at, ramp) { this.calls.push({ type: 'gain', id, db, at, ramp }); },
    setMaster(kind, val, at, ramp) { this.calls.push({ type: 'master', kind, val, at, ramp }); },
    last(pred) { for (let i = this.calls.length - 1; i >= 0; i--) if (pred(this.calls[i])) return this.calls[i]; return null; },
  };
}

test('generateDefaultInteractive scaffolds channels + scenes', () => {
  const it = AC.generateDefaultInteractive(FIX);
  assert.ok(it.channels.length >= 4);
  assert.ok(it.scenes.some((s) => s.id === 'scene_ambient'));
  const p = AC.parseArrangement({ ...FIX, interactive: it });
  assert.equal(p.interactive.loopBars, 2);
});

test('resolveScene gates channels and applies RTPC', () => {
  const explore = AC.resolveScene(IFIX, 'explore');
  assert.deepEqual(explore.channels.filter((c) => c.on).map((c) => c.id).sort(), ['lead', 'pad']);
  assert.equal(explore.master.filter, 6000);
  // combat: drive on but scaled by rtpc intensity=0.5 → ~-6.02 dB
  const combat = AC.resolveScene(IFIX, 'combat');
  const drive = combat.channels.find((c) => c.id === 'drive');
  assert.ok(drive.on);
  assert.ok(Math.abs(drive.gainDb - (-6.02)) < 0.1, 'drive ~-6dB, got ' + drive.gainDb);
  // rtpc override to full
  const full = AC.resolveScene(IFIX, 'combat', { intensity: 1 });
  assert.ok(Math.abs(full.channels.find((c) => c.id === 'drive').gainDb) < 0.01);
});

test('controller: sync boundary timing + only-changed ramps', () => {
  const sink = fakeSink(0.3); // 120bpm → beat .5s, bar 2s, loop 4s
  const c = new AC.InteractiveMusicController(IFIX, sink);
  c.start();
  // default explore applied immediately (~now)
  assert.ok(sink.last((x) => x.type === 'gain' && x.id === 'pad' && Math.abs(x.db) < 0.01));
  assert.ok(sink.last((x) => x.type === 'gain' && x.id === 'drive' && x.db <= -60));
  assert.ok(sink.last((x) => x.type === 'master' && x.kind === 'filter' && x.val === 6000));

  sink.calls.length = 0;
  c.setScene('combat'); // sync nextBar → at = 2.0 (from now 0.3)
  const driveCall = sink.last((x) => x.type === 'gain' && x.id === 'drive');
  assert.equal(driveCall.at, 2.0);
  assert.equal(driveCall.ramp, 1);
  assert.ok(Math.abs(driveCall.db - (-6.02)) < 0.1);
  // pad/lead unchanged (0→0) → no redundant gain call for them
  assert.equal(sink.last((x) => x.type === 'gain' && x.id === 'pad'), null);
  assert.ok(sink.last((x) => x.type === 'master' && x.kind === 'filter' && x.val === 20000));
});

test('controller: channel override + rtpc live tweak', () => {
  const sink = fakeSink(1.0);
  const c = new AC.InteractiveMusicController(IFIX, sink);
  c.start(); c.setScene('combat', { sync: 'immediate' });
  sink.calls.length = 0;
  c.setRTPC('intensity', 1.0, { sync: 'immediate' });
  const g = sink.last((x) => x.type === 'gain' && x.id === 'drive');
  assert.ok(Math.abs(g.db) < 0.01, 'intensity 1 → drive 0dB');
  sink.calls.length = 0;
  c.setChannel('pad', false, { sync: 'immediate' });
  assert.ok(sink.last((x) => x.type === 'gain' && x.id === 'pad' && x.db <= -60));
});

test('controller throws without an interactive block', () => {
  assert.throws(() => new AC.InteractiveMusicController(FIX, fakeSink()), /interactive/);
});

test('getChannelClip returns tagged loop events', () => {
  const ev = AC.getChannelClip(IFIX, 'pad');
  assert.ok(ev.length > 0);
  assert.ok(ev.every((e) => e.kind === 'harmony' && e.channelId === 'pad' && e.sourcePattern === 'p1'));
});

// ── MIDI export ───────────────────────────────────────────────────────────
function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
function u32(b, o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }
test('toMIDI emits a valid multi-track SMF', () => {
  const mid = AC.toMIDI(IFIX);
  assert.ok(mid instanceof Uint8Array);
  assert.equal(String.fromCharCode(mid[0], mid[1], mid[2], mid[3]), 'MThd');
  assert.equal(u32(mid, 4), 6);            // header length
  assert.equal(u16(mid, 8), 1);            // format 1
  const ntracks = u16(mid, 10);
  assert.ok(ntracks >= 2 && ntracks <= 5); // conductor + up to 4 parts
  assert.equal(u16(mid, 12), 480);         // default ppq
  // conductor track present + a tempo meta (0xFF 0x51)
  assert.equal(String.fromCharCode(mid[14], mid[15], mid[16], mid[17]), 'MTrk');
  let hasTempo = false;
  for (let i = 0; i < mid.length - 2; i++) if (mid[i] === 0xff && mid[i + 1] === 0x51 && mid[i + 2] === 0x03) hasTempo = true;
  assert.ok(hasTempo, 'tempo meta present');
});
test('toMIDI honors ppq and pattern source', () => {
  const mid = AC.toMIDI(IFIX, { ppq: 960, source: 'pattern', patternRef: 'p1' });
  assert.equal(u16(mid, 12), 960);
  assert.ok(mid.length > 30);
});

// ── RTPC curves ───────────────────────────────────────────────────────────
test('evalCurve interpolates piecewise-linear breakpoints', () => {
  assert.equal(AC.evalCurve([[0, 0], [1, 1]], 0.5), 0.5);
  assert.equal(AC.evalCurve([[0, 0], [1, 1]], -1), 0);      // clamps
  assert.equal(AC.evalCurve([[0, 0.2], [1, 0.8]], 0.5), 0.5);
  // ease-in style: low input stays quiet
  assert.ok(AC.evalCurve([[0, 0], [0.7, 0.1], [1, 1]], 0.35) < 0.1);
});
test('channel.rtpc accepts a string or {param,curve}; curve shapes the gain', () => {
  const f = JSON.parse(JSON.stringify(IFIX));
  // give drive an ease-in curve so intensity 0.5 → much quieter than linear
  f.interactive.channels.find((c) => c.id === 'drive').rtpc = { param: 'intensity', curve: [[0, 0], [0.8, 0.05], [1, 1]] };
  const p = AC.parseArrangement(f);
  assert.equal(p.interactive.channels.find((c) => c.id === 'drive').rtpc.param, 'intensity'); // normalized to object
  const combat = AC.resolveScene(p, 'combat'); // intensity 0.5 on the curve → ~0.031 mult
  const drive = combat.channels.find((c) => c.id === 'drive');
  assert.ok(drive.gainDb < -20, 'ease-in curve makes drive much quieter at 0.5, got ' + drive.gainDb);
  // string form still works (linear)
  const g = JSON.parse(JSON.stringify(IFIX)); g.interactive.channels.find((c) => c.id === 'drive').rtpc = 'intensity';
  assert.deepEqual(AC.parseArrangement(g).interactive.channels.find((c) => c.id === 'drive').rtpc.curve, [[0, 0], [1, 1]]);
});

// ── stingers ──────────────────────────────────────────────────────────────
test('stingers: coerce, list, clip, and controller fires via sink', () => {
  const f = JSON.parse(JSON.stringify(IFIX));
  f.interactive.stingers = [{ id: 'hit', name: 'Hit', sources: [{ pattern: 'p1', layer: 'melody' }], sync: 'nextBeat', gain: -3 }];
  const p = AC.parseArrangement(f);
  assert.equal(AC.listStingers(p).length, 1);
  const clip = AC.getStingerClip(p, 'hit');
  assert.ok(clip.length > 0 && clip.every((e) => e.stingerId === 'hit' && e.kind === 'melody'));
  // controller fires it to the sink at the next-beat boundary
  const fired = [];
  const sink = { t: 0.3, now() { return this.t; }, setChannelGain() {}, setMaster() {}, fireStinger(id, at, db) { fired.push({ id, at, db }); } };
  const c = new AC.InteractiveMusicController(p, sink); c.start();
  c.triggerStinger('hit');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, 'hit');
  assert.equal(fired[0].at, 0.5);   // 120bpm → next beat after 0.3 is 0.5
  assert.equal(fired[0].db, -3);
});

test('end-to-end: real microbe-bounce arrangement (if present)', () => {
  const f = resolve(__dirname, '../../../arrangements/microbe-bounce-2026-07-10.json');
  if (!existsSync(f)) return; // skip if the repo file isn't here
  const raw = readFileSync(f, 'utf8');
  const res = AC.validateArrangement(raw);
  assert.equal(res.ok, true, 'microbe file should validate: ' + JSON.stringify(res.errors));
  const tl = AC.getTimeline(raw);
  assert.equal(tl.totalBars, 40);
  assert.ok(Math.abs(tl.durationSec - 76.19) < 0.5);
  const ev = AC.getSongEvents(raw);
  assert.ok(ev.length > 100, 'should produce many events');
});
