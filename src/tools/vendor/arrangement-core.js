/*!
 * arrangement-core — parse / validate / query for the "todo-music-arranger" (v2)
 * arrangement JSON produced by the Electron 🎹 电子编曲 tool.
 *
 * Zero dependencies. No DOM, no Tone.js. Works as UMD (CommonJS / AMD / <script>
 * global `ArrangementCore`) and via the ESM shim `arrangement-core.mjs`.
 *
 * The normalization mirrors the tool's importer (`coerceProject`) exactly, so a
 * project parsed here sounds the same as one imported into the tool. The query
 * helpers mirror the tool's playback triggers (drums / bass / harmony / melody /
 * fx, layer gating, arp/pad/pluck expansion) so you can build your own player,
 * visualizer, exporter, or chord chart from the same data.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else (root || (typeof self !== 'undefined' ? self : this)).ArrangementCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════
  //  Constants & music theory (kept identical to the tool)
  // ═══════════════════════════════════════════════════════════════════════
  var STEPS_PER_BAR = 16;
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  var CHORD_QUALITIES = {
    maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
    '7': [0, 4, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6],
    aug: [0, 4, 8], add9: [0, 4, 7, 14], min9: [0, 3, 7, 10, 14], '6': [0, 4, 7, 9]
  };
  var SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], 'penta-min': [0, 3, 5, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };
  var DRUM_ROWS = [
    { id: 'kick', name: '底鼓 Kick', color: '--kick', sample: 'kick' },
    { id: 'snare', name: '军鼓 Snare', color: '--snare', sample: 'snare' },
    { id: 'clap', name: '拍手 Clap', color: '--clap', sample: 'clap' },
    { id: 'chh', name: '闭镲 CH', color: '--hat', sample: 'hihat-close' },
    { id: 'ohh', name: '开镲 OH', color: '--hat', sample: 'hihat-open' },
    { id: 'perc', name: '打击 Perc', color: '--perc', sample: 'tom' }
  ];
  var DRUM_MACHINES = ['TR-808', 'Casio-RZ1', 'LM-2', 'MFB-512', 'Roland CR-8000'];
  var HARM_MODES = ['pad', 'arp', 'pluck'];
  var ARP_RATES = { '16n': 1, '8n': 2, '4n': 4, '8t': 4 / 3 };
  var FX_TYPES = ['riser', 'downlifter', 'impact', 'reverse', 'sweep'];
  var FX_DEFAULT_LEN = { riser: 16, downlifter: 16, impact: 2, reverse: 8, sweep: 16 };
  var SECTION_TYPES = ['intro', 'verse', 'build', 'drop', 'break', 'outro'];
  var SECTION_PRESET = {
    intro: { repeats: 2, layers: { drums: false, bass: false, harmony: true, melody: true, fx: false }, dyn: { filterFrom: 700, filterTo: 6000, fadeIn: true, fadeOut: false, autoRiser: false, autoImpact: false } },
    verse: { repeats: 4, layers: { drums: true, bass: true, harmony: true, melody: true, fx: false }, dyn: { filterFrom: 13000, filterTo: 14000, fadeIn: false, fadeOut: false, autoRiser: false, autoImpact: false } },
    build: { repeats: 2, layers: { drums: true, bass: true, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 2500, filterTo: 18000, fadeIn: false, fadeOut: false, autoRiser: true, autoImpact: false } },
    drop: { repeats: 4, layers: { drums: true, bass: true, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 20000, filterTo: 20000, fadeIn: false, fadeOut: false, autoRiser: false, autoImpact: true } },
    break: { repeats: 2, layers: { drums: false, bass: false, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 9000, filterTo: 9000, fadeIn: true, fadeOut: false, autoRiser: false, autoImpact: false } },
    outro: { repeats: 2, layers: { drums: true, bass: false, harmony: true, melody: false, fx: false }, dyn: { filterFrom: 12000, filterTo: 600, fadeIn: false, fadeOut: true, autoRiser: false, autoImpact: false } }
  };
  // Importer hard clamp ranges (what the tool silently forces); and the schema's
  // recommended "visible & musical" ranges (used only for validation warnings).
  var RANGE = {
    bassMidi: [12, 60], melodyMidi: [36, 96], bassMidiRec: [24, 50], melodyMidiRec: [48, 84],
    bpm: [40, 240], swing: [0, 80], volume: [-40, 0], filter: [100, 20000], reverb: [0, 1],
    octave: [1, 6], repeats: [1, 16], gridBars: [1, 2, 4, 8]
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  Small utils
  // ═══════════════════════════════════════════════════════════════════════
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function bool(v, d) { return (v === undefined || v === null) ? d : !!v; }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function letter(i) { return String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''); }
  function resizeArr(arr, len, fill) { var a = arr.slice(0, len); while (a.length < len) a.push(fill); return a; }
  function has(obj, k) { return obj && Object.prototype.hasOwnProperty.call(obj, k); }
  function markNormalized(p) { try { Object.defineProperty(p, '__acNormalized', { value: true, enumerable: false, configurable: true }); } catch (e) { /* noop */ } return p; }

  // ── music theory (public) ──────────────────────────────────────────────
  function noteNameToPitchClass(name) { return NOTE_NAMES.indexOf(name); }
  function midiToNoteName(m) { m = m | 0; return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function scaleSemitones(scale) { return SCALES[scale] ? SCALES[scale].slice() : null; }
  function rateToSteps(rate) { return ARP_RATES[rate] || 1; }
  function chordToMidi(chord, octave) {
    if (!chord) return [];
    var rootIdx = NOTE_NAMES.indexOf(chord.root);
    if (rootIdx < 0) return [];
    var base = 12 * ((octave == null ? 4 : octave) + 1) + rootIdx;
    return (CHORD_QUALITIES[chord.quality] || [0, 4, 7]).map(function (iv) { return base + iv; });
  }
  function isInScale(midi, key, scale) {
    var keyPc = NOTE_NAMES.indexOf(key); var set = SCALES[scale];
    if (keyPc < 0 || !set) return false;
    var pc = ((((midi | 0) - keyPc) % 12) + 12) % 12;
    return set.indexOf(pc) >= 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Normalization — mirrors the tool's coerceProject / coerceLayers exactly
  // ═══════════════════════════════════════════════════════════════════════
  function defaultEnabled() { return { drums: true, bass: true, harmony: true, melody: true, fx: true }; }
  function coerceEnabled(e) { return { drums: bool(e && e.drums, true), bass: bool(e && e.bass, true), harmony: bool(e && e.harmony, true), melody: bool(e && e.melody, true), fx: bool(e && e.fx, true) }; }

  function defaultLayers(bars) {
    var total = bars * STEPS_PER_BAR;
    return {
      drums: {
        engine: 'synth', machine: 'TR-808',
        tracks: DRUM_ROWS.map(function (r) { return { id: r.id, name: r.name, color: r.color, sample: r.sample, steps: new Array(total).fill(0), gain: 0, mute: false, solo: false }; })
      },
      bass: { instrument: 'MonoSynth', sidechain: { on: true, source: 'kick', amount: 0.7 }, notes: [] },
      harmony: { instrument: 'poly-saw', mode: 'pad', rate: '16n', octave: 4, reverb: 0.4, chorus: 0.2, chords: [] },
      melody: { instrument: 'FMSynth', key: 'C', scale: 'minor', reverb: 0.25, notes: [] },
      fx: { events: [] }
    };
  }
  function cleanNotes(arr, total, lo, hi) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (n) { return n && typeof n.step === 'number' && typeof n.midi === 'number'; })
      .map(function (n) { return { step: clamp(n.step | 0, 0, total - 1), len: clamp((n.len | 0) || 1, 1, total), midi: clamp(n.midi | 0, lo, hi) }; });
  }
  function coerceLayers(L, total) {
    var layers = defaultLayers(total / STEPS_PER_BAR);
    L = L || {};
    if (L.drums) {
      layers.drums.engine = L.drums.engine === 'sample' ? 'sample' : 'synth';
      if (DRUM_MACHINES.indexOf(L.drums.machine) >= 0) layers.drums.machine = L.drums.machine;
      if (Array.isArray(L.drums.tracks)) layers.drums.tracks.forEach(function (tr) {
        var src = L.drums.tracks.find(function (x) { return x && x.id === tr.id; });
        if (src) {
          tr.steps = resizeArr((src.steps || []).map(function (v) { return v === 2 ? 2 : (v ? 1 : 0); }), total, 0);
          tr.mute = !!src.mute; tr.solo = !!src.solo; tr.gain = (+src.gain) || 0;
          if (typeof src.sample === 'string') tr.sample = src.sample;
        }
      });
    }
    if (L.bass) {
      if (typeof L.bass.instrument === 'string') layers.bass.instrument = L.bass.instrument;
      if (L.bass.sidechain) layers.bass.sidechain = { on: !!L.bass.sidechain.on, source: L.bass.sidechain.source || 'kick', amount: clamp((+L.bass.sidechain.amount) || 0.7, 0, 1) };
      layers.bass.notes = cleanNotes(L.bass.notes, total, RANGE.bassMidi[0], RANGE.bassMidi[1]);
    }
    if (L.harmony) {
      var h = L.harmony;
      if (typeof h.instrument === 'string') layers.harmony.instrument = h.instrument;
      if (HARM_MODES.indexOf(h.mode) >= 0) layers.harmony.mode = h.mode;
      if (h.rate) layers.harmony.rate = h.rate;
      layers.harmony.octave = clamp((+h.octave) || 4, RANGE.octave[0], RANGE.octave[1]);
      layers.harmony.reverb = clamp(h.reverb == null ? 0.4 : +h.reverb, 0, 1);
      layers.harmony.chorus = clamp(h.chorus == null ? 0.2 : +h.chorus, 0, 1);
    }
    if (L.melody) {
      if (typeof L.melody.instrument === 'string') layers.melody.instrument = L.melody.instrument;
      if (NOTE_NAMES.indexOf(L.melody.key) >= 0) layers.melody.key = L.melody.key;
      if (SCALES[L.melody.scale]) layers.melody.scale = L.melody.scale;
      layers.melody.reverb = clamp(L.melody.reverb == null ? 0.25 : +L.melody.reverb, 0, 1);
      layers.melody.notes = cleanNotes(L.melody.notes, total, RANGE.melodyMidi[0], RANGE.melodyMidi[1]);
    }
    var bars = total / STEPS_PER_BAR;
    for (var b = 0; b < bars; b++) {
      var src = (L.harmony && Array.isArray(L.harmony.chords)) ? L.harmony.chords[b] : null;
      layers.harmony.chords[b] = (src && NOTE_NAMES.concat('—').indexOf(src.root) >= 0)
        ? { root: src.root, quality: CHORD_QUALITIES[src.quality] ? src.quality : 'min7' }
        : { root: '—', quality: 'min7' };
    }
    if (L.fx && Array.isArray(L.fx.events)) {
      layers.fx.events = L.fx.events.filter(function (e) { return e && FX_TYPES.indexOf(e.type) >= 0; })
        .map(function (e) { return { type: e.type, step: clamp((+e.step) || 0, 0, total - 1), len: clamp((+e.len) || 4, 1, total) }; });
    }
    return layers;
  }
  function coerceSection(s, patterns, secId) {
    var type = SECTION_PRESET[s.type] ? s.type : 'verse';
    var pre = SECTION_PRESET[type];
    var patOk = patterns.some(function (p) { return p.id === s.pattern; });
    var dy = s.dyn || {};
    return {
      id: 's' + secId, type: type, pattern: patOk ? s.pattern : patterns[0].id, repeats: clamp((+s.repeats) || pre.repeats, RANGE.repeats[0], RANGE.repeats[1]),
      layers: { drums: bool(s.layers && s.layers.drums, pre.layers.drums), bass: bool(s.layers && s.layers.bass, pre.layers.bass), harmony: bool(s.layers && s.layers.harmony, pre.layers.harmony), melody: bool(s.layers && s.layers.melody, pre.layers.melody), fx: bool(s.layers && s.layers.fx, pre.layers.fx) },
      dyn: { filterFrom: clamp((+dy.filterFrom) || pre.dyn.filterFrom, 100, 20000), filterTo: clamp((+dy.filterTo) || pre.dyn.filterTo, 100, 20000), fadeIn: bool(dy.fadeIn, pre.dyn.fadeIn), fadeOut: bool(dy.fadeOut, pre.dyn.fadeOut), autoRiser: bool(dy.autoRiser, pre.dyn.autoRiser), autoImpact: bool(dy.autoImpact, pre.dyn.autoImpact) }
    };
  }
  function defaultProject() {
    var grid = { bars: 2, stepsPerBar: STEPS_PER_BAR };
    return {
      format: 'todo-music-arranger', version: 2,
      tempo: { bpm: 128, swing: 0 }, grid: grid, master: { volume: -8, filter: 20000, reverb: 0.15 },
      activePattern: 0, patterns: [{ id: 'p1', name: 'A', enabled: defaultEnabled(), layers: defaultLayers(grid.bars) }],
      playMode: 'pattern', song: { loop: true, sections: [] }, interactive: null
    };
  }
  function coerceProject(raw) {
    var p = defaultProject();
    if (!raw || typeof raw !== 'object') return markNormalized(p);
    if (raw.tempo) { p.tempo.bpm = clamp((+raw.tempo.bpm) || 128, RANGE.bpm[0], RANGE.bpm[1]); p.tempo.swing = clamp((+raw.tempo.swing) || 0, RANGE.swing[0], RANGE.swing[1]); }
    if (raw.grid && RANGE.gridBars.indexOf(+raw.grid.bars) >= 0) p.grid.bars = +raw.grid.bars;
    var total = p.grid.bars * STEPS_PER_BAR;
    if (raw.master) {
      p.master.volume = clamp(raw.master.volume == null ? -8 : +raw.master.volume, RANGE.volume[0], RANGE.volume[1]);
      p.master.filter = clamp((+raw.master.filter) || 20000, RANGE.filter[0], RANGE.filter[1]);
      p.master.reverb = clamp((+raw.master.reverb) || 0.15, 0, 1);
    }
    var patSeq = 1, secSeq = 1;
    var rawPats = (Array.isArray(raw.patterns) && raw.patterns.length) ? raw.patterns
      : (raw.layers ? [{ id: 'p1', name: 'A', layers: raw.layers }] : null); // v1 compat: single layers → pattern A
    if (rawPats) p.patterns = rawPats.map(function (rp, i) { return { id: 'p' + (patSeq++), name: String((rp && rp.name) || letter(i)), enabled: coerceEnabled(rp && rp.enabled), layers: coerceLayers(rp && rp.layers, total) }; });
    p.activePattern = clamp((+raw.activePattern) || 0, 0, p.patterns.length - 1);
    var idMap = {}; (rawPats || []).forEach(function (rp, i) { if (rp && rp.id) idMap[rp.id] = p.patterns[i].id; });
    if (raw.song && Array.isArray(raw.song.sections)) {
      p.song.loop = raw.song.loop !== false;
      p.song.sections = raw.song.sections.filter(function (s) { return s && SECTION_PRESET[s.type]; })
        .map(function (s) { var src = {}; for (var k in s) if (has(s, k)) src[k] = s[k]; src.pattern = idMap[s.pattern] || s.pattern; return coerceSection(src, p.patterns, secSeq++); });
    }
    if (raw.playMode === 'song') p.playMode = 'song';
    p.interactive = coerceInteractive(raw.interactive, p);
    return markNormalized(p);
  }

  // ── public parse ────────────────────────────────────────────────────────
  function toObject(input) {
    if (typeof input === 'string') return JSON.parse(input); // may throw SyntaxError (documented)
    return input;
  }
  function parseArrangement(input) { return coerceProject(toObject(input)); }
  function isArrangement(input) {
    var o; try { o = toObject(input); } catch (e) { return false; }
    return !!(o && typeof o === 'object' && (o.format === 'todo-music-arranger' || Array.isArray(o.patterns) || o.layers));
  }
  function ensureProject(input) {
    if (input && typeof input === 'object' && input.__acNormalized) return input;
    return parseArrangement(input);
  }
  function patternById(project, id) { return project.patterns.find(function (p) { return p.id === id; }) || null; }

  // ═══════════════════════════════════════════════════════════════════════
  //  Validation (strict, non-mutating) — checks RAW input against the schema
  //  contract. Returns { ok, errors, warnings }. Errors = will drop/corrupt
  //  data on import; warnings = imports but changes intent / musicality.
  // ═══════════════════════════════════════════════════════════════════════
  function validateArrangement(input) {
    var errors = [], warnings = [], raw;
    try { raw = toObject(input); } catch (e) { return { ok: false, errors: ['Invalid JSON: ' + e.message], warnings: warnings }; }
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Root is not an object'], warnings: warnings };

    if (raw.format !== 'todo-music-arranger') warnings.push('format should be "todo-music-arranger" (got ' + JSON.stringify(raw.format) + ')');
    if (raw.version !== 2) warnings.push('version should be 2 (got ' + JSON.stringify(raw.version) + ')');

    var bars = 2;
    if (raw.grid && raw.grid.bars != null) {
      if (RANGE.gridBars.indexOf(+raw.grid.bars) < 0) errors.push('grid.bars must be one of 1,2,4,8 (got ' + raw.grid.bars + ')');
      else bars = +raw.grid.bars;
    }
    var total = bars * STEPS_PER_BAR;
    if (raw.tempo && raw.tempo.bpm != null && (raw.tempo.bpm < RANGE.bpm[0] || raw.tempo.bpm > RANGE.bpm[1])) warnings.push('tempo.bpm ' + raw.tempo.bpm + ' will be clamped to [' + RANGE.bpm + ']');

    var pats = Array.isArray(raw.patterns) && raw.patterns.length ? raw.patterns : (raw.layers ? [{ id: 'p1', name: 'A', layers: raw.layers }] : null);
    if (!pats) { errors.push('No patterns[] (and no v1 layers) — nothing to import'); return finish(); }

    pats.forEach(function (pt, pi) {
      var tag = 'pattern[' + pi + ']' + (pt && pt.name ? ' "' + pt.name + '"' : '');
      var L = (pt && pt.layers) || {};
      // drums
      if (L.drums && Array.isArray(L.drums.tracks)) {
        if (L.drums.machine != null && DRUM_MACHINES.indexOf(L.drums.machine) < 0) warnings.push(tag + ' drums.machine "' + L.drums.machine + '" unknown → TR-808');
        if (L.drums.engine != null && L.drums.engine !== 'synth' && L.drums.engine !== 'sample') warnings.push(tag + ' drums.engine "' + L.drums.engine + '" → synth');
        L.drums.tracks.forEach(function (tr) {
          if (!tr || !Array.isArray(tr.steps)) return;
          if (tr.steps.length !== total) errors.push(tag + ' drums.' + tr.id + '.steps length ' + tr.steps.length + ' ≠ bars*16 (' + total + ')');
          if (tr.steps.some(function (v) { return v !== 0 && v !== 1 && v !== 2; })) errors.push(tag + ' drums.' + tr.id + '.steps has values outside {0,1,2}');
        });
        DRUM_ROWS.forEach(function (r) { if (!L.drums.tracks.some(function (t) { return t && t.id === r.id; })) warnings.push(tag + ' drums missing track "' + r.id + '" → filled empty'); });
      } else if (L.drums) warnings.push(tag + ' drums.tracks missing/!array → empty kit');
      // bass / melody notes
      checkNotes(tag + ' bass', L.bass && L.bass.notes, total, RANGE.bassMidiRec, 'bass');
      checkNotes(tag + ' melody', L.melody && L.melody.notes, total, RANGE.melodyMidiRec, 'melody', L.melody);
      // harmony
      if (L.harmony) {
        if (L.harmony.mode != null && HARM_MODES.indexOf(L.harmony.mode) < 0) warnings.push(tag + ' harmony.mode "' + L.harmony.mode + '" → pad');
        if (L.harmony.rate != null && !ARP_RATES[L.harmony.rate]) warnings.push(tag + ' harmony.rate "' + L.harmony.rate + '" unknown → treated as 16n');
        if (Array.isArray(L.harmony.chords)) {
          if (L.harmony.chords.length !== bars) errors.push(tag + ' harmony.chords length ' + L.harmony.chords.length + ' ≠ bars (' + bars + ')');
          L.harmony.chords.forEach(function (c, ci) {
            if (!c) return;
            if (NOTE_NAMES.concat('—').indexOf(c.root) < 0) errors.push(tag + ' harmony.chords[' + ci + '].root "' + c.root + '" invalid (sharps only, e.g. G# not Ab; or "—")');
            if (c.quality != null && !CHORD_QUALITIES[c.quality]) errors.push(tag + ' harmony.chords[' + ci + '].quality "' + c.quality + '" not in enum → min7');
          });
        }
      }
      // fx
      if (L.fx && Array.isArray(L.fx.events)) L.fx.events.forEach(function (e, ei) {
        if (!e) return;
        if (FX_TYPES.indexOf(e.type) < 0) errors.push(tag + ' fx.events[' + ei + '].type "' + e.type + '" not in enum → dropped');
        else if (e.step != null && (e.step < 0 || e.step >= total)) warnings.push(tag + ' fx.events[' + ei + '].step ' + e.step + ' out of [0,' + (total - 1) + '] → clamped');
      });
    });

    // sections
    if (raw.playMode === 'song' && (!raw.song || !Array.isArray(raw.song.sections) || !raw.song.sections.length)) warnings.push('playMode "song" but song.sections is empty — nothing will play');
    if (raw.song && Array.isArray(raw.song.sections)) {
      var patIds = pats.map(function (p, i) { return (p && p.id) || ('p' + (i + 1)); });
      raw.song.sections.forEach(function (s, si) {
        if (!s) return;
        if (SECTION_TYPES.indexOf(s.type) < 0) { errors.push('section[' + si + '].type "' + s.type + '" invalid → section dropped on import'); return; }
        if (s.pattern != null && patIds.indexOf(s.pattern) < 0) warnings.push('section[' + si + '] (' + s.type + ') pattern "' + s.pattern + '" not found → falls back to first pattern');
      });
    }

    // interactive (optional block)
    if (raw.interactive && typeof raw.interactive === 'object') {
      var iv = raw.interactive;
      var patIds2 = pats.map(function (p, i) { return (p && p.id) || ('p' + (i + 1)); });
      var ivChans = Array.isArray(iv.channels) ? iv.channels : [];
      var chIds2 = ivChans.map(function (c, i) { return (c && c.id) || ('ch' + (i + 1)); });
      ivChans.forEach(function (c, ci) {
        if (!c) return;
        var srcs = Array.isArray(c.sources) ? c.sources : [];
        if (!srcs.length) warnings.push('interactive.channels[' + ci + '] "' + (c.id || '') + '" has no sources');
        srcs.forEach(function (s, sidx) {
          if (!s) return;
          if (patIds2.indexOf(s.pattern) < 0) warnings.push('interactive.channels[' + ci + '].sources[' + sidx + '].pattern "' + s.pattern + '" not found → dropped');
          if (LAYER_NAMES.indexOf(s.layer) < 0) warnings.push('interactive.channels[' + ci + '].sources[' + sidx + '].layer "' + s.layer + '" invalid → dropped');
        });
        if (c.rtpc != null && !(Array.isArray(iv.rtpc) && iv.rtpc.some(byId(c.rtpc)))) warnings.push('interactive.channels[' + ci + '].rtpc "' + c.rtpc + '" not defined → ignored');
      });
      (Array.isArray(iv.scenes) ? iv.scenes : []).forEach(function (s, si) {
        if (!s) return;
        (Array.isArray(s.on) ? s.on : []).forEach(function (id) { if (chIds2.indexOf(id) < 0) warnings.push('interactive.scenes[' + si + '] "' + (s.id || '') + '" enables unknown channel "' + id + '"'); });
      });
      if (iv['default'] != null && !(Array.isArray(iv.scenes) && iv.scenes.some(byId(iv['default'])))) warnings.push('interactive.default "' + iv['default'] + '" is not a defined scene');
      if (iv.transition && iv.transition.sync != null && SYNC_MODES.indexOf(iv.transition.sync) < 0) warnings.push('interactive.transition.sync "' + iv.transition.sync + '" invalid → nextBar');
    }

    function checkNotes(label, notes, total, recRange, layerName, melLayer) {
      if (!Array.isArray(notes)) return;
      notes.forEach(function (n, ni) {
        if (!n || typeof n.step !== 'number' || typeof n.midi !== 'number') { warnings.push(label + '.notes[' + ni + '] missing step/midi → dropped'); return; }
        if (n.step < 0 || n.step >= total) warnings.push(label + '.notes[' + ni + '].step ' + n.step + ' out of [0,' + (total - 1) + '] → clamped');
        if (n.len != null && n.len < 1) warnings.push(label + '.notes[' + ni + '].len ' + n.len + ' < 1 → set to 1');
        if (n.midi < recRange[0] || n.midi > recRange[1]) warnings.push(label + '.notes[' + ni + '].midi ' + n.midi + ' outside recommended ' + layerName + ' range [' + recRange + ']');
        if (melLayer && melLayer.key && melLayer.scale && SCALES[melLayer.scale] && NOTE_NAMES.indexOf(melLayer.key) >= 0 && !isInScale(n.midi, melLayer.key, melLayer.scale))
          warnings.push(label + '.notes[' + ni + '].midi ' + n.midi + ' (' + midiToNoteName(n.midi) + ') is out of ' + melLayer.key + ' ' + melLayer.scale);
      });
    }
    function finish() { return { ok: errors.length === 0, errors: errors, warnings: warnings }; }
    return finish();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Query / derived data — mirrors the tool's playback semantics
  // ═══════════════════════════════════════════════════════════════════════
  function stepSecOf(project) { return (60 / project.tempo.bpm) / 4; } // one 16th, nominal (swing not applied)

  function getTimeline(input) {
    var p = ensureProject(input), SPB = STEPS_PER_BAR, bars = p.grid.bars, ss = stepSecOf(p);
    var list = [], bar = 0;
    (p.song.sections || []).forEach(function (sec) {
      var repeats = Math.max(1, sec.repeats), secBars = repeats * bars;
      list.push({ id: sec.id, type: sec.type, patternId: sec.pattern, repeats: repeats, startBar: bar, bars: secBars, startStep: bar * SPB, steps: secBars * SPB, startSec: bar * SPB * ss, durSec: secBars * SPB * ss, layers: sec.layers, dyn: sec.dyn });
      bar += secBars;
    });
    return { bpm: p.tempo.bpm, swing: p.tempo.swing, bars: bars, stepSec: ss, totalBars: bar, totalSteps: bar * SPB, durationSec: bar * SPB * ss, sections: list };
  }
  function getDurationSeconds(input) { return getTimeline(input).durationSec; }

  function getChordChart(input) {
    var p = ensureProject(input), tl = getTimeline(p), bars = p.grid.bars, out = [];
    tl.sections.forEach(function (seg) {
      var pat = patternById(p, seg.patternId); if (!pat) return;
      for (var b = 0; b < seg.bars; b++) {
        var patBar = b % bars, ch = pat.layers.harmony.chords[patBar] || { root: '—', quality: 'min7' };
        var gbar = seg.startBar + b;
        out.push({ bar: gbar, startSec: gbar * STEPS_PER_BAR * tl.stepSec, sectionId: seg.id, sectionType: seg.type, patternId: pat.id, root: ch.root, quality: ch.quality, silent: ch.root === '—', notes: chordToMidi(ch, pat.layers.harmony.octave), octave: pat.layers.harmony.octave });
      }
    });
    return out;
  }

  // Emit sounding events for one pattern loop at the given step offsets.
  function collect(out, pat, localStep, on, ctx) {
    var La = ctx.layers; // section (or all-true) gate
    // drums
    if (pat.layers.drums && (on.drums)) {
      var D = pat.layers.drums, anySolo = D.tracks.some(function (t) { return t.solo; });
      D.tracks.forEach(function (row) {
        var v = row.steps[localStep]; if (!v) return;
        var audible = !row.mute && !(anySolo && !row.solo);
        if (ctx.onlyAudible && !audible) return;
        out.push({ kind: 'drum', track: row.id, name: row.name, midi: null, note: null, step: ctx.g, localStep: localStep, stepInBar: localStep % 16, bar: ctx.bar, timeSec: ctx.time, accent: v === 2, velocity: v === 2 ? 1.0 : 0.78, gain: row.gain || 0, lenSteps: 0, durSec: 0, audible: audible, sectionId: ctx.sectionId, sectionType: ctx.sectionType, patternId: pat.id });
      });
    }
    // bass / melody
    ['bass', 'melody'].forEach(function (ln) {
      if (!on[ln]) return; var Ly = pat.layers[ln]; if (!Ly || !Ly.notes) return;
      Ly.notes.forEach(function (n) {
        if (n.step !== localStep) return;
        out.push({ kind: ln, track: null, midi: n.midi, note: midiToNoteName(n.midi), step: ctx.g, localStep: localStep, stepInBar: localStep % 16, bar: ctx.bar, timeSec: ctx.time, lenSteps: n.len, durSec: n.len * ctx.ss, velocity: ln === 'bass' ? 0.9 : 0.85, audible: true, sectionId: ctx.sectionId, sectionType: ctx.sectionType, patternId: pat.id });
      });
    });
    // harmony (pad / pluck / arp) — mirrors triggerHarmony
    if (on.harmony) {
      var H = pat.layers.harmony, patBar = Math.floor(localStep / 16), inBar = localStep % 16, chord = H.chords[patBar];
      if (chord && chord.root !== '—') {
        var notes = chordToMidi(chord, H.octave);
        if (notes.length) {
          var baseH = { kind: 'harmony', mode: H.mode, root: chord.root, quality: chord.quality, octave: H.octave, step: ctx.g, localStep: localStep, stepInBar: inBar, bar: ctx.bar, timeSec: ctx.time, audible: true, sectionId: ctx.sectionId, sectionType: ctx.sectionType, patternId: pat.id };
          if (H.mode === 'pad') { if (inBar === 0) out.push(Object.assign(baseH, { notes: notes.slice(), noteNames: notes.map(midiToNoteName), lenSteps: 16, durSec: 16 * ctx.ss * 0.98 })); }
          else if (H.mode === 'pluck') { if (inBar % 4 === 0) out.push(Object.assign(baseH, { notes: notes.slice(), noteNames: notes.map(midiToNoteName), lenSteps: 2, durSec: 2 * ctx.ss })); }
          else { var rs = Math.max(1, Math.round(rateToSteps(H.rate))); if (localStep % rs === 0) { var ai = Math.floor(localStep / rs) % notes.length; out.push(Object.assign(baseH, { midi: notes[ai], note: midiToNoteName(notes[ai]), arpIndex: ai, lenSteps: rs, durSec: rs * ctx.ss * 0.9 })); } }
        }
      }
    }
    // fx (per-pattern events)
    if (on.fx && pat.layers.fx && pat.layers.fx.events) pat.layers.fx.events.forEach(function (ev) {
      if (ev.step !== localStep) return;
      out.push({ kind: 'fx', fxType: ev.type, auto: false, step: ctx.g, localStep: localStep, stepInBar: localStep % 16, bar: ctx.bar, timeSec: ctx.time, lenSteps: ev.len, durSec: ev.len * ctx.ss, audible: true, sectionId: ctx.sectionId, sectionType: ctx.sectionType, patternId: pat.id });
    });
    void La;
  }

  // All sounding events for one pattern, one loop, times relative to 0.
  function getPatternEvents(input, patternRef, options) {
    var p = ensureProject(input), opts = options || {};
    var pat = resolvePattern(p, patternRef); if (!pat) return [];
    var ss = stepSecOf(p), total = p.grid.bars * STEPS_PER_BAR, out = [];
    var on = opts.ignoreEnabled ? defaultEnabled() : (pat.enabled || defaultEnabled());
    for (var s = 0; s < total; s++) collect(out, pat, s, on, { g: s, bar: Math.floor(s / 16), time: s * ss, ss: ss, onlyAudible: opts.onlyAudible !== false, layers: on, sectionId: null, sectionType: null });
    return out.sort(byStep);
  }

  // All sounding events for the whole song timeline (section-gated).
  function getSongEvents(input, options) {
    var p = ensureProject(input), opts = options || {}, onlyAudible = opts.onlyAudible !== false, includeFx = opts.includeFx !== false, includeAutoFx = opts.includeAutoFx !== false;
    var tl = getTimeline(p), SPB = STEPS_PER_BAR, bars = p.grid.bars, ss = tl.stepSec;
    var byId = {}; p.patterns.forEach(function (pt) { byId[pt.id] = pt; });
    var out = [], secs = tl.sections, si = 0;
    for (var g = 0; g < tl.totalSteps; g++) {
      var gbar = Math.floor(g / SPB);
      while (si < secs.length - 1 && gbar >= secs[si].startBar + secs[si].bars) si++;
      var seg = secs[si]; if (!seg || gbar < seg.startBar || gbar >= seg.startBar + seg.bars) continue;
      var pat = byId[seg.patternId]; if (!pat) continue;
      var en = pat.enabled || defaultEnabled();
      var on = { drums: !!(seg.layers.drums && en.drums), bass: !!(seg.layers.bass && en.bass), harmony: !!(seg.layers.harmony && en.harmony), melody: !!(seg.layers.melody && en.melody), fx: includeFx && !!(seg.layers.fx && en.fx) };
      var localStep = ((gbar - seg.startBar) % bars) * SPB + (g % SPB);
      collect(out, pat, localStep, on, { g: g, bar: gbar, time: g * ss, ss: ss, onlyAudible: onlyAudible, layers: seg.layers, sectionId: seg.id, sectionType: seg.type });
    }
    // section-level auto FX (fire once on section entry — mirrors applySectionDynamics)
    if (includeAutoFx) secs.forEach(function (seg) {
      if (seg.dyn && seg.dyn.autoImpact) out.push(autoFx('impact', seg.startStep, 2, seg, ss));
      if (seg.dyn && seg.dyn.autoRiser) { var st = seg.startStep + seg.steps - SPB; out.push(autoFx('riser', st, SPB, seg, ss)); }
    });
    return out.sort(byStep);
  }
  function autoFx(type, step, len, seg, ss) { return { kind: 'fx', fxType: type, auto: true, step: step, localStep: null, stepInBar: step % 16, bar: Math.floor(step / 16), timeSec: step * ss, lenSteps: len, durSec: len * ss, audible: true, sectionId: seg.id, sectionType: seg.type, patternId: seg.patternId }; }
  function byStep(a, b) { return a.step - b.step || kindRank(a.kind) - kindRank(b.kind); }
  function kindRank(k) { return { fx: 0, drum: 1, bass: 2, harmony: 3, melody: 4 }[k] || 9; }

  function resolvePattern(project, ref) {
    if (ref == null) return project.patterns[project.activePattern] || project.patterns[0];
    if (typeof ref === 'number') return project.patterns[ref] || null;
    if (typeof ref === 'string') return patternById(project, ref);
    if (ref && ref.id) return patternById(project, ref.id) || ref;
    return null;
  }

  function summarize(input) {
    var p = ensureProject(input), tl = getTimeline(p), mel = p.patterns[p.activePattern].layers.melody;
    return {
      format: p.format, version: p.version, bpm: p.tempo.bpm, swing: p.tempo.swing, bars: p.grid.bars,
      key: mel.key, scale: mel.scale, playMode: p.playMode, loop: p.song.loop,
      patterns: p.patterns.map(function (pt) { return { id: pt.id, name: pt.name }; }),
      sections: tl.sections.map(function (s) { return { type: s.type, patternId: s.patternId, bars: s.bars, startSec: round2(s.startSec), durSec: round2(s.durSec) }; }),
      totalBars: tl.totalBars, durationSec: round2(tl.durationSec)
    };
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  // ═══════════════════════════════════════════════════════════════════════
  //  MIDI export — Standard MIDI File (format 1), pure JS, no deps.
  //  Groups events into 4 tracks: Drums (GM perc, ch10), Bass, Harmony, Melody.
  //  toMIDI(input, { ppq?, source?: 'song'|'pattern', patternRef?, events? }) → Uint8Array
  // ═══════════════════════════════════════════════════════════════════════
  var GM_DRUM = { kick: 36, snare: 38, clap: 39, chh: 42, ohh: 46, perc: 45 };
  function vlq(n) { var b = [n & 0x7f]; n = Math.floor(n / 128); while (n > 0) { b.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); } return b; }
  function pushU32(a, n) { a.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
  function pushU16(a, n) { a.push((n >>> 8) & 255, n & 255); }
  function pushStr(a, s) { for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 255); }
  function midiChunk(id, bytes) { var out = []; pushStr(out, id); pushU32(out, bytes.length); return out.concat(bytes); }
  function toMIDI(input, options) {
    var p = ensureProject(input), opts = options || {}, ppq = opts.ppq || 480, bpm = p.tempo.bpm, tps = ppq / 4;
    var events = opts.events
      || (opts.source === 'pattern' ? getPatternEvents(p, opts.patternRef, { ignoreEnabled: true, onlyAudible: true })
        : getSongEvents(p, { includeFx: false, includeAutoFx: false }));
    var TRK = [{ name: 'Drums', ch: 9, notes: [] }, { name: 'Bass', ch: 0, notes: [] }, { name: 'Harmony', ch: 1, notes: [] }, { name: 'Melody', ch: 2, notes: [] }];
    var idx = { drum: 0, bass: 1, harmony: 2, melody: 3 };
    events.forEach(function (e) {
      var ti = idx[e.kind]; if (ti == null) return;
      var startTick = Math.round(e.step * tps), durTick = Math.max(1, Math.round((e.lenSteps || 1) * tps));
      var vel = clamp(Math.round((e.velocity != null ? e.velocity : 0.8) * 127), 1, 127);
      if (e.kind === 'drum') { var dn = GM_DRUM[e.track]; if (dn == null) return; TRK[0].notes.push({ t: startTick, d: Math.max(1, Math.round(tps / 2)), n: dn, v: vel }); return; }
      var notes = e.kind === 'harmony' ? (e.notes || (e.midi != null ? [e.midi] : [])) : (e.midi != null ? [e.midi] : []);
      notes.forEach(function (n) { TRK[ti].notes.push({ t: startTick, d: durTick, n: n, v: vel }); });
    });
    var mpq = Math.round(60000000 / bpm), cond = [];
    cond = cond.concat(vlq(0), [0xff, 0x51, 0x03, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]);
    cond = cond.concat(vlq(0), [0xff, 0x58, 0x04, 4, 2, 24, 8]);
    cond = cond.concat(vlq(0), [0xff, 0x2f, 0x00]);
    var tracks = [midiChunk('MTrk', cond)];
    TRK.forEach(function (tr) {
      if (!tr.notes.length) return;
      var evl = [];
      tr.notes.forEach(function (nn) { evl.push({ tick: nn.t, s: [0x90 | tr.ch, nn.n, nn.v] }); evl.push({ tick: nn.t + nn.d, s: [0x80 | tr.ch, nn.n, 0] }); });
      evl.sort(function (a, b) { return a.tick - b.tick || (a.s[0] & 0xf0) - (b.s[0] & 0xf0); });
      var body = [], last = 0;
      body = body.concat(vlq(0), [0xff, 0x03, tr.name.length]); pushStr(body, tr.name);
      evl.forEach(function (ev) { body = body.concat(vlq(ev.tick - last), ev.s); last = ev.tick; });
      body = body.concat(vlq(0), [0xff, 0x2f, 0x00]);
      tracks.push(midiChunk('MTrk', body));
    });
    var header = []; pushU16(header, 1); pushU16(header, tracks.length); pushU16(header, ppq);
    var all = midiChunk('MThd', header);
    tracks.forEach(function (t) { all = all.concat(t); });
    return new Uint8Array(all);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Interactive music (Wwise-style) — optional `project.interactive` block.
  //
  //  channels — named stems, each bound to one or more (pattern, layer) sources.
  //             Everything plays phase-locked; a channel's gain gates audibility.
  //  scenes   — game States. Each says which channels are ON (+ optional master
  //             filter/volume and RTPC values). Switching scene = vertical
  //             re-orchestration; binding channels to different patterns per
  //             scene = horizontal re-sequencing (different 段落 per scene).
  //  rtpc     — continuous params (0..1 after normalize) that scale channel gain.
  //  transition — sync boundary (immediate/nextBeat/nextBar/nextLoop) + fade.
  //
  //  The InteractiveMusicController is engine-agnostic: it computes per-channel
  //  target gains + master + the exact transition time, and pushes them to a
  //  `sink` you implement (see interactive-tone-player.js for a Tone.js sink).
  // ═══════════════════════════════════════════════════════════════════════
  var SYNC_MODES = ['immediate', 'nextBeat', 'nextBar', 'nextLoop'];
  var SILENCE_DB = -60;
  var LAYER_NAMES = ['drums', 'bass', 'harmony', 'melody', 'fx'];
  var LAYER_LABEL = { drums: '鼓组', bass: '贝斯', harmony: '和声', melody: '旋律', fx: '音效' };
  function dbToLin(db) { return Math.pow(10, db / 20); }
  function linToDb(lin) { return lin <= 0 ? SILENCE_DB : Math.max(SILENCE_DB, 20 * Math.log10(lin)); }
  function byId(id) { return function (x) { return x && x.id === id; }; }
  function findById(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i]; return null; }
  function layerKind(layer) { return layer === 'drums' ? 'drum' : layer; }

  // RTPC response curve: piecewise-linear breakpoints [[x,y]...], x,y in 0..1
  // (x = normalized param value, y = gain multiplier). Editable in the tool.
  function normalizeCurve(c) {
    if (!Array.isArray(c) || !c.length) return [[0, 0], [1, 1]];
    var pts = c.filter(function (p) { return Array.isArray(p) && p.length >= 2; }).map(function (p) { return [clamp(+p[0] || 0, 0, 1), clamp(+p[1] || 0, 0, 1)]; });
    if (!pts.length) return [[0, 0], [1, 1]];
    pts.sort(function (a, b) { return a[0] - b[0]; });
    if (pts.length < 2) pts = [[0, pts[0][1]], [1, pts[0][1]]];
    return pts;
  }
  function normalizeRtpcBinding(v) {
    if (!v) return null;
    if (typeof v === 'string') return { param: v, curve: [[0, 0], [1, 1]] };
    if (typeof v === 'object' && v.param != null) return { param: String(v.param), curve: normalizeCurve(v.curve) };
    return null;
  }
  function evalCurve(curve, x) {
    var c = (curve && curve.length) ? curve : [[0, 0], [1, 1]];
    x = clamp(x, 0, 1);
    if (x <= c[0][0]) return c[0][1];
    for (var i = 1; i < c.length; i++) { if (x <= c[i][0]) { var a = c[i - 1], b = c[i], span = (b[0] - a[0]) || 1; return a[1] + (b[1] - a[1]) * ((x - a[0]) / span); } }
    return c[c.length - 1][1];
  }

  function coerceInteractive(raw, project) {
    if (!raw || typeof raw !== 'object') return null;
    var patIds = project.patterns.map(function (p) { return p.id; });
    var chSeq = 1, scSeq = 1;
    var channels = (Array.isArray(raw.channels) ? raw.channels : []).map(function (c) {
      var srcs = (Array.isArray(c && c.sources) ? c.sources : []).filter(function (s) {
        return s && patIds.indexOf(s.pattern) >= 0 && LAYER_NAMES.indexOf(s.layer) >= 0;
      }).map(function (s) { return { pattern: s.pattern, layer: s.layer }; });
      return { id: String((c && c.id) || ('ch' + (chSeq++))), name: String((c && c.name) || ('Channel ' + chSeq)), sources: srcs, gain: clamp((c && +c.gain) || 0, -40, 6), rtpc: normalizeRtpcBinding(c && c.rtpc) };
    });
    var chIds = channels.map(function (c) { return c.id; });
    var rtpc = (Array.isArray(raw.rtpc) ? raw.rtpc : []).map(function (r) {
      var min = (r && r.min != null) ? +r.min : 0, max = (r && r.max != null) ? +r.max : 1;
      if (max === min) max = min + 1;
      return { id: String((r && r.id) || 'param'), name: String((r && r.name) || (r && r.id) || 'param'), min: min, max: max, 'default': clamp((r && r['default'] != null) ? +r['default'] : min, Math.min(min, max), Math.max(min, max)) };
    });
    var rtpcIds = rtpc.map(function (r) { return r.id; });
    // drop channel.rtpc refs that don't resolve
    channels.forEach(function (c) { if (c.rtpc && rtpcIds.indexOf(c.rtpc.param) < 0) c.rtpc = null; });
    var scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map(function (s) {
      var on = (Array.isArray(s && s.on) ? s.on : []).filter(function (id) { return chIds.indexOf(id) >= 0; });
      var master = (s && s.master) || {};
      var scRtpc = {}; if (s && s.rtpc && typeof s.rtpc === 'object') Object.keys(s.rtpc).forEach(function (k) { if (rtpcIds.indexOf(k) >= 0) scRtpc[k] = +s.rtpc[k]; });
      return { id: String((s && s.id) || ('scene' + (scSeq++))), name: String((s && s.name) || (s && s.id) || ('Scene ' + scSeq)), on: on, master: { filter: master.filter != null ? clamp(+master.filter, 100, 20000) : null, volume: master.volume != null ? clamp(+master.volume, -40, 0) : null }, rtpc: scRtpc };
    });
    var stingers = (Array.isArray(raw.stingers) ? raw.stingers : []).map(function (s, i) {
      var srcs = (Array.isArray(s && s.sources) ? s.sources : []).filter(function (src) { return src && patIds.indexOf(src.pattern) >= 0 && LAYER_NAMES.indexOf(src.layer) >= 0; }).map(function (src) { return { pattern: src.pattern, layer: src.layer }; });
      return { id: String((s && s.id) || ('st' + (i + 1))), name: String((s && s.name) || ('Stinger ' + (i + 1))), sources: srcs, sync: SYNC_MODES.indexOf(s && s.sync) >= 0 ? s.sync : 'nextBeat', gain: clamp((s && +s.gain) || 0, -40, 6) };
    });
    var scIds = scenes.map(function (s) { return s.id; });
    var def = (raw['default'] && scIds.indexOf(raw['default']) >= 0) ? raw['default'] : (scIds[0] || null);
    var tr = raw.transition || {};
    var loopBars = RANGE.gridBars.indexOf(+raw.loopBars) >= 0 ? +raw.loopBars : project.grid.bars;
    return { loopBars: loopBars, channels: channels, rtpc: rtpc, scenes: scenes, stingers: stingers, 'default': def, transition: { sync: SYNC_MODES.indexOf(tr.sync) >= 0 ? tr.sync : 'nextBar', fadeSec: Math.max(0, (tr.fadeSec != null ? +tr.fadeSec : 1)) } };
  }

  // Scaffold a sensible interactive block for any arrangement: one channel per
  // non-empty (pattern, layer), one scene per pattern (horizontal switching),
  // plus a "layered" ambient scene (vertical). A helpful starting point to edit.
  function generateDefaultInteractive(input) {
    var p = ensureProject(input), channels = [], scenes = [];
    p.patterns.forEach(function (pat) {
      LAYER_NAMES.forEach(function (layer) {
        if (!layerHasContent(pat, layer)) return;
        channels.push({ id: 'ch_' + pat.id + '_' + layer, name: pat.name + ' · ' + (LAYER_LABEL[layer] || layer), sources: [{ pattern: pat.id, layer: layer }], gain: 0, rtpc: null });
      });
    });
    p.patterns.forEach(function (pat) {
      scenes.push({ id: 'scene_' + pat.id, name: pat.name + ' 场景', on: channels.filter(function (c) { return c.sources[0].pattern === pat.id; }).map(function (c) { return c.id; }), master: { filter: 20000 }, rtpc: {} });
    });
    // vertical demo: only harmony+melody of the first pattern
    var first = p.patterns[0];
    scenes.unshift({ id: 'scene_ambient', name: '氛围(留白)', on: channels.filter(function (c) { return c.sources[0].pattern === first.id && (c.sources[0].layer === 'harmony' || c.sources[0].layer === 'melody'); }).map(function (c) { return c.id; }), master: { filter: 6000 }, rtpc: {} });
    // one starter stinger from an audible layer (prefer a melodic phrase → drum fill)
    var stingers = [], stPat = null, stLayer = null;
    ['melody', 'drums', 'harmony', 'bass'].some(function (layer) { var pat = p.patterns.find(function (pp) { return layerHasContent(pp, layer); }); if (pat) { stPat = pat; stLayer = layer; return true; } return false; });
    if (stPat) stingers.push({ id: 'st_hit', name: '命中 Hit', sources: [{ pattern: stPat.id, layer: stLayer }], sync: 'nextBeat', gain: 0 });
    return coerceInteractive({ loopBars: p.grid.bars, channels: channels, rtpc: [], scenes: scenes, stingers: stingers, 'default': scenes[0] ? scenes[0].id : null, transition: { sync: 'nextBar', fadeSec: 1 } }, p);
  }
  function layerHasContent(pat, layer) {
    var L = pat.layers[layer]; if (!L) return false;
    if (layer === 'drums') return L.tracks.some(function (t) { return t.steps.some(function (v) { return v; }); });
    if (layer === 'harmony') return L.chords.some(function (c) { return c.root !== '—'; });
    if (layer === 'fx') return L.events.length > 0;
    return L.notes.length > 0;
  }

  function listChannels(input) { var p = ensureProject(input); return p.interactive ? p.interactive.channels.map(function (c) { return { id: c.id, name: c.name, sources: c.sources.slice(), rtpc: c.rtpc, gain: c.gain }; }) : []; }
  function listScenes(input) { var p = ensureProject(input); return p.interactive ? p.interactive.scenes.map(function (s) { return { id: s.id, name: s.name, on: s.on.slice(), master: s.master, rtpc: s.rtpc }; }) : []; }
  function listStingers(input) { var p = ensureProject(input); return (p.interactive && p.interactive.stingers) ? p.interactive.stingers.map(function (s) { return { id: s.id, name: s.name, sources: s.sources.slice(), sync: s.sync, gain: s.gain }; }) : []; }
  // Events for one pass of a stinger (its (pattern,layer) sources, played once). Times from 0.
  function getStingerClip(input, stingerId, options) {
    var p = ensureProject(input), it = p.interactive; if (!it || !it.stingers) return [];
    var st = findById(it.stingers, stingerId); if (!st) return [];
    var opts = options || {}, out = [];
    st.sources.forEach(function (src) {
      var kind = layerKind(src.layer);
      getPatternEvents(p, src.pattern, { ignoreEnabled: true, onlyAudible: opts.onlyAudible !== false }).filter(function (e) { return e.kind === kind; })
        .forEach(function (e) { out.push(Object.assign({}, e, { stingerId: st.id, sourcePattern: src.pattern, sourceLayer: src.layer })); });
    });
    return out.sort(byStep);
  }

  function resolveRtpcValue(it, param, overrideMap, scene) {
    if (overrideMap && overrideMap[param] != null) return +overrideMap[param];
    if (scene && scene.rtpc && scene.rtpc[param] != null) return +scene.rtpc[param];
    var rdef = findById(it.rtpc, param); return rdef ? rdef['default'] : 0;
  }
  function computeChannelGainDb(project, channelId, opts) {
    var it = project.interactive; if (!it) return SILENCE_DB;
    var ch = findById(it.channels, channelId); if (!ch) return SILENCE_DB;
    opts = opts || {};
    var scene = findById(it.scenes, opts.sceneId != null ? opts.sceneId : it['default']);
    var onSet = {}; if (scene) scene.on.forEach(function (id) { onSet[id] = true; });
    var overrides = opts.overrides || {};
    var isOn = (overrides[channelId] != null) ? !!overrides[channelId] : !!onSet[channelId];
    var mult = 1;
    if (ch.rtpc) {
      var rdef = findById(it.rtpc, ch.rtpc.param);
      if (rdef) { var val = resolveRtpcValue(it, ch.rtpc.param, opts.rtpc, scene); var n = clamp((val - rdef.min) / (rdef.max - rdef.min), 0, 1); mult = clamp(evalCurve(ch.rtpc.curve, n), 0, 1); }
    }
    return linToDb((isOn ? 1 : 0) * mult * dbToLin(ch.gain));
  }
  function resolveScene(input, sceneId, rtpcOverride, overrides) {
    var p = ensureProject(input), it = p.interactive; if (!it) return null;
    var scene = findById(it.scenes, sceneId != null ? sceneId : it['default']);
    var channels = it.channels.map(function (ch) {
      var db = computeChannelGainDb(p, ch.id, { sceneId: scene && scene.id, rtpc: rtpcOverride, overrides: overrides });
      return { id: ch.id, name: ch.name, sources: ch.sources.slice(), on: db > SILENCE_DB, gainDb: round2(db) };
    });
    return { sceneId: scene && scene.id, name: scene && scene.name, master: scene ? scene.master : { filter: null, volume: null }, channels: channels };
  }

  // Events for one loop of a channel (merging all its sources, tiling if the
  // interactive loop is longer than a pattern). Times are seconds from loop start.
  function getChannelClip(input, channelId, options) {
    var p = ensureProject(input), it = p.interactive; if (!it) return [];
    var ch = findById(it.channels, channelId); if (!ch) return [];
    var opts = options || {}, loopSteps = it.loopBars * STEPS_PER_BAR, patSteps = p.grid.bars * STEPS_PER_BAR, ss = stepSecOf(p), out = [];
    var tiles = Math.max(1, Math.round(loopSteps / patSteps));
    ch.sources.forEach(function (src) {
      var kind = layerKind(src.layer);
      var pev = getPatternEvents(p, src.pattern, { ignoreEnabled: true, onlyAudible: opts.onlyAudible !== false }).filter(function (e) { return e.kind === kind; });
      for (var t = 0; t < tiles; t++) pev.forEach(function (e) {
        var g = e.step + t * patSteps; if (g >= loopSteps) return;
        out.push(Object.assign({}, e, { step: g, timeSec: g * ss, channelId: ch.id, sourcePattern: src.pattern, sourceLayer: src.layer }));
      });
    });
    return out.sort(byStep);
  }

  // ── Engine-agnostic controller ──────────────────────────────────────────
  // sink (all methods optional):
  //   now(): number                                   current transport seconds
  //   setChannelGain(channelId, db, atTime, rampSec)
  //   setMaster(kind /* 'filter'|'volume' */, value, atTime, rampSec)
  function InteractiveMusicController(project, sink, options) {
    if (!(this instanceof InteractiveMusicController)) return new InteractiveMusicController(project, sink, options);
    this.project = ensureProject(project);
    this.it = this.project.interactive;
    if (!this.it) throw new Error('arrangement-core: project has no `interactive` block — call generateDefaultInteractive() and re-parse, or author one.');
    this.sink = sink || null; this.opts = options || {};
    this.sceneId = this.it['default']; this.overrides = {}; this.rtpc = {};
    var self = this; this.it.rtpc.forEach(function (r) { self.rtpc[r.id] = r['default']; });
    this._mix = null;
  }
  var ICP = InteractiveMusicController.prototype;
  ICP.timing = function () { var spb = 60 / this.project.tempo.bpm, secPerBar = spb * 4; return { secPerBeat: spb, secPerBar: secPerBar, loopSec: secPerBar * this.it.loopBars }; };
  ICP.syncTime = function (mode) {
    var now = (this.sink && this.sink.now) ? this.sink.now() : 0, t = this.timing(), eps = 1e-4;
    mode = mode || this.it.transition.sync;
    if (mode === 'immediate') return now;
    var unit = mode === 'nextBeat' ? t.secPerBeat : (mode === 'nextLoop' ? t.loopSec : t.secPerBar);
    return (Math.floor((now + eps) / unit) + 1) * unit;
  };
  ICP.currentMix = function () { return resolveScene(this.project, this.sceneId, this.rtpc, this.overrides); };
  ICP._apply = function (atTime, fadeSec) {
    var prev = this._mix, mix = this.currentMix(), sink = this.sink;
    if (sink) {
      mix.channels.forEach(function (c) { var p0 = prev ? findById(prev.channels, c.id) : null; if ((!p0 || p0.gainDb !== c.gainDb) && sink.setChannelGain) sink.setChannelGain(c.id, c.gainDb, atTime, fadeSec); });
      if (sink.setMaster) { if (mix.master.filter != null) sink.setMaster('filter', mix.master.filter, atTime, fadeSec); if (mix.master.volume != null) sink.setMaster('volume', mix.master.volume, atTime, fadeSec); }
    }
    this._mix = mix; return mix;
  };
  ICP._adoptRtpc = function (scene) { var self = this; if (scene && scene.rtpc) Object.keys(scene.rtpc).forEach(function (k) { self.rtpc[k] = scene.rtpc[k]; }); };
  ICP.start = function () { this._mix = null; this._adoptRtpc(findById(this.it.scenes, this.sceneId)); this._apply(this.syncTime('immediate'), 0.01); return this; };
  ICP.setScene = function (id, o) { var scene = findById(this.it.scenes, id); if (!scene) return this; o = o || {}; this.sceneId = id; this.overrides = {}; this._adoptRtpc(scene); this._apply(this.syncTime(o.sync), o.fadeSec != null ? o.fadeSec : this.it.transition.fadeSec); return this; };
  ICP.setChannel = function (id, on, o) { if (!findById(this.it.channels, id)) return this; o = o || {}; this.overrides[id] = !!on; this._apply(this.syncTime(o.sync), o.fadeSec != null ? o.fadeSec : this.it.transition.fadeSec); return this; };
  ICP.toggleChannel = function (id, o) { var c = findById(this.currentMix().channels, id); return this.setChannel(id, !(c && c.on), o); };
  ICP.setRTPC = function (param, val, o) { o = o || {}; this.rtpc[param] = +val; this._apply(this.syncTime(o.sync || 'immediate'), o.fadeSec != null ? o.fadeSec : this.it.transition.fadeSec); return this; };
  ICP.getScene = function () { return this.sceneId; };
  ICP.getMix = function () { return this.currentMix(); };
  ICP.getRTPC = function (param) { return param == null ? Object.assign({}, this.rtpc) : this.rtpc[param]; };
  ICP.listScenes = function () { return this.it.scenes.map(function (s) { return { id: s.id, name: s.name }; }); };
  ICP.listChannels = function () { return this.it.channels.map(function (c) { return { id: c.id, name: c.name, sources: c.sources.slice(), rtpc: c.rtpc, gain: c.gain }; }); };
  ICP.listStingers = function () { return (this.it.stingers || []).map(function (s) { return { id: s.id, name: s.name }; }); };
  // One-shot phrase over the running music, quantized to a sync boundary.
  ICP.triggerStinger = function (id, o) { var st = findById(this.it.stingers || [], id); if (!st) return this; o = o || {}; var at = this.syncTime(o.sync || st.sync); if (this.sink && this.sink.fireStinger) this.sink.fireStinger(id, at, o.gain != null ? o.gain : st.gain); return this; };
  // Live-edit a channel's RTPC response curve and re-apply the mix (for editors).
  ICP.setChannelCurve = function (channelId, curve, o) { var ch = findById(this.it.channels, channelId); if (!ch || !ch.rtpc) return this; ch.rtpc.curve = normalizeCurve(curve); o = o || {}; this._apply(this.syncTime(o.sync || 'immediate'), o.fadeSec != null ? o.fadeSec : this.it.transition.fadeSec); return this; };

  // ═══════════════════════════════════════════════════════════════════════
  return {
    // parse / validate
    parseArrangement: parseArrangement,
    validateArrangement: validateArrangement,
    isArrangement: isArrangement,
    coerceProject: coerceProject,
    defaultProject: defaultProject,
    // query
    getTimeline: getTimeline,
    getDurationSeconds: getDurationSeconds,
    getSongEvents: getSongEvents,
    getPatternEvents: getPatternEvents,
    getChordChart: getChordChart,
    summarize: summarize,
    patternById: patternById,
    // interactive music (Wwise-style)
    InteractiveMusicController: InteractiveMusicController,
    generateDefaultInteractive: generateDefaultInteractive,
    resolveScene: resolveScene,
    getChannelClip: getChannelClip,
    getStingerClip: getStingerClip,
    computeChannelGainDb: computeChannelGainDb,
    evalCurve: evalCurve,
    listChannels: listChannels,
    listScenes: listScenes,
    listStingers: listStingers,
    SYNC_MODES: SYNC_MODES.slice(),
    LAYER_NAMES: LAYER_NAMES.slice(),
    // MIDI export
    toMIDI: toMIDI,
    // music theory
    chordToMidi: chordToMidi,
    midiToNoteName: midiToNoteName,
    noteNameToPitchClass: noteNameToPitchClass,
    scaleSemitones: scaleSemitones,
    isInScale: isInScale,
    rateToSteps: rateToSteps,
    // constants
    STEPS_PER_BAR: STEPS_PER_BAR,
    NOTE_NAMES: NOTE_NAMES.slice(),
    CHORD_QUALITIES: CHORD_QUALITIES,
    SCALES: SCALES,
    DRUM_ROWS: DRUM_ROWS,
    DRUM_MACHINES: DRUM_MACHINES.slice(),
    FX_TYPES: FX_TYPES.slice(),
    SECTION_TYPES: SECTION_TYPES.slice(),
    SECTION_PRESET: SECTION_PRESET,
    RANGES: RANGE,
    VERSION: '1.0.0'
  };
});
