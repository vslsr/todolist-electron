/*
 * 电子音乐编曲器 (music-arranger)
 * ───────────────────────────────────────────────────────────────────────────
 * 引擎: Tone.js (全局 window.Tone, 由 vendor/tone.js 提供) —— 合成/母线/效果/调度/侧链
 * 采样: smplr (动态 import ./vendor/smplr.mjs) —— TR-808 等真实鼓机 + GM 音色
 * 五层: 节奏 Drums / 贝斯 Bass / 和声 Pad / 旋律 Melody / 音效 FX
 * 抽象层:
 *   片段 Pattern —— 五层循环内容 (可多个 A/B/C…)
 *   段落 Section —— 引用某片段 + 启用哪些层 + 动态(滤波/淡入淡出/自动Riser·Impact)
 *   歌曲 Song    —— 段落时间线 (前奏→主歌→铺垫→高潮→尾奏), 顺序播放成完整曲子
 * I/O: 项目状态 = 单个 JSON 对象, 支持导出(下载)与导入(文件), 兼容旧版(v1)。
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════
  //  常量与乐理
  // ═══════════════════════════════════════════════════════════════════════
  const STEPS_PER_BAR = 16;
  const CELL = 26;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midiToName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const isBlackKey = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

  const CHORD_QUALITIES = {
    maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
    '7': [0, 4, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6],
    aug: [0, 4, 8], add9: [0, 4, 7, 14], min9: [0, 3, 7, 10, 14], '6': [0, 4, 7, 9],
  };
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], 'penta-min': [0, 3, 5, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  const DRUM_ROWS = [
    { id: 'kick',  name: '底鼓 Kick',  color: '--kick',  sample: 'kick' },
    { id: 'snare', name: '军鼓 Snare', color: '--snare', sample: 'snare' },
    { id: 'clap',  name: '拍手 Clap',  color: '--clap',  sample: 'clap' },
    { id: 'chh',   name: '闭镲 CH',    color: '--hat',   sample: 'hihat-close' },
    { id: 'ohh',   name: '开镲 OH',    color: '--hat',   sample: 'hihat-open' },
    { id: 'perc',  name: '打击 Perc',  color: '--perc',  sample: 'tom' },
  ];
  const DRUM_MACHINES = ['TR-808', 'Casio-RZ1', 'LM-2', 'MFB-512', 'Roland CR-8000'];

  const BASS_INSTR = [
    { v: 'MonoSynth', t: 'MonoSynth（锯齿单音）' }, { v: 'FMSynth', t: 'FMSynth（金属感）' },
    { v: 'AMSynth', t: 'AMSynth' }, { v: 'DuoSynth', t: 'DuoSynth（厚实）' },
    { v: 'sf:synth_bass_1', t: '采样 · Synth Bass 1' }, { v: 'sf:synth_bass_2', t: '采样 · Synth Bass 2' },
    { v: 'sf:electric_bass_finger', t: '采样 · Electric Bass' }, { v: 'sf:acoustic_bass', t: '采样 · Acoustic Bass' },
  ];
  const MEL_INSTR = [
    { v: 'FMSynth', t: 'FMSynth（明亮 Lead）' }, { v: 'MonoSynth', t: 'MonoSynth' },
    { v: 'DuoSynth', t: 'DuoSynth' }, { v: 'AMSynth', t: 'AMSynth' },
    { v: 'sf:lead_1_square', t: '采样 · Square Lead' }, { v: 'sf:lead_2_sawtooth', t: '采样 · Saw Lead' },
    { v: 'sf:lead_8_bass__lead', t: '采样 · Bass+Lead' }, { v: 'sf:voice_oohs', t: '采样 · 人声 Oohs' },
    { v: 'sf:kalimba', t: '采样 · 拇指琴 Kalimba' }, { v: 'sf:music_box', t: '采样 · 八音盒 Music Box' },
    { v: 'sf:celesta', t: '采样 · 钢片琴 Celesta' }, { v: 'sf:glockenspiel', t: '采样 · 钟琴 Glockenspiel' },
    { v: 'sf:vibraphone', t: '采样 · 颤音琴 Vibraphone' }, { v: 'sf:marimba', t: '采样 · 马林巴 Marimba' },
  ];
  const HARM_INSTR = [
    { v: 'poly-saw', t: 'PolySynth（暖锯齿）' }, { v: 'poly-square', t: 'PolySynth（方波）' },
    { v: 'poly-sine', t: 'PolySynth（柔正弦）' },
    { v: 'sf:pad_2_warm', t: '采样 · Warm Pad' }, { v: 'sf:pad_1_new_age', t: '采样 · New Age Pad' },
    { v: 'sf:choir_aahs', t: '采样 · 人声合唱' }, { v: 'sf:string_ensemble_1', t: '采样 · 弦乐群' },
  ];
  const FX_TYPES = [
    { id: 'riser', name: 'Riser 上升', len: 16 }, { id: 'downlifter', name: 'Downlifter 下降', len: 16 },
    { id: 'impact', name: 'Impact 冲击', len: 2 }, { id: 'reverse', name: 'Reverse 反镲', len: 8 },
    { id: 'sweep', name: 'Filter 扫频', len: 16 },
  ];
  const FX_LABEL = { riser: '↗ Riser', downlifter: '↘ Down', impact: '✸ Impact', reverse: '◁ Rev', sweep: '～ Sweep' };

  // 歌曲段落类型 + 每种类型的默认(启用层 / 动态)。这是“上层抽象”的核心。
  const SECTION_TYPES = [
    { id: 'intro', name: '前奏 Intro' }, { id: 'verse', name: '主歌 Verse' },
    { id: 'build', name: '铺垫 Build' }, { id: 'drop', name: '高潮 Drop' },
    { id: 'break', name: '间奏 Break' }, { id: 'outro', name: '尾奏 Outro' },
  ];
  const SECTION_NAME = SECTION_TYPES.reduce((o, s) => ((o[s.id] = s.name), o), {});
  const SECTION_PRESET = {
    intro: { repeats: 2, layers: { drums: false, bass: false, harmony: true, melody: true, fx: false }, dyn: { filterFrom: 700, filterTo: 6000, fadeIn: true, fadeOut: false, autoRiser: false, autoImpact: false } },
    verse: { repeats: 4, layers: { drums: true, bass: true, harmony: true, melody: true, fx: false }, dyn: { filterFrom: 13000, filterTo: 14000, fadeIn: false, fadeOut: false, autoRiser: false, autoImpact: false } },
    build: { repeats: 2, layers: { drums: true, bass: true, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 2500, filterTo: 18000, fadeIn: false, fadeOut: false, autoRiser: true, autoImpact: false } },
    drop:  { repeats: 4, layers: { drums: true, bass: true, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 20000, filterTo: 20000, fadeIn: false, fadeOut: false, autoRiser: false, autoImpact: true } },
    break: { repeats: 2, layers: { drums: false, bass: false, harmony: true, melody: true, fx: true }, dyn: { filterFrom: 9000, filterTo: 9000, fadeIn: true, fadeOut: false, autoRiser: false, autoImpact: false } },
    outro: { repeats: 2, layers: { drums: true, bass: false, harmony: true, melody: false, fx: false }, dyn: { filterFrom: 12000, filterTo: 600, fadeIn: false, fadeOut: true, autoRiser: false, autoImpact: false } },
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  工具函数
  // ═══════════════════════════════════════════════════════════════════════
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const totalSteps = () => project.grid.bars * STEPS_PER_BAR;
  const deepClone = (o) => JSON.parse(JSON.stringify(o));
  const letter = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
  const bool = (v, d) => (v === undefined || v === null ? d : !!v);
  function resizeArr(arr, len, fill) { const a = arr.slice(0, len); while (a.length < len) a.push(fill); return a; }
  function cellCls(s) { return (s % 16) === 15 ? ' bar' : ((s % 4) === 3 ? ' beat' : ''); }
  function chordMidis(chord, octave) {
    const rootIdx = NOTE_NAMES.indexOf(chord.root);
    if (rootIdx < 0) return [];
    const base = 12 * (octave + 1) + rootIdx;
    return (CHORD_QUALITIES[chord.quality] || [0, 4, 7]).map((iv) => base + iv);
  }
  function rateToSteps(rate) { return ({ '16n': 1, '8n': 2, '4n': 4, '8t': 4 / 3 })[rate] || 1; }

  // ═══════════════════════════════════════════════════════════════════════
  //  数据模型 (= 导入/导出的 JSON, v2)
  // ═══════════════════════════════════════════════════════════════════════
  let patSeq = 1, secSeq = 1;

  // 每个片段的“启用层”(默认全开)。片段循环播放时逐层门控;整曲模式下再与段落的 layers 取 AND。
  const defaultEnabled = () => ({ drums: true, bass: true, harmony: true, melody: true, fx: true });
  const patEnabled = (pat) => (pat.enabled || (pat.enabled = defaultEnabled()));  // 自愈: 旧数据缺字段时补上
  const coerceEnabled = (e) => ({ drums: bool(e && e.drums, true), bass: bool(e && e.bass, true), harmony: bool(e && e.harmony, true), melody: bool(e && e.melody, true), fx: bool(e && e.fx, true) });

  function defaultLayers(bars) {
    const total = bars * STEPS_PER_BAR;
    return {
      drums: {
        engine: 'synth', machine: 'TR-808',
        tracks: DRUM_ROWS.map((r) => ({ id: r.id, name: r.name, color: r.color, sample: r.sample, steps: new Array(total).fill(0), gain: 0, mute: false, solo: false })),
      },
      bass: { instrument: 'MonoSynth', sidechain: { on: true, source: 'kick', amount: 0.7 }, notes: [] },
      harmony: { instrument: 'poly-saw', mode: 'pad', rate: '16n', octave: 4, reverb: 0.4, chorus: 0.2, chords: [] },
      melody: { instrument: 'FMSynth', key: 'C', scale: 'minor', reverb: 0.25, notes: [] },
      fx: { events: [] },
    };
  }
  function newPattern(name, dupPattern) {
    return {
      id: 'p' + (patSeq++), name: name,
      enabled: dupPattern ? deepClone(patEnabled(dupPattern)) : defaultEnabled(),
      layers: dupPattern ? deepClone(dupPattern.layers) : defaultLayers(project.grid.bars),
    };
  }
  function newSection(type) {
    const pre = SECTION_PRESET[type] || SECTION_PRESET.verse;
    return { id: 's' + (secSeq++), type, pattern: P().id, repeats: pre.repeats, layers: { ...pre.layers }, dyn: { ...pre.dyn } };
  }
  function defaultProject() {
    patSeq = 1; secSeq = 1;
    const grid = { bars: 2, stepsPerBar: STEPS_PER_BAR };
    const proj = {
      format: 'todo-music-arranger', version: 2,
      tempo: { bpm: 128, swing: 0 }, grid, master: { volume: -8, filter: 20000, reverb: 0.15 },
      activePattern: 0, patterns: [{ id: 'p' + (patSeq++), name: 'A', enabled: defaultEnabled(), layers: defaultLayers(grid.bars) }],
      playMode: 'pattern', song: { loop: true, sections: [] },
    };
    return proj;
  }

  // 校验单个 pattern 的 layers (容错缺字段)
  function coerceLayers(L, total) {
    const layers = defaultLayers(total / STEPS_PER_BAR);
    L = L || {};
    if (L.drums) {
      layers.drums.engine = L.drums.engine === 'sample' ? 'sample' : 'synth';
      if (DRUM_MACHINES.includes(L.drums.machine)) layers.drums.machine = L.drums.machine;
      if (Array.isArray(L.drums.tracks)) layers.drums.tracks.forEach((tr) => {
        const src = L.drums.tracks.find((x) => x && x.id === tr.id);
        if (src) {
          tr.steps = resizeArr((src.steps || []).map((v) => (v === 2 ? 2 : v ? 1 : 0)), total, 0);
          tr.mute = !!src.mute; tr.solo = !!src.solo; tr.gain = +src.gain || 0;
          if (typeof src.sample === 'string') tr.sample = src.sample;
        }
      });
    }
    if (L.bass) {
      if (typeof L.bass.instrument === 'string') layers.bass.instrument = L.bass.instrument;
      if (L.bass.sidechain) layers.bass.sidechain = { on: !!L.bass.sidechain.on, source: L.bass.sidechain.source || 'kick', amount: clamp(+L.bass.sidechain.amount || 0.7, 0, 1) };
      layers.bass.notes = cleanNotes(L.bass.notes, total, 12, 60);
    }
    if (L.harmony) {
      const h = L.harmony;
      if (typeof h.instrument === 'string') layers.harmony.instrument = h.instrument;
      if (['pad', 'arp', 'pluck'].includes(h.mode)) layers.harmony.mode = h.mode;
      if (h.rate) layers.harmony.rate = h.rate;
      layers.harmony.octave = clamp(+h.octave || 4, 1, 6);
      layers.harmony.reverb = clamp(h.reverb == null ? 0.4 : +h.reverb, 0, 1);
      layers.harmony.chorus = clamp(h.chorus == null ? 0.2 : +h.chorus, 0, 1);
    }
    if (L.melody) {
      if (typeof L.melody.instrument === 'string') layers.melody.instrument = L.melody.instrument;
      if (NOTE_NAMES.includes(L.melody.key)) layers.melody.key = L.melody.key;
      if (SCALES[L.melody.scale]) layers.melody.scale = L.melody.scale;
      layers.melody.reverb = clamp(L.melody.reverb == null ? 0.25 : +L.melody.reverb, 0, 1);
      layers.melody.notes = cleanNotes(L.melody.notes, total, 36, 96);
    }
    const bars = total / STEPS_PER_BAR;
    for (let b = 0; b < bars; b++) {
      const src = L.harmony && Array.isArray(L.harmony.chords) ? L.harmony.chords[b] : null;
      layers.harmony.chords[b] = (src && NOTE_NAMES.concat('—').includes(src.root))
        ? { root: src.root, quality: CHORD_QUALITIES[src.quality] ? src.quality : 'min7' } : { root: '—', quality: 'min7' };
    }
    if (L.fx && Array.isArray(L.fx.events)) {
      layers.fx.events = L.fx.events.filter((e) => e && FX_TYPES.some((t) => t.id === e.type))
        .map((e) => ({ type: e.type, step: clamp(+e.step || 0, 0, total - 1), len: clamp(+e.len || 4, 1, total) }));
    }
    return layers;
  }
  function cleanNotes(arr, total, lo, hi) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((n) => n && typeof n.step === 'number' && typeof n.midi === 'number')
      .map((n) => ({ step: clamp(n.step | 0, 0, total - 1), len: clamp(n.len | 0 || 1, 1, total), midi: clamp(n.midi | 0, lo, hi) }));
  }
  function coerceSection(s, patterns) {
    const type = SECTION_PRESET[s.type] ? s.type : 'verse';
    const pre = SECTION_PRESET[type];
    const patOk = patterns.some((p) => p.id === s.pattern);
    const dy = s.dyn || {};
    return {
      id: 's' + (secSeq++), type, pattern: patOk ? s.pattern : patterns[0].id, repeats: clamp(+s.repeats || pre.repeats, 1, 16),
      layers: { drums: bool(s.layers && s.layers.drums, pre.layers.drums), bass: bool(s.layers && s.layers.bass, pre.layers.bass), harmony: bool(s.layers && s.layers.harmony, pre.layers.harmony), melody: bool(s.layers && s.layers.melody, pre.layers.melody), fx: bool(s.layers && s.layers.fx, pre.layers.fx) },
      dyn: { filterFrom: clamp(+dy.filterFrom || pre.dyn.filterFrom, 100, 20000), filterTo: clamp(+dy.filterTo || pre.dyn.filterTo, 100, 20000), fadeIn: bool(dy.fadeIn, pre.dyn.fadeIn), fadeOut: bool(dy.fadeOut, pre.dyn.fadeOut), autoRiser: bool(dy.autoRiser, pre.dyn.autoRiser), autoImpact: bool(dy.autoImpact, pre.dyn.autoImpact) },
    };
  }
  function coerceProject(raw) {
    const p = defaultProject();
    if (!raw || typeof raw !== 'object') return p;
    if (raw.tempo) { p.tempo.bpm = clamp(+raw.tempo.bpm || 128, 40, 240); p.tempo.swing = clamp(+raw.tempo.swing || 0, 0, 80); }
    if (raw.grid && [1, 2, 4, 8].includes(+raw.grid.bars)) p.grid.bars = +raw.grid.bars;
    const total = p.grid.bars * STEPS_PER_BAR;
    if (raw.master) {
      p.master.volume = clamp(raw.master.volume == null ? -8 : +raw.master.volume, -40, 0);
      p.master.filter = clamp(+raw.master.filter || 20000, 100, 20000);
      p.master.reverb = clamp(+raw.master.reverb || 0.15, 0, 1);
    }
    patSeq = 1; secSeq = 1;
    const rawPats = (Array.isArray(raw.patterns) && raw.patterns.length) ? raw.patterns
      : (raw.layers ? [{ id: 'p1', name: 'A', layers: raw.layers }] : null);   // v1 兼容: 单 layers → pattern A
    if (rawPats) p.patterns = rawPats.map((rp, i) => ({ id: 'p' + (patSeq++), name: String(rp.name || letter(i)), enabled: coerceEnabled(rp.enabled), layers: coerceLayers(rp.layers, total) }));
    p.activePattern = clamp(+raw.activePattern || 0, 0, p.patterns.length - 1);
    // 段落引用旧 pattern id → 映射到新 id (按顺序)
    const idMap = {}; (rawPats || []).forEach((rp, i) => { if (rp && rp.id) idMap[rp.id] = p.patterns[i].id; });
    if (raw.song && Array.isArray(raw.song.sections)) {
      p.song.loop = raw.song.loop !== false;
      p.song.sections = raw.song.sections.filter((s) => s && SECTION_PRESET[s.type])
        .map((s) => coerceSection({ ...s, pattern: idMap[s.pattern] || s.pattern }, p.patterns));
    }
    if (raw.playMode === 'song') p.playMode = 'song';
    return p;
  }

  let project = defaultProject();
  const P = () => project.patterns[project.activePattern];
  const patternById = (id) => project.patterns.find((p) => p.id === id);
  const rolls = {};
  let activeDraw = null;
  let selSection = 0;

  // ═══════════════════════════════════════════════════════════════════════
  //  音频引擎 (Tone.js)
  // ═══════════════════════════════════════════════════════════════════════
  const A = {
    ready: false, playing: false, seq: null, playlines: [], songTL: null, curSeg: null, soundPattern: null,
    master: null, songGain: null, masterFilter: null, masterReverb: null, limiter: null,
    bus: {}, bassSidechain: null, harmChorus: null, harmReverb: null, melReverb: null,
    synth: {}, inst: {},
    smplrMod: null, storage: null, drumMachine: null, drumMachineName: null, drumMachineReady: false,
    drumMap: {}, sf: {}, drumIn: null, sfIn: {},
  };

  async function ensureAudio() {
    if (A.ready) return;
    await Tone.start();
    A.master = new Tone.Gain(Tone.dbToGain(project.master.volume));
    A.songGain = new Tone.Gain(1);                 // 段落级淡入淡出 (歌曲模式)
    A.masterFilter = new Tone.Filter(project.master.filter, 'lowpass');
    A.masterReverb = new Tone.Reverb({ decay: 2.6, wet: project.master.reverb });
    A.limiter = new Tone.Limiter(-1);
    A.master.connect(A.songGain); A.songGain.connect(A.masterFilter);
    A.masterFilter.connect(A.masterReverb); A.masterReverb.connect(A.limiter); A.limiter.toDestination();

    A.bus.drums = new Tone.Gain(1).connect(A.master);
    A.bassSidechain = new Tone.Gain(1).connect(A.master);
    A.bus.bass = A.bassSidechain;
    A.harmChorus = new Tone.Chorus(3.5, 2.5, 0.4).start();
    A.harmReverb = new Tone.Reverb({ decay: 3, wet: P().layers.harmony.reverb });
    A.bus.harmony = new Tone.Gain(1); A.bus.harmony.chain(A.harmChorus, A.harmReverb, A.master);
    A.harmChorus.wet.value = P().layers.harmony.chorus;
    A.melReverb = new Tone.Reverb({ decay: 2.5, wet: P().layers.melody.reverb });
    A.bus.melody = new Tone.Gain(1); A.bus.melody.chain(A.melReverb, A.master);
    A.bus.fx = new Tone.Gain(1).connect(A.master);

    buildDrumSynths();
    A.soundPattern = P();
    ['bass', 'melody', 'harmony'].forEach((l) => applyLayerInstrumentFor(P(), l));
    A.ready = true;
    setAudioStatus('ok', '音频已启动');
  }

  function buildDrumSynths() {
    const B = A.bus.drums;
    A.synth.kick = new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 7, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.18 } }).connect(B);
    const snF = new Tone.Filter(1900, 'bandpass'); snF.Q.value = 1.2; snF.connect(B);
    A.synth.snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(snF);
    const clF = new Tone.Filter(1200, 'bandpass'); clF.Q.value = 1.0; clF.connect(B);
    A.synth.clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.13, sustain: 0 } }).connect(clF);
    const chF = new Tone.Filter(9000, 'highpass'); chF.connect(B);
    A.synth.chh = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(chF);
    const ohF = new Tone.Filter(9000, 'highpass'); ohF.connect(B);
    A.synth.ohh = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.28, sustain: 0 } }).connect(ohF);
    A.synth.perc = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 4, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(B);
  }
  const DRUM_TRIGGER = {
    kick: (t, v) => A.synth.kick.triggerAttackRelease('C1', '8n', t, v),
    snare: (t, v) => A.synth.snare.triggerAttackRelease('8n', t, v),
    clap: (t, v) => A.synth.clap.triggerAttackRelease('8n', t, v),
    chh: (t, v) => A.synth.chh.triggerAttackRelease('32n', t, v * 0.8),
    ohh: (t, v) => A.synth.ohh.triggerAttackRelease('8n', t, v * 0.7),
    perc: (t, v) => A.synth.perc.triggerAttackRelease('A1', '16n', t, v),
  };

  const defaultKind = (layer) => ({ bass: 'MonoSynth', melody: 'FMSynth', harmony: 'poly-saw' }[layer]);
  const busForLayer = (layer) => A.bus[layer];
  function makeSynth(layer, kind) {
    if (layer === 'bass') {
      switch (kind) {
        case 'FMSynth': return new Tone.FMSynth({ volume: -6, harmonicity: 2, modulationIndex: 6, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 } });
        case 'AMSynth': return new Tone.AMSynth({ volume: -6, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } });
        case 'DuoSynth': return new Tone.DuoSynth({ volume: -10 });
        default: return new Tone.MonoSynth({ volume: -6, oscillator: { type: 'sawtooth' }, filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2.5 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 } });
      }
    }
    if (layer === 'melody') {
      const voice = { FMSynth: Tone.FMSynth, MonoSynth: Tone.MonoSynth, DuoSynth: Tone.DuoSynth, AMSynth: Tone.AMSynth }[kind] || Tone.FMSynth;
      return new Tone.PolySynth(voice, { volume: -9 });
    }
    const type = kind === 'poly-square' ? 'fatsquare' : kind === 'poly-sine' ? 'sine' : 'fatsawtooth';
    return new Tone.PolySynth(Tone.Synth, { volume: -13, oscillator: { type }, envelope: { attack: 0.4, decay: 0.4, sustain: 0.7, release: 1.4 } });
  }
  function setLayerSynth(layer, kind) {
    if (A.inst[layer]) safe(() => A.inst[layer].dispose());
    A.inst[layer] = makeSynth(layer, kind).connect(busForLayer(layer));
  }
  function applyLayerInstrumentFor(pattern, layer) {
    const v = pattern.layers[layer].instrument;
    if (v.startsWith('sf:')) { if (!A.inst[layer]) setLayerSynth(layer, defaultKind(layer)); loadSoundfont(v.slice(3), layer); }
    else setLayerSynth(layer, v);
  }
  const applyLayerInstrument = (layer) => applyLayerInstrumentFor(P(), layer);

  // 歌曲模式: 段落边界把引擎音色同步到该段引用的 pattern
  function syncSound(pattern) {
    if (!A.ready || !pattern) return;
    const prev = A.soundPattern; A.soundPattern = pattern;
    ['bass', 'melody', 'harmony'].forEach((layer) => {
      const now = pattern.layers[layer].instrument;
      const was = prev && prev.layers[layer].instrument;
      if (now !== was || !A.inst[layer]) applyLayerInstrumentFor(pattern, layer);
    });
    if (A.harmReverb) A.harmReverb.wet.value = pattern.layers.harmony.reverb;
    if (A.harmChorus) A.harmChorus.wet.value = pattern.layers.harmony.chorus;
    if (A.melReverb) A.melReverb.wet.value = pattern.layers.melody.reverb;
    const d = pattern.layers.drums;
    if (d.engine === 'sample' && (!A.drumMachineReady || A.drumMachineName !== d.machine)) loadDrumMachine(d.machine);
  }

  // ── smplr 采样懒加载 ────────────────────────────────────────────────────
  async function ensureSmplr() {
    if (A.smplrMod) return A.smplrMod;
    setLoad('加载 smplr 采样引擎…');
    A.smplrMod = await import('./vendor/smplr.mjs');
    A.storage = safe(() => new A.smplrMod.CacheStorage(), null);
    setLoad('');
    return A.smplrMod;
  }
  function smplrEntry(bus) { const g = Tone.getContext().rawContext.createGain(); safe(() => Tone.connect(g, bus)); return g; }
  async function loadDrumMachine(name) {
    let smplr;
    try { smplr = await ensureSmplr(); } catch (e) { toast('无法加载采样引擎(需联网)'); fallbackDrums(); return; }
    if (A.drumMachine && A.drumMachineName === name && A.drumMachineReady) return;
    A.drumMachineReady = false; setLoad('加载鼓机 ' + name + ' …');
    try {
      const ctx = Tone.getContext().rawContext;
      if (!A.drumIn) A.drumIn = smplrEntry(A.bus.drums);
      if (A.drumMachine) safe(() => A.drumMachine.disconnect());
      const dm = new smplr.DrumMachine(ctx, { instrument: name, destination: A.drumIn, storage: A.storage || undefined });
      await dm.load;
      A.drumMachine = dm; A.drumMachineName = name; A.drumMachineReady = true;
      remapDrumSamples(dm); setLoad(''); toast('鼓机已加载: ' + name);
    } catch (e) { setLoad(''); toast('鼓机加载失败,已回退合成音'); fallbackDrums(); }
  }
  function fallbackDrums() {
    P().layers.drums.engine = 'synth';
    if ($('drum-engine')) { $('drum-engine').value = 'synth'; $('drum-kit').disabled = true; $('drum-src-info').textContent = 'MembraneSynth / NoiseSynth'; }
  }
  function remapDrumSamples(dm) {
    const groups = (safe(() => dm.getGroupNames(), []) || []).map((g) => ({ g, l: String(g).toLowerCase() }));
    const names = (safe(() => dm.getSampleNames(), []) || []).map((g) => ({ g, l: String(g).toLowerCase() }));
    const pool = groups.length ? groups : names;
    const KW = { kick: ['kick', 'bass', 'bd'], snare: ['snare', 'sd', 'rim'], clap: ['clap', 'cp', 'hand'], chh: ['closed', 'hihat-close', 'chh', 'hh', 'hat'], ohh: ['open', 'hihat-open', 'ohh', 'oh'], perc: ['tom', 'conga', 'perc', 'cowbell', 'clave', 'cymbal', 'crash'] };
    A.drumMap = {};
    P().layers.drums.tracks.forEach((tr) => {
      if (pool.some((x) => x.l === String(tr.sample).toLowerCase())) { A.drumMap[tr.id] = tr.sample; return; }
      const kw = KW[tr.id] || [tr.id];
      const hit = pool.find((x) => kw.some((k) => x.l.includes(k)));
      A.drumMap[tr.id] = hit ? hit.g : (pool[0] && pool[0].g) || tr.sample;
    });
  }
  async function loadSoundfont(name, layer) {
    let smplr;
    try { smplr = await ensureSmplr(); } catch (e) { toast('无法加载采样引擎(需联网),使用合成音'); return; }
    if (A.sf[name] && A.sf[name]._ready) return A.sf[name];
    setLoad('加载音色 ' + name + ' …');
    try {
      const ctx = Tone.getContext().rawContext;
      if (!A.sfIn[layer]) A.sfIn[layer] = smplrEntry(busForLayer(layer));
      const sf = new smplr.Soundfont(ctx, { instrument: name, destination: A.sfIn[layer], storage: A.storage || undefined });
      await sf.load; sf._ready = true;
      A.sf[name] = sf; setLoad(''); toast('音色已加载: ' + name);
      return sf;
    } catch (e) { setLoad(''); toast('音色加载失败,回退合成: ' + name); return null; }
  }

  // 依据传入 pattern 的乐器设定发声 (sf 优先, 失败回退合成)
  function playMelodic(layer, pat, midi, dur, time, vel) {
    const v = pat.layers[layer].instrument;
    if (v.startsWith('sf:')) {
      const sf = A.sf[v.slice(3)];
      if (sf && sf._ready && safe(() => (sf.start({ note: midi, time, duration: dur, velocity: Math.round(vel * 110) }), true))) return;
    }
    const synth = A.inst[layer];
    if (synth) safe(() => synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toNote(), dur, time, vel));
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  触发器 (按 pattern + 是否启用)
  // ═══════════════════════════════════════════════════════════════════════
  const stepSec = () => Tone.Time('16n').toSeconds();
  function duckBass(pat, time) {
    if (!A.bassSidechain) return;
    const amt = pat.layers.bass.sidechain.amount, g = A.bassSidechain.gain;
    g.cancelScheduledValues(time); g.setValueAtTime(Math.max(0.0001, 1 - amt), time); g.linearRampToValueAtTime(1, time + 0.19);
  }
  function triggerDrums(pat, time, step, on) {
    const L = pat.layers.drums, anySolo = L.tracks.some((t) => t.solo), sc = pat.layers.bass.sidechain;
    L.tracks.forEach((row) => {
      const v = row.steps[step]; if (!v) return;
      if (on && sc.on && row.id === sc.source) duckBass(pat, time);
      if (!on || row.mute || (anySolo && !row.solo)) return;
      const vel = (v === 2 ? 1.0 : 0.78) * Tone.dbToGain(row.gain || 0);
      if (L.engine === 'sample' && A.drumMachineReady) safe(() => A.drumMachine.start({ note: A.drumMap[row.id] || row.sample, time, velocity: Math.round(clamp(vel, 0, 1) * 110) }));
      else { const fn = DRUM_TRIGGER[row.id]; if (fn) fn(time, clamp(vel, 0, 1.2)); }
    });
  }
  function triggerBass(pat, time, step, on) { if (!on) return; pat.layers.bass.notes.forEach((n) => { if (n.step === step) playMelodic('bass', pat, n.midi, n.len * stepSec(), time, 0.9); }); }
  function triggerMelody(pat, time, step, on) { if (!on) return; pat.layers.melody.notes.forEach((n) => { if (n.step === step) playMelodic('melody', pat, n.midi, n.len * stepSec(), time, 0.85); }); }
  function triggerHarmony(pat, time, step, on) {
    if (!on) return;
    const L = pat.layers.harmony, bar = Math.floor(step / STEPS_PER_BAR), inBar = step % STEPS_PER_BAR, chord = L.chords[bar];
    if (!chord || chord.root === '—') return;
    const notes = chordMidis(chord, L.octave); if (!notes.length) return;
    const ss = stepSec();
    if (L.mode === 'pad') { if (inBar === 0) notes.forEach((m) => playMelodic('harmony', pat, m, STEPS_PER_BAR * ss * 0.98, time, 0.5)); }
    else if (L.mode === 'pluck') { if (inBar % 4 === 0) notes.forEach((m) => playMelodic('harmony', pat, m, ss * 2, time, 0.6)); }
    else { const rs = Math.max(1, Math.round(rateToSteps(L.rate))); if (step % rs === 0) { const ai = Math.floor(step / rs) % notes.length; playMelodic('harmony', pat, notes[ai], ss * rs * 0.9, time, 0.62); } }
  }
  function triggerFxEvents(pat, time, step, on) { if (!on) return; pat.layers.fx.events.forEach((ev) => { if (ev.step === step) fireFx(ev, time); }); }

  function disposeLater(nodes, atTime) { const ms = Math.max(0, atTime - Tone.now()) * 1000 + 250; setTimeout(() => nodes.forEach((n) => safe(() => n.dispose())), ms); }
  function fireFx(ev, time) {
    const dur = Math.max(1, ev.len) * stepSec();
    if (ev.type === 'impact') {
      const m = new Tone.MembraneSynth({ pitchDecay: 0.2, octaves: 8, envelope: { attack: 0.001, decay: 0.6, sustain: 0 } }).connect(A.bus.fx);
      const n = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.4, sustain: 0 } }).connect(A.bus.fx);
      m.triggerAttackRelease('C1', '2n', time, 1); n.triggerAttackRelease('4n', time, 0.7);
      disposeLater([m, n], time + 1.2);
    } else if (ev.type === 'riser' || ev.type === 'downlifter') {
      const up = ev.type === 'riser';
      const noise = new Tone.Noise('white').start(time);
      const filt = new Tone.Filter(up ? 400 : 8000, 'bandpass'); filt.Q.value = 2;
      const g = new Tone.Gain(0).connect(A.bus.fx);
      noise.connect(filt); filt.connect(g);
      filt.frequency.setValueAtTime(up ? 400 : 8000, time);
      filt.frequency.exponentialRampToValueAtTime(up ? 9000 : 300, time + dur);
      g.gain.setValueAtTime(up ? 0.02 : 0.3, time); g.gain.linearRampToValueAtTime(up ? 0.32 : 0.02, time + dur); g.gain.linearRampToValueAtTime(0, time + dur + 0.05);
      noise.stop(time + dur + 0.06); disposeLater([noise, filt, g], time + dur + 0.2);
    } else if (ev.type === 'reverse') {
      const noise = new Tone.Noise('pink').start(time);
      const filt = new Tone.Filter(6000, 'highpass');
      const g = new Tone.Gain(0.0001).connect(A.bus.fx);
      noise.connect(filt); filt.connect(g);
      g.gain.exponentialRampToValueAtTime(0.42, time + dur); g.gain.linearRampToValueAtTime(0, time + dur + 0.03);
      noise.stop(time + dur + 0.05); disposeLater([noise, filt, g], time + dur + 0.2);
    } else if (ev.type === 'sweep') {
      const f = A.masterFilter.frequency;
      f.cancelScheduledValues(time); f.setValueAtTime(project.master.filter, time);
      f.exponentialRampToValueAtTime(500, time + dur * 0.5); f.exponentialRampToValueAtTime(project.master.filter, time + dur);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  调度: 片段循环 / 整首歌曲
  // ═══════════════════════════════════════════════════════════════════════
  function disposeSeq() { if (A.seq) { safe(() => A.seq.dispose()); A.seq = null; } }
  function buildPatternSequence() {
    disposeSeq();
    const idx = Array.from({ length: totalSteps() }, (_, i) => i);
    A.seq = new Tone.Sequence((time, step) => {
      Tone.Draw.schedule(() => updatePlayhead(step), time);
      const pat = P(), en = patEnabled(pat);
      triggerDrums(pat, time, step, en.drums); triggerBass(pat, time, step, en.bass);
      triggerHarmony(pat, time, step, en.harmony); triggerMelody(pat, time, step, en.melody);
      triggerFxEvents(pat, time, step, en.fx);
    }, idx, '16n');
    A.seq.loop = true; A.seq.start(0);
  }
  function songTimeline() {
    const list = []; let bar = 0;
    project.song.sections.forEach((sec) => {
      const pat = patternById(sec.pattern) || project.patterns[0];
      const bars = Math.max(1, sec.repeats) * project.grid.bars;
      list.push({ sec, pat, startBar: bar, bars }); bar += bars;
    });
    return { list, totalBars: bar };
  }
  function buildSongSequence() {
    disposeSeq();
    const tl = songTimeline(); A.songTL = tl;
    if (!tl.totalBars) { toast('歌曲结构为空 — 请在“结构”标签添加段落'); return false; }
    const idx = Array.from({ length: tl.totalBars * STEPS_PER_BAR }, (_, i) => i);
    A.seq = new Tone.Sequence((time, g) => {
      const gbar = Math.floor(g / STEPS_PER_BAR);
      const seg = tl.list.find((s) => gbar >= s.startBar && gbar < s.startBar + s.bars);
      if (!seg) return;
      if (!A.curSeg || A.curSeg.sec.id !== seg.sec.id) { A.curSeg = seg; syncSound(seg.pat); applySectionDynamics(seg, time); }
      const localStep = ((gbar - seg.startBar) % project.grid.bars) * STEPS_PER_BAR + (g % STEPS_PER_BAR);
      const La = seg.sec.layers, pat = seg.pat, en = patEnabled(pat);
      triggerDrums(pat, time, localStep, La.drums && en.drums); triggerBass(pat, time, localStep, La.bass && en.bass);
      triggerHarmony(pat, time, localStep, La.harmony && en.harmony); triggerMelody(pat, time, localStep, La.melody && en.melody);
      triggerFxEvents(pat, time, localStep, La.fx && en.fx);
      Tone.Draw.schedule(() => { updateSongPlayhead(g); if (seg.pat === P()) updatePlayhead(localStep); else hidePlayhead(); }, time);
    }, idx, '16n');
    A.seq.loop = project.song.loop; A.seq.start(0);
    return true;
  }
  function applySectionDynamics(seg, time) {
    const secDur = seg.bars * STEPS_PER_BAR * stepSec(), dyn = seg.sec.dyn, barSec = STEPS_PER_BAR * stepSec();
    if (A.masterFilter) {
      const f = A.masterFilter.frequency; f.cancelScheduledValues(time);
      f.setValueAtTime(clamp(dyn.filterFrom, 100, 20000), time);
      f.exponentialRampToValueAtTime(clamp(dyn.filterTo, 100, 20000), time + secDur);
    }
    if (A.songGain) {
      const g = A.songGain.gain; g.cancelScheduledValues(time);
      if (dyn.fadeIn) { g.setValueAtTime(0.0001, time); g.linearRampToValueAtTime(1, time + Math.min(secDur, barSec * 2)); }
      else g.setValueAtTime(1, time);
      if (dyn.fadeOut) { g.setValueAtTime(1, Math.max(time, time + secDur - barSec * 2)); g.linearRampToValueAtTime(0.0001, time + secDur); }
    }
    if (dyn.autoImpact) fireFx({ type: 'impact', len: 2 }, time);
    if (dyn.autoRiser) fireFx({ type: 'riser', len: STEPS_PER_BAR }, time + secDur - STEPS_PER_BAR * stepSec());
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  播放控制
  // ═══════════════════════════════════════════════════════════════════════
  async function play() {
    try { await ensureAudio(); } catch (e) { setAudioStatus('err', '音频启动失败'); return; }
    applyGlobals(); A.curSeg = null;
    if (project.playMode === 'song') {
      A.soundPattern = null;
      if (!buildSongSequence()) return;
    } else {
      syncSound(P());
      if (P().layers.drums.engine === 'sample' && !A.drumMachineReady) loadDrumMachine(P().layers.drums.machine);
      buildPatternSequence();
    }
    Tone.Transport.start();
    A.playing = true; setPlayUI(true);
  }
  function stop() {
    safe(() => Tone.Transport.stop()); safe(() => Tone.Transport.cancel()); Tone.Transport.position = 0;
    disposeSeq();
    if (A.bassSidechain) { safe(() => A.bassSidechain.gain.cancelScheduledValues(Tone.now())); A.bassSidechain.gain.value = 1; }
    if (A.songGain) { safe(() => A.songGain.gain.cancelScheduledValues(Tone.now())); A.songGain.gain.value = 1; }
    if (A.masterFilter) { safe(() => A.masterFilter.frequency.cancelScheduledValues(Tone.now())); safe(() => A.masterFilter.frequency.setValueAtTime(project.master.filter, Tone.now())); }
    A.curSeg = null; A.playing = false; setPlayUI(false); hidePlayhead(); clearSongPlayhead();
  }
  function togglePlay() { A.playing ? stop() : play(); }
  function applyGlobals() {
    Tone.Transport.bpm.value = project.tempo.bpm;
    Tone.Transport.swing = project.tempo.swing / 100; Tone.Transport.swingSubdivision = '16n';
    if (A.master) A.master.gain.rampTo(Tone.dbToGain(project.master.volume), 0.05);
    if (A.masterFilter) A.masterFilter.frequency.rampTo(project.master.filter, 0.05);
    if (A.masterReverb) A.masterReverb.wet.rampTo(project.master.reverb, 0.05);
    if (A.harmReverb) A.harmReverb.wet.value = P().layers.harmony.reverb;
    if (A.harmChorus) A.harmChorus.wet.value = P().layers.harmony.chorus;
    if (A.melReverb) A.melReverb.wet.value = P().layers.melody.reverb;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  播放头
  // ═══════════════════════════════════════════════════════════════════════
  function addPlayline(wrap, headW) {
    A.playlines = A.playlines.filter((p) => p.el.isConnected);
    const pl = document.createElement('div'); pl.className = 'playline';
    wrap.appendChild(pl); A.playlines.push({ el: pl, head: headW }); return pl;
  }
  function updatePlayhead(step) { A.playlines.forEach((p) => { p.el.style.display = 'block'; p.el.style.left = (p.head + (step + 0.5) * CELL) + 'px'; }); }
  function hidePlayhead() { A.playlines.forEach((p) => (p.el.style.display = 'none')); }
  function updateSongPlayhead(g) {
    if (!A.songTL) return;
    const gbar = Math.floor(g / STEPS_PER_BAR);
    const idx = A.songTL.list.findIndex((s) => gbar >= s.startBar && gbar < s.startBar + s.bars);
    document.querySelectorAll('#song-timeline .song-block').forEach((el, i) => el.classList.toggle('playing', i === idx));
    const seg = A.songTL.list[idx];
    if (seg) $('song-now').textContent = '播放中 ▸ ' + SECTION_NAME[seg.sec.type] + ' (' + (gbar - seg.startBar + 1) + '/' + seg.bars + ' 小节)';
  }
  function clearSongPlayhead() { document.querySelectorAll('#song-timeline .song-block').forEach((el) => el.classList.remove('playing')); if ($('song-now')) $('song-now').textContent = ''; }

  // ═══════════════════════════════════════════════════════════════════════
  //  UI —— 时间轴通用件
  // ═══════════════════════════════════════════════════════════════════════
  function buildRuler(headW) {
    const r = document.createElement('div'); r.className = 'ruler';
    const sp = document.createElement('div'); sp.style.flex = '0 0 ' + headW + 'px'; r.appendChild(sp);
    for (let b = 0; b < project.grid.bars; b++) { const bm = document.createElement('div'); bm.className = 'barmark'; bm.style.flex = '0 0 ' + (16 * CELL) + 'px'; bm.textContent = '小节 ' + (b + 1); r.appendChild(bm); }
    return r;
  }
  function selectOf(arr, cur) {
    const s = document.createElement('select');
    arr.forEach((o) => { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; if (o.v === cur) op.selected = true; s.appendChild(op); });
    return s;
  }
  function fillSelect(el, arr, cur) { el.innerHTML = ''; arr.forEach((o) => { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; if (o.v === cur) op.selected = true; el.appendChild(op); }); }

  // ── 1. 鼓步进网格 ───────────────────────────────────────────────────────
  function buildDrumGrid() {
    const wrap = $('drum-grid'); wrap.innerHTML = ''; const HEAD = 168, total = totalSteps();
    wrap.appendChild(buildRuler(HEAD));
    P().layers.drums.tracks.forEach((track) => {
      const row = document.createElement('div'); row.className = 'drum-row';
      const head = document.createElement('div'); head.className = 'drum-head';
      const solo = miniBtn('S', 'solo', track.solo, () => { track.solo = !track.solo; solo.classList.toggle('act', track.solo); });
      const mute = miniBtn('M', 'mute', track.mute, () => { track.mute = !track.mute; mute.classList.toggle('act', track.mute); });
      const name = document.createElement('div'); name.className = 'drum-name'; name.textContent = track.name;
      head.append(solo, mute, name);
      const steps = document.createElement('div'); steps.className = 'steps';
      for (let s = 0; s < total; s++) {
        const c = document.createElement('div'); c.className = 'cell' + cellCls(s);
        c.style.setProperty('--rowc', 'var(' + track.color + ')');
        const v = track.steps[s]; if (v) { c.classList.add('on'); if (v === 2) c.classList.add('accent'); }
        const pad = document.createElement('div'); pad.className = 'pad'; c.appendChild(pad);
        c.addEventListener('mousedown', (e) => {
          e.preventDefault();
          track.steps[s] = e.shiftKey ? (track.steps[s] === 2 ? 0 : 2) : (track.steps[s] ? 0 : 1);
          const val = track.steps[s]; c.classList.toggle('on', !!val); c.classList.toggle('accent', val === 2);
        });
        steps.appendChild(c);
      }
      row.append(head, steps); wrap.appendChild(row);
    });
    addPlayline(wrap, HEAD);
  }
  function miniBtn(label, cls, active, onclick) { const b = document.createElement('button'); b.className = 'mini ' + cls + (active ? ' act' : ''); b.textContent = label; b.title = cls === 'solo' ? '独奏' : '静音'; b.onclick = onclick; return b; }

  // ── 2 & 4. 钢琴卷帘 ─────────────────────────────────────────────────────
  function makeRoll(wrap, layer, lowMidi, highMidi) {
    wrap.innerHTML = ''; const HEAD = 46, total = totalSteps();
    wrap.appendChild(buildRuler(HEAD));
    const laneMap = {}, body = document.createElement('div'), mel = layer === 'melody';
    const rootIdx = mel ? NOTE_NAMES.indexOf(P().layers.melody.key) : 0, scale = mel ? SCALES[P().layers.melody.scale] : null;
    for (let m = highMidi; m >= lowMidi; m--) {
      const prow = document.createElement('div'); prow.className = 'prow' + (isBlackKey(m) ? ' black' : '');
      if (mel) { const deg = (((m - rootIdx) % 12) + 12) % 12; if (scale.includes(deg)) prow.classList.add('inscale'); if (deg === 0) prow.classList.add('root'); }
      const kl = document.createElement('div'); kl.className = 'keylabel'; kl.textContent = midiToName(m);
      const lane = document.createElement('div'); lane.className = 'lane'; lane.dataset.midi = m;
      for (let s = 0; s < total; s++) { const c = document.createElement('div'); c.className = 'pcell' + cellCls(s); lane.appendChild(c); }
      prow.append(kl, lane); body.appendChild(prow); laneMap[m] = lane;
    }
    wrap.appendChild(body); addPlayline(wrap, HEAD);
    const notesRef = () => P().layers[layer].notes;
    function repaint() {
      Object.values(laneMap).forEach((l) => l.querySelectorAll('.note').forEach((n) => n.remove()));
      notesRef().forEach((n, i) => {
        const lane = laneMap[n.midi]; if (!lane) return;
        const el = document.createElement('div'); el.className = 'note' + (mel ? ' melodyc' : '');
        el.style.left = (n.step * CELL) + 'px'; el.style.width = (Math.max(1, n.len) * CELL - 2) + 'px'; el.dataset.i = i; lane.appendChild(el);
      });
    }
    repaint();
    body.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const lane = e.target.closest('.lane'); if (!lane) return;
      e.preventDefault();
      if (e.target.classList.contains('note')) { notesRef().splice(+e.target.dataset.i, 1); repaint(); return; }
      const midi = +lane.dataset.midi;
      const step = clamp(Math.floor((e.clientX - lane.getBoundingClientRect().left) / CELL), 0, total - 1);
      const note = { step, len: 1, midi }; notesRef().push(note); repaint();
      activeDraw = { note, startStep: step, lane, total, repaint };
    });
    return { repaint };
  }

  // ── 3. 和弦轨 ───────────────────────────────────────────────────────────
  function buildChordTrack() {
    const el = $('chord-track'); el.innerHTML = ''; const chords = P().layers.harmony.chords;
    for (let b = 0; b < project.grid.bars; b++) {
      if (!chords[b]) chords[b] = { root: '—', quality: 'min7' };
      const c = chords[b];
      const slot = document.createElement('div'); slot.className = 'chord-slot';
      const no = document.createElement('div'); no.className = 'bar-no'; no.textContent = '小节 ' + (b + 1);
      const root = selectOf(['—', ...NOTE_NAMES].map((n) => ({ v: n, t: n })), c.root);
      const qual = selectOf(Object.keys(CHORD_QUALITIES).map((q) => ({ v: q, t: q })), c.quality);
      const prev = document.createElement('div'); prev.className = 'preview';
      const upd = () => { prev.textContent = c.root === '—' ? '（静音）' : chordMidis(c, P().layers.harmony.octave).map(midiToName).join(' '); };
      root.onchange = () => { c.root = root.value; upd(); }; qual.onchange = () => { c.quality = qual.value; upd(); };
      upd(); slot.append(no, root, qual, prev); el.appendChild(slot);
    }
  }

  // ── 5. FX 事件轨 ────────────────────────────────────────────────────────
  function buildFxGrid() {
    const wrap = $('fx-grid'); wrap.innerHTML = ''; const HEAD = 110, total = totalSteps();
    wrap.appendChild(buildRuler(HEAD));
    const rows = document.createElement('div'); rows.className = 'fx-lane-rows'; const trackByType = {};
    FX_TYPES.forEach((t) => {
      const lane = document.createElement('div'); lane.className = 'fx-lane';
      const h = document.createElement('div'); h.className = 'lane-head'; h.textContent = t.name;
      const track = document.createElement('div'); track.className = 'fx-track'; trackByType[t.id] = track;
      track.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('fx-event')) { P().layers.fx.events.splice(+e.target.dataset.i, 1); buildFxGrid(); return; }
        const step = clamp(Math.round((e.clientX - track.getBoundingClientRect().left) / CELL / 4) * 4, 0, total - 1);
        P().layers.fx.events.push({ type: t.id, step, len: t.len }); buildFxGrid();
      });
      lane.append(h, track); rows.appendChild(lane);
    });
    wrap.appendChild(rows);
    P().layers.fx.events.forEach((ev, i) => {
      const track = trackByType[ev.type]; if (!track) return;
      const el = document.createElement('div'); el.className = 'fx-event ' + ev.type; el.dataset.i = i;
      el.style.left = (ev.step * CELL) + 'px'; el.style.width = (Math.max(1, ev.len) * CELL - 2) + 'px'; el.textContent = FX_LABEL[ev.type]; track.appendChild(el);
    });
    addPlayline(wrap, HEAD);
  }

  // ── 片段栏 (Pattern A/B/C…) ─────────────────────────────────────────────
  function buildPatternBar() {
    const box = $('pat-chips'); box.innerHTML = '';
    project.patterns.forEach((pat, i) => {
      const chip = document.createElement('button'); chip.className = 'pat-chip' + (i === project.activePattern ? ' active' : '');
      chip.textContent = pat.name; chip.title = '单击切换 · 双击重命名';
      chip.onclick = () => { if (i !== project.activePattern) setActivePattern(i); };
      chip.ondblclick = () => renamePattern(i, chip);
      box.appendChild(chip);
    });
    buildLayerToggles();
  }
  // 当前片段的“启用层”开关: 片段循环时逐层发声/静音, 即改即听 (序列每步读 P().enabled)
  function buildLayerToggles() {
    const box = $('lay-toggles'); if (!box) return; box.innerHTML = '';
    const en = patEnabled(P());
    LAYER_DOTS.forEach(([k, zh]) => {
      const b = document.createElement('button');
      b.className = 'lay-tog' + (en[k] ? ' on' : '');
      b.textContent = zh; b.title = '片段循环时该层' + (en[k] ? '发声(点击静音)' : '静音(点击启用)');
      b.onclick = () => { en[k] = !en[k]; b.classList.toggle('on', en[k]); b.title = '片段循环时该层' + (en[k] ? '发声(点击静音)' : '静音(点击启用)'); };
      box.appendChild(b);
    });
  }
  function renamePattern(i, chip) {
    const inp = document.createElement('input'); inp.className = 'pat-rename'; inp.value = project.patterns[i].name; inp.maxLength = 12;
    chip.replaceWith(inp); inp.focus(); inp.select();
    const done = () => { const v = inp.value.trim(); if (v) project.patterns[i].name = v; buildPatternBar(); buildSongTimeline(); buildSectionEditor(); };
    inp.onblur = done; inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') buildPatternBar(); };
  }
  function setActivePattern(i) { project.activePattern = clamp(i, 0, project.patterns.length - 1); onPatternSwitched(); }
  function onPatternSwitched() { syncControlsFromModel(); rebuildAll(); if (A.ready) { A.soundPattern = P(); ['bass', 'melody', 'harmony'].forEach((l) => applyLayerInstrumentFor(P(), l)); if (P().layers.drums.engine === 'sample') loadDrumMachine(P().layers.drums.machine); } }
  function addPattern(dup) {
    const np = newPattern(letter(project.patterns.length), dup ? P() : null);
    project.patterns.push(np); project.activePattern = project.patterns.length - 1; onPatternSwitched(); toast(dup ? '已复制片段 ' + np.name : '已新建片段 ' + np.name);
  }
  function deletePattern() {
    if (project.patterns.length <= 1) { toast('至少保留一个片段'); return; }
    const removed = project.patterns.splice(project.activePattern, 1)[0];
    project.song.sections.forEach((s) => { if (s.pattern === removed.id) s.pattern = project.patterns[0].id; });
    project.activePattern = clamp(project.activePattern, 0, project.patterns.length - 1); onPatternSwitched();
  }

  // ── 歌曲结构 (段落时间线 + 段落编辑器) ──────────────────────────────────
  const LAYER_DOTS = [['drums', '鼓'], ['bass', '贝'], ['harmony', '和'], ['melody', '旋'], ['fx', '效']];
  function songTotalBars() { return project.song.sections.reduce((a, s) => a + Math.max(1, s.repeats) * project.grid.bars, 0); }
  function buildSongPanel() { buildSongTimeline(); buildSectionEditor(); updateSongMeta(); }
  function buildSongTimeline() {
    const tl = $('song-timeline'); if (!tl) return; tl.innerHTML = '';
    if (!project.song.sections.length) { tl.innerHTML = '<div class="song-empty">还没有段落 —— 用下方“添加段落”从前奏开始搭建，或点顶部“示例”载入一首完整曲子。</div>'; return; }
    project.song.sections.forEach((sec, i) => {
      const bars = Math.max(1, sec.repeats) * project.grid.bars;
      const blk = document.createElement('div'); blk.className = 'song-block ' + sec.type + (i === selSection ? ' sel' : '');
      blk.style.width = clamp(bars * 15, 96, 300) + 'px';
      const pat = patternById(sec.pattern);
      const dots = LAYER_DOTS.map(([k]) => '<span class="ld ' + (sec.layers[k] ? 'on' : '') + '"></span>').join('');
      blk.innerHTML = '<div class="sb-type">' + SECTION_NAME[sec.type] + '</div><div class="sb-meta">' + (pat ? pat.name : '?') + ' · ×' + sec.repeats + ' · ' + bars + '小节</div><div class="sb-dots">' + dots + '</div>';
      blk.onclick = () => { selSection = i; buildSongTimeline(); buildSectionEditor(); };
      tl.appendChild(blk);
    });
  }
  function buildSectionEditor() {
    const box = $('sec-editor'); if (!box) return; box.innerHTML = '';
    const secs = project.song.sections;
    if (!secs.length) { box.innerHTML = '<div class="hint">选中一个段落后在此编辑它的类型、片段、时长、启用层与动态。</div>'; return; }
    selSection = clamp(selSection, 0, secs.length - 1);
    const sec = secs[selSection];
    const row1 = document.createElement('div'); row1.className = 'row';
    const typeSel = selectOf(SECTION_TYPES.map((t) => ({ v: t.id, t: t.name })), sec.type);
    typeSel.onchange = () => { applySectionType(sec, typeSel.value); buildSongPanel(); };
    const patSel = selectOf(project.patterns.map((p) => ({ v: p.id, t: '片段 ' + p.name })), sec.pattern);
    patSel.onchange = () => { sec.pattern = patSel.value; buildSongPanel(); };
    const rep = document.createElement('input'); rep.type = 'number'; rep.min = 1; rep.max = 16; rep.value = sec.repeats; rep.style.width = '52px';
    rep.onchange = () => { sec.repeats = clamp(+rep.value || 1, 1, 16); buildSongPanel(); };
    row1.append(lbl('类型'), typeSel, lbl('片段'), patSel, lbl('重复'), rep, lbl('×' + project.grid.bars + '小节'));

    const row2 = document.createElement('div'); row2.className = 'row';
    row2.append(lbl('启用层'));
    LAYER_DOTS.forEach(([k, zh]) => {
      const lab = document.createElement('label'); lab.className = 'ck';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sec.layers[k];
      cb.onchange = () => { sec.layers[k] = cb.checked; buildSongTimeline(); };
      lab.append(cb, document.createTextNode(zh)); row2.appendChild(lab);
    });

    const row3 = document.createElement('div'); row3.className = 'row';
    row3.append(lbl('动态'));
    const ff = numInput(sec.dyn.filterFrom, (v) => (sec.dyn.filterFrom = v)); const ft = numInput(sec.dyn.filterTo, (v) => (sec.dyn.filterTo = v));
    row3.append(lbl('滤波'), ff, document.createTextNode('→'), ft, document.createTextNode('Hz'));
    row3.append(ckInput('淡入', sec.dyn.fadeIn, (v) => (sec.dyn.fadeIn = v)));
    row3.append(ckInput('淡出', sec.dyn.fadeOut, (v) => (sec.dyn.fadeOut = v)));
    row3.append(ckInput('自动Riser', sec.dyn.autoRiser, (v) => (sec.dyn.autoRiser = v)));
    row3.append(ckInput('自动Impact', sec.dyn.autoImpact, (v) => (sec.dyn.autoImpact = v)));

    const row4 = document.createElement('div'); row4.className = 'row';
    row4.append(secBtn('◀ 左移', () => moveSection(-1)), secBtn('右移 ▶', () => moveSection(1)), secBtn('⧉ 复制', dupSection), secBtn('🗑 删除', delSection, 'danger'));

    box.append(row1, row2, row3, row4);
  }
  function applySectionType(sec, type) { const pre = SECTION_PRESET[type]; sec.type = type; sec.repeats = pre.repeats; sec.layers = { ...pre.layers }; sec.dyn = { ...pre.dyn }; }
  function moveSection(d) { const i = selSection, j = i + d, s = project.song.sections; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; selSection = j; buildSongPanel(); }
  function dupSection() { const s = project.song.sections, c = deepClone(s[selSection]); c.id = 's' + (secSeq++); s.splice(selSection + 1, 0, c); selSection++; buildSongPanel(); }
  function delSection() { project.song.sections.splice(selSection, 1); selSection = Math.max(0, selSection - 1); buildSongPanel(); }
  function addSection(type) { project.song.sections.push(newSection(type)); selSection = project.song.sections.length - 1; buildSongPanel(); }
  function updateSongMeta() {
    const bars = songTotalBars(), sec = bars * STEPS_PER_BAR * (60 / project.tempo.bpm / 4);
    if ($('song-length')) $('song-length').textContent = '共 ' + project.song.sections.length + ' 段 · ' + bars + ' 小节 · ' + Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
  }
  const lbl = (t) => { const s = document.createElement('span'); s.className = 'lbl'; s.textContent = t; return s; };
  function numInput(val, cb) { const i = document.createElement('input'); i.type = 'number'; i.min = 100; i.max = 20000; i.step = 100; i.value = val; i.style.width = '68px'; i.onchange = () => cb(clamp(+i.value || 100, 100, 20000)); return i; }
  function ckInput(text, val, cb) { const l = document.createElement('label'); l.className = 'ck'; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = val; c.onchange = () => cb(c.checked); l.append(c, document.createTextNode(text)); return l; }
  function secBtn(text, fn, cls) { const b = document.createElement('button'); b.className = 'tbtn' + (cls === 'danger' ? ' danger' : ''); b.textContent = text; b.onclick = fn; return b; }

  function rebuildAll() {
    A.playlines = [];
    buildDrumGrid();
    rolls.bass = makeRoll($('bass-roll'), 'bass', 24, 50);
    rolls.melody = makeRoll($('melody-roll'), 'melody', 48, 84);
    buildChordTrack();
    buildFxGrid();
    buildPatternBar();
    buildSongPanel();
    updateStepInfo();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  状态栏 / 提示
  // ═══════════════════════════════════════════════════════════════════════
  function setAudioStatus(kind, text) { const d = $('audio-dot'); d.className = 'sdot ' + (kind || ''); $('audio-status').textContent = text; }
  function setLoad(text) { $('load-status').textContent = text || ''; }
  let toastTimer = null;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
  function setPlayUI(on) {
    const b = $('play'); b.textContent = on ? '■' : '▶'; b.classList.toggle('playing', on);
    const modeTxt = project.playMode === 'song' ? '整曲' : '片段';
    if (!on) setAudioStatus(A.ready ? 'ok' : '', A.ready ? '已停止' : '音频未启动 — 点击 ▶ 开始');
    else setAudioStatus('ok', '播放中(' + modeTxt + ') ▸ ' + project.tempo.bpm + ' BPM');
  }
  function updateStepInfo() {
    const n = P().layers.bass.notes.length + P().layers.melody.notes.length;
    const hits = P().layers.drums.tracks.reduce((a, t) => a + t.steps.filter(Boolean).length, 0);
    $('step-info').textContent = `片段 ${P().name} · ${project.grid.bars}小节 · 鼓点 ${hits} · 音符 ${n} · FX ${P().layers.fx.events.length} · 段落 ${project.song.sections.length}`;
  }

  function resizeGrid(bars) {
    const wasPlaying = A.playing; if (wasPlaying) stop();
    project.grid.bars = bars; const total = bars * STEPS_PER_BAR;
    project.patterns.forEach((pat) => {
      pat.layers.drums.tracks.forEach((t) => (t.steps = resizeArr(t.steps, total, 0)));
      pat.layers.harmony.chords.length = bars;
      for (let b = 0; b < bars; b++) if (!pat.layers.harmony.chords[b]) pat.layers.harmony.chords[b] = { root: '—', quality: 'min7' };
      pat.layers.bass.notes = pat.layers.bass.notes.filter((n) => n.step < total);
      pat.layers.melody.notes = pat.layers.melody.notes.filter((n) => n.step < total);
      pat.layers.fx.events = pat.layers.fx.events.filter((e) => e.step < total);
    });
    rebuildAll();
    if (wasPlaying) play();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  JSON 导入 / 导出
  // ═══════════════════════════════════════════════════════════════════════
  function exportProject() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `song-${project.patterns.length}pat-${project.song.sections.length}sec-${project.tempo.bpm}bpm.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast('已导出 JSON');
  }
  function importProjectFile(file) {
    const reader = new FileReader();
    reader.onload = () => { let raw; try { raw = JSON.parse(reader.result); } catch (e) { toast('JSON 解析失败'); return; } if (raw && raw.format && raw.format !== 'todo-music-arranger') toast('格式不符,已尽力导入'); loadProject(coerceProject(raw)); toast('已导入'); };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsText(file);
  }
  function loadProject(p) {
    const wasPlaying = A.playing; if (wasPlaying) stop();
    project = p; selSection = 0;
    syncControlsFromModel();
    if (A.ready) { A.soundPattern = P(); ['bass', 'melody', 'harmony'].forEach((l) => applyLayerInstrumentFor(P(), l)); if (P().layers.drums.engine === 'sample') loadDrumMachine(P().layers.drums.machine); }
    rebuildAll();
  }

  function syncControlsFromModel() {
    $('bpm').value = project.tempo.bpm;
    $('bars').value = project.grid.bars;
    $('swing').value = project.tempo.swing; $('swing-val').textContent = project.tempo.swing + '%';
    $('master').value = project.master.volume; $('master-val').textContent = project.master.volume + 'dB';
    $('playmode').value = project.playMode;
    const L = P().layers;
    $('drum-engine').value = L.drums.engine;
    fillSelect($('drum-kit'), DRUM_MACHINES.map((m) => ({ v: m, t: m })), L.drums.machine);
    $('drum-kit').disabled = L.drums.engine !== 'sample';
    $('drum-src-info').textContent = L.drums.engine === 'sample' ? ('smplr · ' + L.drums.machine) : 'MembraneSynth / NoiseSynth';
    fillSelect($('bass-inst'), BASS_INSTR, L.bass.instrument);
    $('bass-sc').checked = L.bass.sidechain.on;
    fillSelect($('bass-sc-src'), L.drums.tracks.map((t) => ({ v: t.id, t: t.name })), L.bass.sidechain.source);
    $('bass-sc-amt').value = Math.round(L.bass.sidechain.amount * 100); $('bass-sc-val').textContent = Math.round(L.bass.sidechain.amount * 100) + '%';
    fillSelect($('harm-inst'), HARM_INSTR, L.harmony.instrument);
    $('harm-mode').value = L.harmony.mode; $('harm-rate').value = L.harmony.rate; $('harm-oct').value = L.harmony.octave;
    $('harm-rev').value = Math.round(L.harmony.reverb * 100); $('harm-cho').value = Math.round(L.harmony.chorus * 100);
    fillSelect($('mel-inst'), MEL_INSTR, L.melody.instrument);
    fillSelect($('mel-key'), NOTE_NAMES.map((n) => ({ v: n, t: n })), L.melody.key);
    $('mel-scale').value = L.melody.scale; $('mel-rev').value = Math.round(L.melody.reverb * 100);
    $('fx-filter').value = project.master.filter; $('fx-filter-val').textContent = fmtHz(project.master.filter);
    $('fx-master-rev').value = Math.round(project.master.reverb * 100);
    $('song-loop').checked = project.song.loop;
    fillSelect($('sec-add-type'), SECTION_TYPES.map((t) => ({ v: t.id, t: t.name })), 'intro');
  }
  const fmtHz = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'kHz' : v + 'Hz');

  // ═══════════════════════════════════════════════════════════════════════
  //  示例: 一首完整的电子曲 (双片段 + 五段结构)
  // ═══════════════════════════════════════════════════════════════════════
  function demoProject() {
    const p = defaultProject(); project = p;   // 临时指向, 便于用 newPattern/newSection
    // Pattern A —— 主素材
    const A0 = p.patterns[0]; A0.name = 'A'; fillGroove(A0.layers, false);
    // Pattern B —— 高潮变体 (更满的鼓 + 更高的 Hook)
    const B = newPattern('B', A0); fillGroove(B.layers, true); p.patterns.push(B);
    // 歌曲结构: 前奏(A) → 主歌(A) → 铺垫(A) → 高潮(B) → 尾奏(A)
    p.song.sections = [];
    const mk = (type, patId) => { const s = newSection(type); s.pattern = patId; return s; };
    p.song.sections.push(mk('intro', A0.id), mk('verse', A0.id), mk('build', A0.id), mk('drop', B.id), mk('outro', A0.id));
    p.playMode = 'song';
    return p;
  }
  function fillGroove(L, drop) {
    const on = (id, arr, acc) => { const t = L.drums.tracks.find((x) => x.id === id); (arr || []).forEach((s) => (t.steps[s] = 1)); (acc || []).forEach((s) => (t.steps[s] = 2)); };
    on('kick', [0, 4, 8, 12, 16, 20, 24, 28]);
    on('clap', [4, 12, 20, 28]);
    on('chh', drop ? [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30] : [2, 6, 10, 14, 18, 22, 26, 30]);
    on('ohh', [], [7, 23]);
    on('perc', drop ? [3, 11, 19, 27] : [15, 31]);
    L.bass.instrument = 'MonoSynth'; L.bass.sidechain = { on: true, source: 'kick', amount: 0.75 };
    L.bass.notes = [0, 3, 6, 10, 13].map((s) => ({ step: s, len: 2, midi: 36 })).concat([16, 19, 22, 26, 29].map((s) => ({ step: s, len: 2, midi: 32 })));
    L.harmony.instrument = 'poly-saw'; L.harmony.mode = drop ? 'pluck' : 'pad'; L.harmony.octave = 4;
    L.harmony.chords = [{ root: 'C', quality: 'min7' }, { root: 'G#', quality: 'maj7' }];
    L.melody.instrument = 'FMSynth'; L.melody.key = 'C'; L.melody.scale = 'minor';
    const oct = drop ? 12 : 0;
    L.melody.notes = [
      { step: 0, len: 2, midi: 72 + oct }, { step: 2, len: 2, midi: 75 + oct }, { step: 4, len: 4, midi: 74 + oct },
      { step: 10, len: 2, midi: 72 + oct }, { step: 12, len: 4, midi: 70 + oct },
      { step: 16, len: 2, midi: 68 + oct }, { step: 18, len: 2, midi: 70 + oct }, { step: 20, len: 4, midi: 72 + oct }, { step: 26, len: 6, midi: 67 + oct },
    ];
    L.fx.events = drop ? [{ type: 'impact', step: 0, len: 2 }] : [];
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  事件绑定 / 初始化
  // ═══════════════════════════════════════════════════════════════════════
  function bindTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active'); $('panel-' + tab.dataset.layer).classList.add('active');
      });
    });
  }
  function bindControls() {
    $('play').onclick = togglePlay;
    $('bpm').onchange = () => { project.tempo.bpm = clamp(+$('bpm').value || 128, 60, 200); $('bpm').value = project.tempo.bpm; if (A.ready) Tone.Transport.bpm.rampTo(project.tempo.bpm, 0.1); updateSongMeta(); if (A.playing) setPlayUI(true); };
    $('bars').onchange = () => resizeGrid(+$('bars').value);
    $('swing').oninput = () => { project.tempo.swing = +$('swing').value; $('swing-val').textContent = project.tempo.swing + '%'; if (A.ready) Tone.Transport.swing = project.tempo.swing / 100; };
    $('master').oninput = () => { project.master.volume = +$('master').value; $('master-val').textContent = project.master.volume + 'dB'; if (A.master) A.master.gain.rampTo(Tone.dbToGain(project.master.volume), 0.05); };
    $('playmode').onchange = () => { const wasPlaying = A.playing; if (wasPlaying) stop(); project.playMode = $('playmode').value; setPlayUI(false); if (wasPlaying) play(); };

    $('drum-engine').onchange = async () => { const v = $('drum-engine').value; P().layers.drums.engine = v; $('drum-kit').disabled = v !== 'sample'; $('drum-src-info').textContent = v === 'sample' ? ('smplr · ' + P().layers.drums.machine) : 'MembraneSynth / NoiseSynth'; if (v === 'sample') { try { await ensureAudio(); } catch (e) {} loadDrumMachine(P().layers.drums.machine); } };
    $('drum-kit').onchange = async () => { P().layers.drums.machine = $('drum-kit').value; $('drum-src-info').textContent = 'smplr · ' + $('drum-kit').value; if (P().layers.drums.engine === 'sample') { try { await ensureAudio(); } catch (e) {} loadDrumMachine($('drum-kit').value); } };

    $('bass-inst').onchange = () => { P().layers.bass.instrument = $('bass-inst').value; if (A.ready) { A.soundPattern = P(); applyLayerInstrument('bass'); } };
    $('bass-sc').onchange = () => (P().layers.bass.sidechain.on = $('bass-sc').checked);
    $('bass-sc-src').onchange = () => (P().layers.bass.sidechain.source = $('bass-sc-src').value);
    $('bass-sc-amt').oninput = () => { P().layers.bass.sidechain.amount = +$('bass-sc-amt').value / 100; $('bass-sc-val').textContent = $('bass-sc-amt').value + '%'; };

    $('harm-inst').onchange = () => { P().layers.harmony.instrument = $('harm-inst').value; if (A.ready) { A.soundPattern = P(); applyLayerInstrument('harmony'); } };
    $('harm-mode').onchange = () => (P().layers.harmony.mode = $('harm-mode').value);
    $('harm-rate').onchange = () => (P().layers.harmony.rate = $('harm-rate').value);
    $('harm-oct').onchange = () => { P().layers.harmony.octave = +$('harm-oct').value; buildChordTrack(); };
    $('harm-rev').oninput = () => { P().layers.harmony.reverb = +$('harm-rev').value / 100; if (A.harmReverb) A.harmReverb.wet.value = P().layers.harmony.reverb; };
    $('harm-cho').oninput = () => { P().layers.harmony.chorus = +$('harm-cho').value / 100; if (A.harmChorus) A.harmChorus.wet.value = P().layers.harmony.chorus; };

    $('mel-inst').onchange = () => { P().layers.melody.instrument = $('mel-inst').value; if (A.ready) { A.soundPattern = P(); applyLayerInstrument('melody'); } };
    $('mel-key').onchange = () => { P().layers.melody.key = $('mel-key').value; rolls.melody = makeRoll($('melody-roll'), 'melody', 48, 84); };
    $('mel-scale').onchange = () => { P().layers.melody.scale = $('mel-scale').value; rolls.melody = makeRoll($('melody-roll'), 'melody', 48, 84); };
    $('mel-rev').oninput = () => { P().layers.melody.reverb = +$('mel-rev').value / 100; if (A.melReverb) A.melReverb.wet.value = P().layers.melody.reverb; };

    $('fx-filter').oninput = () => { project.master.filter = +$('fx-filter').value; $('fx-filter-val').textContent = fmtHz(project.master.filter); if (A.masterFilter && !A.playing) A.masterFilter.frequency.rampTo(project.master.filter, 0.05); };
    $('fx-master-rev').oninput = () => { project.master.reverb = +$('fx-master-rev').value / 100; if (A.masterReverb) A.masterReverb.wet.value = project.master.reverb; };

    // 片段栏
    $('pat-add').onclick = () => addPattern(false);
    $('pat-dup').onclick = () => addPattern(true);
    $('pat-del').onclick = deletePattern;

    // 歌曲结构
    $('sec-add').onclick = () => addSection($('sec-add-type').value);
    $('song-loop').onchange = () => { project.song.loop = $('song-loop').checked; if (A.seq && project.playMode === 'song') A.seq.loop = project.song.loop; };

    // 顶栏
    $('export').onclick = exportProject;
    $('import').onclick = () => $('file-input').click();
    $('file-input').onchange = (e) => { const f = e.target.files[0]; if (f) importProjectFile(f); e.target.value = ''; };
    $('demo').onclick = () => { loadProject(demoProject()); toast('已载入示例整曲 — 点 ▶ 播放'); };
    $('clear').onclick = () => { loadProject(defaultProject()); toast('已清空'); };

    document.addEventListener('mousemove', (e) => {
      if (!activeDraw) return;
      const step = clamp(Math.floor((e.clientX - activeDraw.lane.getBoundingClientRect().left) / CELL), 0, activeDraw.total - 1);
      activeDraw.note.len = Math.max(1, step - activeDraw.startStep + 1); activeDraw.repaint();
    });
    document.addEventListener('mouseup', () => { if (activeDraw) { activeDraw = null; updateStepInfo(); } });
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); togglePlay(); } });
    document.querySelector('.stage').addEventListener('mouseup', updateStepInfo);
  }

  function init() {
    syncControlsFromModel();
    bindTabs();
    bindControls();
    rebuildAll();
    setAudioStatus('', '音频未启动 — 点击 ▶ 开始');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
