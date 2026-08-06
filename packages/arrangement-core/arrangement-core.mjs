/*!
 * arrangement-core — native ESM entry.
 *
 * Re-exports the single UMD implementation (`arrangement-core.js`) as named ESM
 * bindings so it works from: Node `import`, bundlers (Vite/webpack/Rollup), and
 * raw browser `<script type="module">`. The resolution below covers all three:
 *  - Node ESM importing the CJS file  → namespace.default holds the API object
 *  - browser ESM importing the UMD    → UMD's global branch set globalThis.ArrangementCore
 */
import * as ns from './arrangement-core.js';

const AC =
  (ns && ns.default && ns.default.parseArrangement) ? ns.default :
  (ns && ns.parseArrangement) ? ns :
  (typeof globalThis !== 'undefined' ? globalThis.ArrangementCore : undefined);

if (!AC || !AC.parseArrangement) {
  throw new Error('arrangement-core: failed to load implementation from ./arrangement-core.js');
}

export const parseArrangement = AC.parseArrangement;
export const validateArrangement = AC.validateArrangement;
export const isArrangement = AC.isArrangement;
export const coerceProject = AC.coerceProject;
export const defaultProject = AC.defaultProject;
export const getTimeline = AC.getTimeline;
export const getDurationSeconds = AC.getDurationSeconds;
export const getSongEvents = AC.getSongEvents;
export const getPatternEvents = AC.getPatternEvents;
export const getChordChart = AC.getChordChart;
export const summarize = AC.summarize;
export const patternById = AC.patternById;
export const InteractiveMusicController = AC.InteractiveMusicController;
export const generateDefaultInteractive = AC.generateDefaultInteractive;
export const resolveScene = AC.resolveScene;
export const getChannelClip = AC.getChannelClip;
export const getStingerClip = AC.getStingerClip;
export const computeChannelGainDb = AC.computeChannelGainDb;
export const evalCurve = AC.evalCurve;
export const listChannels = AC.listChannels;
export const listScenes = AC.listScenes;
export const listStingers = AC.listStingers;
export const SYNC_MODES = AC.SYNC_MODES;
export const LAYER_NAMES = AC.LAYER_NAMES;
export const toMIDI = AC.toMIDI;
export const chordToMidi = AC.chordToMidi;
export const midiToNoteName = AC.midiToNoteName;
export const noteNameToPitchClass = AC.noteNameToPitchClass;
export const scaleSemitones = AC.scaleSemitones;
export const isInScale = AC.isInScale;
export const rateToSteps = AC.rateToSteps;
export const STEPS_PER_BAR = AC.STEPS_PER_BAR;
export const NOTE_NAMES = AC.NOTE_NAMES;
export const CHORD_QUALITIES = AC.CHORD_QUALITIES;
export const SCALES = AC.SCALES;
export const DRUM_ROWS = AC.DRUM_ROWS;
export const DRUM_MACHINES = AC.DRUM_MACHINES;
export const FX_TYPES = AC.FX_TYPES;
export const SECTION_TYPES = AC.SECTION_TYPES;
export const SECTION_PRESET = AC.SECTION_PRESET;
export const RANGES = AC.RANGES;
export const VERSION = AC.VERSION;

export default AC;
