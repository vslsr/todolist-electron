/*!
 * interactive-tone-player — a Tone.js reference player for arrangement-core's
 * Wwise-style interactive music (channels / scenes / RTPC).
 *
 * Tone.js is dependency-injected (not bundled) so the package stays dep-free:
 *     import * as Tone from 'tone';
 *     import ArrangementCore from 'arrangement-core';
 *     import { InteractiveMusicPlayer } from 'arrangement-core/interactive-tone-player';
 *     const player = new InteractiveMusicPlayer(projectJson, { Tone, ArrangementCore });
 *     await player.play();
 *     player.setScene('combat');            // vertical/horizontal remix, synced
 *     player.setChannel('ch_drive', false); // toggle a stem
 *     player.setRTPC('intensity', 0.8);     // continuous tension
 *
 * Every channel plays phase-locked and always running; its Gain node gates
 * audibility. The controller (from arrangement-core) computes target gains +
 * master + the exact transition time; this player just applies them to Tone.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else (root || (typeof self !== 'undefined' ? self : this)).ArrangementInteractivePlayer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function resolveCore(deps) {
    if (deps && deps.ArrangementCore) return deps.ArrangementCore;
    if (typeof globalThis !== 'undefined' && globalThis.ArrangementCore) return globalThis.ArrangementCore;
    if (typeof require === 'function') { try { return require('./arrangement-core.js'); } catch (e) { /* noop */ } }
    return null;
  }

  function InteractiveMusicPlayer(project, deps) {
    if (!(this instanceof InteractiveMusicPlayer)) return new InteractiveMusicPlayer(project, deps);
    deps = deps || {};
    var Tone = deps.Tone || (typeof globalThis !== 'undefined' ? globalThis.Tone : null);
    var AC = resolveCore(deps);
    if (!Tone) throw new Error('InteractiveMusicPlayer: pass a Tone.js instance — new InteractiveMusicPlayer(project, { Tone })');
    if (!AC) throw new Error('InteractiveMusicPlayer: pass ArrangementCore — new InteractiveMusicPlayer(project, { Tone, ArrangementCore })');
    this.Tone = Tone; this.AC = AC;
    this.project = AC.parseArrangement(project);
    if (!this.project.interactive) this.project.interactive = AC.generateDefaultInteractive(this.project);
    this.it = this.project.interactive;
    this.built = false; this.playing = false;
    this.channels = {};   // id -> { gain, part, synths }
    this.stingers = {};   // id -> { gain, synths, events }
    this.controller = null;
  }
  var P = InteractiveMusicPlayer.prototype;

  P._dbGain = function (db) { return db <= -60 ? 0 : this.Tone.dbToGain(db); };
  P._ramp = function (param, target, atTime, rampSec) {
    var Tone = this.Tone;
    try {
      var now = Tone.Transport.seconds, start = Math.max(atTime, now);
      if (typeof param.linearRampTo === 'function') param.linearRampTo(target, Math.max(0.005, rampSec || 0.01), start);
      else { param.cancelScheduledValues(start); param.setValueAtTime(param.value, start); param.linearRampToValueAtTime(target, start + Math.max(0.005, rampSec || 0.01)); }
    } catch (e) { try { param.value = target; } catch (e2) { /* noop */ } }
  };

  // ── master + per-channel graph ───────────────────────────────────────────
  P._build = function () {
    if (this.built) return;
    var Tone = this.Tone, AC = this.AC, mst = this.project.master;
    this.filter = new Tone.Filter(mst.filter, 'lowpass');
    this.masterVol = new Tone.Gain(Tone.dbToGain(mst.volume));
    this.limiter = new Tone.Limiter(-1);
    this.filter.connect(this.masterVol); this.masterVol.connect(this.limiter); this.limiter.toDestination();

    var loopSec = (60 / this.project.tempo.bpm) * 4 * this.it.loopBars;
    var self = this;
    this.it.channels.forEach(function (ch) {
      var gain = new Tone.Gain(0); gain.connect(self.filter);   // start silent; controller opens it
      var synths = self._buildSynths(ch.sources, gain);
      var events = AC.getChannelClip(self.project, ch.id).map(function (e) { return [e.timeSec, e]; });
      var part = new Tone.Part(function (time, ev) { self._trigger(synths, ev, time); }, events);
      part.loop = true; part.loopStart = 0; part.loopEnd = loopSec;
      self.channels[ch.id] = { gain: gain, part: part, synths: synths };
    });
    // stingers: one-shot, routed post-filter (→ masterVol) so they cut through the mix
    (this.it.stingers || []).forEach(function (st) {
      var gain = new Tone.Gain(self._dbGain(st.gain)); gain.connect(self.masterVol);
      var synths = self._buildSynths(st.sources, gain);
      self.stingers[st.id] = { gain: gain, synths: synths, events: AC.getStingerClip(self.project, st.id) };
    });
    this.controller = new AC.InteractiveMusicController(this.project, this._sink());
    this.built = true;
  };

  P._sink = function () {
    var self = this, Tone = this.Tone;
    return {
      now: function () { return Tone.Transport.seconds; },
      setChannelGain: function (id, db, at, ramp) { var n = self.channels[id]; if (n) self._ramp(n.gain.gain, self._dbGain(db), at, ramp); },
      setMaster: function (kind, val, at, ramp) {
        if (kind === 'filter') self._ramp(self.filter.frequency, val, at, ramp);
        else if (kind === 'volume') self._ramp(self.masterVol.gain, Tone.dbToGain(val), at, ramp);
      },
      fireStinger: function (id, at, db) {
        var n = self.stingers[id]; if (!n) return;
        try { n.gain.gain.value = self._dbGain(db); } catch (e) { /* noop */ }
        n.events.forEach(function (ev) { try { Tone.Transport.scheduleOnce(function (t) { self._trigger(n.synths, ev, t); }, at + ev.timeSec); } catch (e) { /* noop */ } });
      }
    };
  };

  // ── synths (compact port of the tool's engine) ───────────────────────────
  P._buildSynths = function (sources, bus) {
    var Tone = this.Tone, kinds = {}, out = { drums: null, bass: null, harmony: null, melody: null };
    sources.forEach(function (s) { kinds[s.layer] = kinds[s.layer] || s; });
    var proj = this.project, self = this;
    function instrOf(patId, layer) { var p = self.AC.patternById(proj, patId); return p ? p.layers[layer].instrument : ''; }
    if (kinds.drums) out.drums = this._drumKit(bus);
    if (kinds.bass) out.bass = this._voice('bass', instrOf(kinds.bass.pattern, 'bass'), bus);
    if (kinds.melody) out.melody = this._voice('melody', instrOf(kinds.melody.pattern, 'melody'), bus);
    if (kinds.harmony) out.harmony = this._voice('harmony', instrOf(kinds.harmony.pattern, 'harmony'), bus);
    return out;
  };
  P._drumKit = function (bus) {
    var Tone = this.Tone;
    var kick = new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 7, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.18 } }).connect(bus);
    var snF = new Tone.Filter(1900, 'bandpass'); snF.Q.value = 1.2; snF.connect(bus);
    var snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(snF);
    var clF = new Tone.Filter(1200, 'bandpass'); clF.Q.value = 1.0; clF.connect(bus);
    var clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.13, sustain: 0 } }).connect(clF);
    var chF = new Tone.Filter(9000, 'highpass'); chF.connect(bus);
    var chh = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(chF);
    var ohF = new Tone.Filter(9000, 'highpass'); ohF.connect(bus);
    var ohh = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.28, sustain: 0 } }).connect(ohF);
    var perc = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 4, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(bus);
    return { kick: kick, snare: snare, clap: clap, chh: chh, ohh: ohh, perc: perc };
  };
  P._voice = function (layer, kind, bus) {
    var Tone = this.Tone, s;
    if (layer === 'bass') {
      if (kind === 'FMSynth') s = new Tone.FMSynth({ volume: -6, harmonicity: 2, modulationIndex: 6, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 } });
      else if (kind === 'AMSynth') s = new Tone.AMSynth({ volume: -6 });
      else if (kind === 'DuoSynth') s = new Tone.DuoSynth({ volume: -10 });
      else s = new Tone.MonoSynth({ volume: -6, oscillator: { type: 'sawtooth' }, filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2.5 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 } });
    } else if (layer === 'melody') {
      var voice = { FMSynth: Tone.FMSynth, MonoSynth: Tone.MonoSynth, DuoSynth: Tone.DuoSynth, AMSynth: Tone.AMSynth }[kind] || Tone.FMSynth;
      s = new Tone.PolySynth(voice, { volume: -9 });
    } else {
      var type = kind === 'poly-square' ? 'fatsquare' : kind === 'poly-sine' ? 'sine' : 'fatsawtooth';
      s = new Tone.PolySynth(Tone.Synth, { volume: -13, oscillator: { type: type }, envelope: { attack: 0.4, decay: 0.4, sustain: 0.7, release: 1.4 } });
    }
    return s.connect(bus);
  };
  P._trigger = function (synths, ev, time) {
    var Tone = this.Tone, safe = function (fn) { try { fn(); } catch (e) { /* noop */ } };
    if (ev.kind === 'drum' && synths.drums) {
      var v = ev.velocity || 0.8, k = synths.drums;
      if (ev.track === 'kick') safe(function () { k.kick.triggerAttackRelease('C1', '8n', time, v); });
      else if (ev.track === 'snare') safe(function () { k.snare.triggerAttackRelease('8n', time, v); });
      else if (ev.track === 'clap') safe(function () { k.clap.triggerAttackRelease('8n', time, v); });
      else if (ev.track === 'chh') safe(function () { k.chh.triggerAttackRelease('32n', time, v * 0.8); });
      else if (ev.track === 'ohh') safe(function () { k.ohh.triggerAttackRelease('8n', time, v * 0.7); });
      else if (ev.track === 'perc') safe(function () { k.perc.triggerAttackRelease('A1', '16n', time, v); });
    } else if (ev.kind === 'bass' && synths.bass) {
      safe(function () { synths.bass.triggerAttackRelease(Tone.Frequency(ev.midi, 'midi').toFrequency(), ev.durSec, time, ev.velocity || 0.9); });
    } else if (ev.kind === 'melody' && synths.melody) {
      safe(function () { synths.melody.triggerAttackRelease(Tone.Frequency(ev.midi, 'midi').toFrequency(), ev.durSec, time, ev.velocity || 0.85); });
    } else if (ev.kind === 'harmony' && synths.harmony) {
      var notes = ev.notes ? ev.notes : (ev.midi != null ? [ev.midi] : []);
      if (notes.length) safe(function () { synths.harmony.triggerAttackRelease(notes.map(function (m) { return Tone.Frequency(m, 'midi').toFrequency(); }), ev.durSec, time, 0.55); });
    }
    // fx kinds are omitted in this reference player (they are section ear-candy).
  };

  // ── public API ────────────────────────────────────────────────────────────
  P.play = function () {
    var Tone = this.Tone, self = this;
    this._build();
    var startEngine = function () {
      self.it.channels.forEach(function (ch) { var n = self.channels[ch.id]; try { n.part.start(0); } catch (e) { /* noop */ } });
      Tone.Transport.bpm.value = self.project.tempo.bpm;
      Tone.Transport.start();
      self.controller.start();          // apply default scene at t≈now
      self.playing = true;
    };
    if (Tone.start) return Promise.resolve(Tone.start()).then(startEngine).then(function () { return self; });
    startEngine(); return Promise.resolve(this);
  };
  P.stop = function () {
    var Tone = this.Tone, self = this;
    try { Tone.Transport.stop(); Tone.Transport.cancel(); Tone.Transport.position = 0; } catch (e) { /* noop */ }
    Object.keys(this.channels).forEach(function (id) { try { self.channels[id].part.stop(); } catch (e) { /* noop */ } });
    this.playing = false; return this;
  };
  P.dispose = function () {
    var self = this; this.stop();
    Object.keys(this.channels).forEach(function (id) {
      var n = self.channels[id];
      try { n.part.dispose(); } catch (e) { /* noop */ }
      var s = n.synths; ['bass', 'melody', 'harmony'].forEach(function (k) { if (s[k]) try { s[k].dispose(); } catch (e) { } });
      if (s.drums) Object.keys(s.drums).forEach(function (dk) { try { s.drums[dk].dispose(); } catch (e) { } });
      try { n.gain.dispose(); } catch (e) { }
    });
    Object.keys(this.stingers).forEach(function (id) {
      var n = self.stingers[id], s = n.synths;
      ['bass', 'melody', 'harmony'].forEach(function (k) { if (s[k]) try { s[k].dispose(); } catch (e) { } });
      if (s.drums) Object.keys(s.drums).forEach(function (dk) { try { s.drums[dk].dispose(); } catch (e) { } });
      try { n.gain.dispose(); } catch (e) { }
    });
    ['filter', 'masterVol', 'limiter'].forEach(function (k) { if (self[k]) try { self[k].dispose(); } catch (e) { } });
    this.channels = {}; this.stingers = {}; this.built = false; return this;
  };
  // delegate control to the engine-agnostic controller
  P.setScene = function (id, o) { this._build(); this.controller.setScene(id, o); return this; };
  P.setChannel = function (id, on, o) { this._build(); this.controller.setChannel(id, on, o); return this; };
  P.toggleChannel = function (id, o) { this._build(); this.controller.toggleChannel(id, o); return this; };
  P.setRTPC = function (param, val, o) { this._build(); this.controller.setRTPC(param, val, o); return this; };
  P.triggerStinger = function (id, o) { this._build(); this.controller.triggerStinger(id, o); return this; };
  P.setChannelCurve = function (id, curve, o) { this._build(); this.controller.setChannelCurve(id, curve, o); return this; };
  P.listStingers = function () { return (this.it.stingers || []).map(function (s) { return { id: s.id, name: s.name }; }); };
  P.getScene = function () { return this.controller ? this.controller.getScene() : (this.it['default']); };
  P.getRTPC = function (param) { return this.controller ? this.controller.getRTPC(param) : undefined; };
  P.getMix = function () { this._build(); return this.controller.getMix(); };
  P.listScenes = function () { return this.it.scenes.map(function (s) { return { id: s.id, name: s.name }; }); };
  P.listChannels = function () { return this.it.channels.map(function (c) { return { id: c.id, name: c.name, sources: c.sources.slice() }; }); };

  return { InteractiveMusicPlayer: InteractiveMusicPlayer };
});
