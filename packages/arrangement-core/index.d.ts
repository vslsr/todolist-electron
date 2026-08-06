/**
 * arrangement-core — type declarations
 * Parse / validate / query for "todo-music-arranger" (v2) arrangement JSON.
 */

export type NoteName = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type ChordRoot = NoteName | '—';
export type ChordQuality =
  | 'maj' | 'min' | 'maj7' | 'min7' | '7' | 'sus2' | 'sus4' | 'dim' | 'aug' | 'add9' | 'min9' | '6';
export type ScaleName = 'major' | 'minor' | 'dorian' | 'penta-min' | 'chromatic';
export type HarmonyMode = 'pad' | 'arp' | 'pluck';
export type ArpRate = '16n' | '8n' | '8t' | '4n';
export type FxType = 'riser' | 'downlifter' | 'impact' | 'reverse' | 'sweep';
export type SectionType = 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'outro';
export type DrumTrackId = 'kick' | 'snare' | 'clap' | 'chh' | 'ohh' | 'perc';
export type LayerName = 'drums' | 'bass' | 'harmony' | 'melody' | 'fx';

export interface Note { step: number; len: number; midi: number; }
export interface Chord { root: ChordRoot; quality: ChordQuality; }
export interface FxEvent { type: FxType; step: number; len: number; }
export interface DrumTrack {
  id: DrumTrackId; name: string; color: string; sample: string;
  steps: number[]; gain: number; mute: boolean; solo: boolean;
}
export interface Layers {
  drums: { engine: 'synth' | 'sample'; machine: string; tracks: DrumTrack[] };
  bass: { instrument: string; sidechain: { on: boolean; source: string; amount: number }; notes: Note[] };
  harmony: { instrument: string; mode: HarmonyMode; rate: ArpRate | string; octave: number; reverb: number; chorus: number; chords: Chord[] };
  melody: { instrument: string; key: NoteName; scale: ScaleName; reverb: number; notes: Note[] };
  fx: { events: FxEvent[] };
}
export interface LayerFlags { drums: boolean; bass: boolean; harmony: boolean; melody: boolean; fx: boolean; }
export interface Pattern { id: string; name: string; enabled: LayerFlags; layers: Layers; }
export interface SectionDyn {
  filterFrom: number; filterTo: number; fadeIn: boolean; fadeOut: boolean; autoRiser: boolean; autoImpact: boolean;
}
export interface Section { id: string; type: SectionType; pattern: string; repeats: number; layers: LayerFlags; dyn: SectionDyn; }
export interface Project {
  format: 'todo-music-arranger'; version: 2;
  tempo: { bpm: number; swing: number };
  grid: { bars: 1 | 2 | 4 | 8; stepsPerBar: 16 };
  master: { volume: number; filter: number; reverb: number };
  activePattern: number;
  patterns: Pattern[];
  playMode: 'pattern' | 'song';
  song: { loop: boolean; sections: Section[] };
  interactive: InteractiveBlock | null;
}

// ── interactive music (Wwise-style) ──────────────────────────────────────
export type SyncMode = 'immediate' | 'nextBeat' | 'nextBar' | 'nextLoop';
export interface ChannelSource { pattern: string; layer: LayerName; }
/** RTPC → gain-multiplier response curve: piecewise-linear breakpoints [x,y], x,y in 0..1. */
export type RtpcCurve = [number, number][];
export interface RtpcBinding { param: string; curve: RtpcCurve; }
export interface Channel { id: string; name: string; sources: ChannelSource[]; gain: number; rtpc: RtpcBinding | null; }
export interface RtpcDef { id: string; name: string; min: number; max: number; default: number; }
export interface Scene { id: string; name: string; on: string[]; master: { filter: number | null; volume: number | null }; rtpc: Record<string, number>; }
/** One-shot phrase played over the running music, quantized to a sync boundary. */
export interface Stinger { id: string; name: string; sources: ChannelSource[]; sync: SyncMode; gain: number; }
export interface InteractiveBlock {
  loopBars: number; channels: Channel[]; rtpc: RtpcDef[]; scenes: Scene[]; stingers: Stinger[];
  default: string | null; transition: { sync: SyncMode; fadeSec: number };
}
export interface ResolvedChannel { id: string; name: string; sources: ChannelSource[]; on: boolean; gainDb: number; }
export interface ResolvedMix { sceneId: string | null; name: string | null; master: { filter: number | null; volume: number | null }; channels: ResolvedChannel[]; }
export interface ChannelClipEvent extends ArrangementEvent { channelId: string; sourcePattern: string; sourceLayer: LayerName; }
export interface TransitionOptions { sync?: SyncMode; fadeSec?: number; }

/** A `sink` the controller pushes computed gains/master to. All methods optional. */
export interface InteractiveSink {
  now?(): number;
  setChannelGain?(channelId: string, db: number, atTime: number, rampSec: number): void;
  setMaster?(kind: 'filter' | 'volume', value: number, atTime: number, rampSec: number): void;
}

/** Engine-agnostic runtime: holds scene/channel/RTPC state, computes synced transitions, pushes to a sink. */
export class InteractiveMusicController {
  constructor(project: Project | string | object, sink?: InteractiveSink, options?: object);
  start(): this;
  setScene(id: string, opts?: TransitionOptions): this;
  setChannel(id: string, on: boolean, opts?: TransitionOptions): this;
  toggleChannel(id: string, opts?: TransitionOptions): this;
  setRTPC(param: string, value: number, opts?: TransitionOptions): this;
  triggerStinger(id: string, opts?: TransitionOptions & { gain?: number }): this;
  setChannelCurve(id: string, curve: RtpcCurve, opts?: TransitionOptions): this;
  getScene(): string | null;
  getMix(): ResolvedMix;
  getRTPC(param?: string): number | Record<string, number>;
  listScenes(): { id: string; name: string }[];
  listChannels(): { id: string; name: string; sources: ChannelSource[]; rtpc: RtpcBinding | null; gain: number }[];
  listStingers(): { id: string; name: string }[];
  timing(): { secPerBeat: number; secPerBar: number; loopSec: number };
  syncTime(mode?: SyncMode): number;
}

export interface MIDIOptions { ppq?: number; source?: 'song' | 'pattern'; patternRef?: string | number; events?: ArrangementEvent[]; }
/** Encode the arrangement as a Standard MIDI File (format 1). Pure — returns raw bytes. */
export function toMIDI(input: string | object | Project, options?: MIDIOptions): Uint8Array;
export function getStingerClip(input: string | object | Project, stingerId: string, options?: { onlyAudible?: boolean }): (ArrangementEvent & { stingerId: string; sourcePattern: string; sourceLayer: LayerName })[];
export function listStingers(input: string | object | Project): Stinger[];
/** Evaluate a piecewise-linear RTPC curve at x (0..1). */
export function evalCurve(curve: RtpcCurve, x: number): number;

export function generateDefaultInteractive(input: string | object | Project): InteractiveBlock;
export function resolveScene(input: string | object | Project, sceneId?: string, rtpcOverride?: Record<string, number>, overrides?: Record<string, boolean>): ResolvedMix | null;
export function getChannelClip(input: string | object | Project, channelId: string, options?: { onlyAudible?: boolean }): ChannelClipEvent[];
export function computeChannelGainDb(project: Project, channelId: string, opts?: { sceneId?: string; rtpc?: Record<string, number>; overrides?: Record<string, boolean> }): number;
export function listChannels(input: string | object | Project): Channel[];
export function listScenes(input: string | object | Project): Scene[];
export const SYNC_MODES: SyncMode[];
export const LAYER_NAMES: LayerName[];

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[]; }

export interface TimelineSection {
  id: string; type: SectionType; patternId: string; repeats: number;
  startBar: number; bars: number; startStep: number; steps: number;
  startSec: number; durSec: number; layers: LayerFlags; dyn: SectionDyn;
}
export interface Timeline {
  bpm: number; swing: number; bars: number; stepSec: number;
  totalBars: number; totalSteps: number; durationSec: number; sections: TimelineSection[];
}

/** One scheduled, timed event. `timeSec` is nominal (swing not applied). */
export interface ArrangementEvent {
  kind: 'drum' | 'bass' | 'melody' | 'harmony' | 'fx';
  step: number;              // global 16th-step index
  localStep: number | null;  // step within the pattern loop (null for auto-fx)
  stepInBar: number;         // 0..15
  bar: number;               // global bar index
  timeSec: number;           // seconds from song (or pattern) start, nominal tempo
  durSec: number;
  lenSteps: number;
  audible: boolean;
  sectionId: string | null;
  sectionType: SectionType | null;
  patternId: string;
  // drum
  track?: DrumTrackId; name?: string; accent?: boolean; velocity?: number; gain?: number;
  // bass / melody / arp-harmony
  midi?: number | null; note?: string | null;
  // harmony
  mode?: HarmonyMode; root?: ChordRoot; quality?: ChordQuality; octave?: number;
  notes?: number[]; noteNames?: string[]; arpIndex?: number;
  // fx
  fxType?: FxType; auto?: boolean;
}

export interface ChordChartEntry {
  bar: number; startSec: number; sectionId: string; sectionType: SectionType; patternId: string;
  root: ChordRoot; quality: ChordQuality; silent: boolean; notes: number[]; octave: number;
}

export interface Summary {
  format: string; version: number; bpm: number; swing: number; bars: number;
  key: NoteName; scale: ScaleName; playMode: string; loop: boolean;
  patterns: { id: string; name: string }[];
  sections: { type: SectionType; patternId: string; bars: number; startSec: number; durSec: number }[];
  totalBars: number; durationSec: number;
}

export interface SongEventOptions { onlyAudible?: boolean; includeFx?: boolean; includeAutoFx?: boolean; }
export interface PatternEventOptions { onlyAudible?: boolean; ignoreEnabled?: boolean; }

/** Normalize raw JSON (string or object) into a valid v2 Project (mirrors the tool's importer; migrates v1). Throws SyntaxError only on unparseable JSON strings. */
export function parseArrangement(input: string | object): Project;
/** Strict, non-mutating check of RAW input against the schema contract. */
export function validateArrangement(input: string | object): ValidationResult;
/** Quick heuristic: does this look like an arrangement? */
export function isArrangement(input: string | object): boolean;
export function coerceProject(raw: any): Project;
export function defaultProject(): Project;

export function getTimeline(input: string | object | Project): Timeline;
export function getDurationSeconds(input: string | object | Project): number;
export function getSongEvents(input: string | object | Project, options?: SongEventOptions): ArrangementEvent[];
export function getPatternEvents(input: string | object | Project, patternRef?: string | number | Pattern | null, options?: PatternEventOptions): ArrangementEvent[];
export function getChordChart(input: string | object | Project): ChordChartEntry[];
export function summarize(input: string | object | Project): Summary;
export function patternById(project: Project, id: string): Pattern | null;

export function chordToMidi(chord: Chord, octave: number): number[];
export function midiToNoteName(midi: number): string;
export function noteNameToPitchClass(name: string): number;
export function scaleSemitones(scale: ScaleName | string): number[] | null;
export function isInScale(midi: number, key: NoteName | string, scale: ScaleName | string): boolean;
export function rateToSteps(rate: ArpRate | string): number;

export const STEPS_PER_BAR: 16;
export const NOTE_NAMES: NoteName[];
export const CHORD_QUALITIES: Record<ChordQuality, number[]>;
export const SCALES: Record<ScaleName, number[]>;
export const DRUM_ROWS: { id: DrumTrackId; name: string; color: string; sample: string }[];
export const DRUM_MACHINES: string[];
export const FX_TYPES: FxType[];
export const SECTION_TYPES: SectionType[];
export const SECTION_PRESET: Record<SectionType, { repeats: number; layers: LayerFlags; dyn: SectionDyn }>;
export const RANGES: Record<string, number[]>;
export const VERSION: string;

declare const _default: {
  parseArrangement: typeof parseArrangement;
  validateArrangement: typeof validateArrangement;
  isArrangement: typeof isArrangement;
  coerceProject: typeof coerceProject;
  defaultProject: typeof defaultProject;
  getTimeline: typeof getTimeline;
  getDurationSeconds: typeof getDurationSeconds;
  getSongEvents: typeof getSongEvents;
  getPatternEvents: typeof getPatternEvents;
  getChordChart: typeof getChordChart;
  summarize: typeof summarize;
  patternById: typeof patternById;
  InteractiveMusicController: typeof InteractiveMusicController;
  generateDefaultInteractive: typeof generateDefaultInteractive;
  resolveScene: typeof resolveScene;
  getChannelClip: typeof getChannelClip;
  getStingerClip: typeof getStingerClip;
  computeChannelGainDb: typeof computeChannelGainDb;
  evalCurve: typeof evalCurve;
  listChannels: typeof listChannels;
  listScenes: typeof listScenes;
  listStingers: typeof listStingers;
  toMIDI: typeof toMIDI;
  SYNC_MODES: SyncMode[];
  LAYER_NAMES: LayerName[];
  chordToMidi: typeof chordToMidi;
  midiToNoteName: typeof midiToNoteName;
  noteNameToPitchClass: typeof noteNameToPitchClass;
  scaleSemitones: typeof scaleSemitones;
  isInScale: typeof isInScale;
  rateToSteps: typeof rateToSteps;
  STEPS_PER_BAR: 16;
  NOTE_NAMES: NoteName[];
  CHORD_QUALITIES: Record<ChordQuality, number[]>;
  SCALES: Record<ScaleName, number[]>;
  DRUM_ROWS: typeof DRUM_ROWS;
  DRUM_MACHINES: string[];
  FX_TYPES: FxType[];
  SECTION_TYPES: SectionType[];
  SECTION_PRESET: typeof SECTION_PRESET;
  RANGES: Record<string, number[]>;
  VERSION: string;
};
export default _default;
