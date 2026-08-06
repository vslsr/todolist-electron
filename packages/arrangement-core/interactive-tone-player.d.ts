import { Project, ResolvedMix, ChannelSource, TransitionOptions, RtpcCurve } from './index';

export interface PlayerDeps {
  /** A Tone.js instance (dependency-injected — not bundled). */
  Tone: any;
  /** The ArrangementCore module (auto-resolved from global/require if omitted). */
  ArrangementCore?: any;
}

/** Tone.js reference player for arrangement-core interactive music. */
export class InteractiveMusicPlayer {
  constructor(project: Project | string | object, deps: PlayerDeps);
  play(): Promise<this>;
  stop(): this;
  dispose(): this;
  setScene(id: string, opts?: TransitionOptions): this;
  setChannel(id: string, on: boolean, opts?: TransitionOptions): this;
  toggleChannel(id: string, opts?: TransitionOptions): this;
  setRTPC(param: string, value: number, opts?: TransitionOptions): this;
  triggerStinger(id: string, opts?: TransitionOptions & { gain?: number }): this;
  setChannelCurve(id: string, curve: RtpcCurve, opts?: TransitionOptions): this;
  getScene(): string | null;
  getRTPC(param?: string): number | Record<string, number>;
  getMix(): ResolvedMix;
  listScenes(): { id: string; name: string }[];
  listChannels(): { id: string; name: string; sources: ChannelSource[] }[];
  listStingers(): { id: string; name: string }[];
  playing: boolean;
}

declare const _default: { InteractiveMusicPlayer: typeof InteractiveMusicPlayer };
export default _default;
