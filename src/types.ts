export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type FilterType = 'lowpass' | 'highpass';
export type LfoTarget = 'pitch' | 'amp' | 'filter';

/** 1つの音色の設定（レシピ）。保存・共有・書き出しの単位。 */
export interface Recipe {
  wave: Wave; freq: number; vol: number; oscLvl: number; noise: number;
  a: number; d: number; s: number; r: number;
  ftype: FilterType; cutoff: number; res: number;
  lfoTarget: LfoTarget; lfoWave: Wave; lfoRate: number; lfoDepth: number;
  revMix: number; revTime: number; dlyTime: number; dlyFb: number; dlyMix: number;
}
/** お手本などで使う一時的な指定（_dur: 鳴らす秒数, _sweep: カットオフの自動変化） */
export type Preset = Partial<Recipe> & { _dur?: number; _sweep?: [number, number] };
export type PlayParams = Recipe & { _dur?: number; _sweep?: [number, number] };

export interface Clip { start: number; len: number; note: number }
export interface TrackData { name: string; p: Recipe; clips: Clip[]; vol: number; pan: number; mute: boolean; solo: boolean }
export interface Project { app: 'otolab'; v: number; bpm: number; master: number; normalize: boolean; tracks: TrackData[] }

export interface Term { n: string; en: string; d: string; demo?: Preset }
export interface Step {
  id: string; t: string; focus?: string; demo?: Preset;
  act?: { label: string; action: 'loadSample' };
  c: (e: any) => boolean;
}
export interface Chapter { soon?: number; tag: string; title: string; intro: string; terms: string[]; mods: string[]; steps: Step[] }
