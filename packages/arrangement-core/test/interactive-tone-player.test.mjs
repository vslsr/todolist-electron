import { test } from 'node:test';
import assert from 'node:assert/strict';
import AC from '../arrangement-core.js';
import PlayerMod from '../interactive-tone-player.js';
const { InteractiveMusicPlayer } = PlayerMod;

// ── a minimal mock of the Tone.js surface the player touches ────────────────
function mkParam(v) {
  return {
    value: v, calls: [],
    linearRampTo(target, ramp, at) { this.calls.push({ target, ramp, at }); this.value = target; return this; },
    cancelScheduledValues() { return this; },
    setValueAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
  };
}
class Node { connect() { return this; } toDestination() { return this; } dispose() {} }
class Gain extends Node { constructor(g) { super(); this.gain = mkParam(g == null ? 1 : g); } }
class Filter extends Node { constructor(f) { super(); this.frequency = mkParam(f); this.Q = mkParam(1); } }
class Limiter extends Node {}
class Synthy extends Node { triggerAttackRelease() {} }
class Part {
  constructor(cb, events) { this.cb = cb; this.events = events; this.loop = false; this.loopStart = 0; this.loopEnd = 0; }
  start() { return this; } stop() { return this; } dispose() {}
}
function mockTone() {
  const Transport = { seconds: 0, bpm: { value: 120 }, position: 0, scheduled: [], start() {}, stop() {}, cancel() {}, scheduleOnce(cb, t) { this.scheduled.push({ cb, t }); return 0; } };
  return {
    Transport,
    Gain, Filter, Limiter, Part,
    MembraneSynth: Synthy, NoiseSynth: Synthy, MonoSynth: Synthy, FMSynth: Synthy, AMSynth: Synthy, DuoSynth: Synthy, PolySynth: Synthy, Synth: Synthy,
    Frequency() { return { toFrequency() { return 440; }, toNote() { return 'A4'; } }; },
    dbToGain(db) { return Math.pow(10, db / 20); },
    start() { return Promise.resolve(); },
  };
}

const IFIX = {
  format: 'todo-music-arranger', version: 2, tempo: { bpm: 120, swing: 0 }, grid: { bars: 2, stepsPerBar: 16 },
  master: { volume: -8, filter: 20000, reverb: 0.15 }, activePattern: 0, playMode: 'song',
  patterns: [{
    id: 'p1', name: 'A', layers: {
      drums: { engine: 'synth', machine: 'TR-808', tracks: [{ id: 'kick', name: 'k', color: '--kick', sample: 'kick', steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], gain: 0, mute: false, solo: false }] },
      bass: { instrument: 'MonoSynth', sidechain: { on: true, source: 'kick', amount: 0.7 }, notes: [{ step: 0, len: 2, midi: 38 }] },
      harmony: { instrument: 'poly-saw', mode: 'pad', rate: '16n', octave: 4, reverb: 0.4, chorus: 0.2, chords: [{ root: 'D', quality: 'min7' }, { root: 'G', quality: 'maj' }] },
      melody: { instrument: 'FMSynth', key: 'D', scale: 'dorian', reverb: 0.25, notes: [{ step: 0, len: 2, midi: 74 }] },
      fx: { events: [] },
    },
  }],
  song: { loop: true, sections: [] },
  interactive: {
    loopBars: 2,
    channels: [
      { id: 'pad', name: 'Pad', sources: [{ pattern: 'p1', layer: 'harmony' }], gain: 0 },
      { id: 'drive', name: 'Drive', sources: [{ pattern: 'p1', layer: 'drums' }], gain: 0, rtpc: 'intensity' },
    ],
    rtpc: [{ id: 'intensity', name: 'Intensity', min: 0, max: 1, default: 0 }],
    scenes: [
      { id: 'explore', name: 'Explore', on: ['pad'], master: { filter: 6000 } },
      { id: 'combat', name: 'Combat', on: ['pad', 'drive'], master: { filter: 20000 }, rtpc: { intensity: 0.5 } },
    ],
    default: 'explore', transition: { sync: 'nextBar', fadeSec: 1 },
  },
};

test('player builds a channel graph and honors the default scene on play()', async () => {
  const Tone = mockTone();
  const player = new InteractiveMusicPlayer(IFIX, { Tone, ArrangementCore: AC });
  await player.play();
  assert.equal(player.playing, true);
  assert.ok(player.channels.pad && player.channels.drive);
  // explore: pad on (gain→1), drive off (gain→0), master filter → 6000
  assert.ok(Math.abs(player.channels.pad.gain.gain.value - 1) < 1e-6);
  assert.ok(player.channels.drive.gain.gain.value <= 1e-6);
  assert.equal(player.filter.frequency.value, 6000);
});

test('setScene applies synced channel + master ramps through Tone', () => {
  const Tone = mockTone();
  const player = new InteractiveMusicPlayer(IFIX, { Tone, ArrangementCore: AC });
  player.play();
  player.setScene('combat', { sync: 'immediate' });
  // drive lifts to ~-6dB (intensity 0.5) → dbToGain ≈ 0.5
  assert.ok(Math.abs(player.channels.drive.gain.gain.value - 0.5) < 0.02, 'drive ≈0.5, got ' + player.channels.drive.gain.gain.value);
  assert.equal(player.filter.frequency.value, 20000);
  // and it was applied via a ramp call, not a raw set
  assert.ok(player.channels.drive.gain.gain.calls.length > 0);
});

test('setRTPC and toggleChannel drive the graph live', () => {
  const Tone = mockTone();
  const player = new InteractiveMusicPlayer(IFIX, { Tone, ArrangementCore: AC });
  player.play();
  player.setScene('combat', { sync: 'immediate' });
  player.setRTPC('intensity', 1.0, { sync: 'immediate' });
  assert.ok(Math.abs(player.channels.drive.gain.gain.value - 1) < 1e-6, 'intensity 1 → drive full');
  player.toggleChannel('pad', { sync: 'immediate' });
  assert.ok(player.channels.pad.gain.gain.value <= 1e-6, 'pad toggled off');
});

test('triggerStinger schedules one-shot events on the transport', () => {
  const Tone = mockTone();
  const f = JSON.parse(JSON.stringify(IFIX));
  f.interactive.stingers = [{ id: 'hit', name: 'Hit', sources: [{ pattern: 'p1', layer: 'melody' }], sync: 'nextBeat', gain: 0 }];
  const player = new InteractiveMusicPlayer(f, { Tone, ArrangementCore: AC });
  player.play();
  Tone.Transport.seconds = 0.3;
  Tone.Transport.scheduled.length = 0;
  player.triggerStinger('hit');
  assert.ok(Tone.Transport.scheduled.length > 0, 'stinger events scheduled');
  // scheduled at next-beat boundary (0.5) + each event offset
  assert.ok(Tone.Transport.scheduled.every((s) => s.t >= 0.5), 'all scheduled at/after next beat');
  // firing a callback triggers a synth without throwing
  assert.doesNotThrow(() => Tone.Transport.scheduled[0].cb(0.5));
});

test('auto-scaffolds interactive when the project has none', () => {
  const Tone = mockTone();
  const bare = JSON.parse(JSON.stringify(IFIX)); delete bare.interactive;
  const player = new InteractiveMusicPlayer(bare, { Tone, ArrangementCore: AC });
  assert.ok(player.it.channels.length > 0);
  assert.ok(player.listScenes().length > 0);
});
