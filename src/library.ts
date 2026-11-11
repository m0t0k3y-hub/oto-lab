import type { Recipe } from './types';
import { DEF } from './data/defaults';

/* SOUND LIBRARY：SOUND コースでつくった音色を名前を付けて保存し、BEAT コースのトラックで鳴らす。
   お手本の音色（PRESET）は最初から入っていて、消せない。 */
export interface LibItem { id: string; name: string; p: Recipe; preset?: boolean }

const R = (o: Partial<Recipe>): Recipe => ({ ...DEF, ...o });
export const PRESETS: LibItem[] = [
  { id: 'pre-kick', name: 'お手本 KICK', preset: true, p: R({ wave: 'sine', freq: 48, vol: -4, a: .001, d: .4, s: 0, r: .2, pdAmt: 36, pdTime: .055 }) },
  { id: 'pre-hat', name: 'お手本 HAT', preset: true, p: R({ oscLvl: 0, noise: 1, ftype: 'highpass', cutoff: 8000, res: .7, vol: -10, a: .001, d: .05, s: 0, r: .04 }) },
  { id: 'pre-clap', name: 'お手本 CLAP', preset: true, p: R({ wave: 'triangle', freq: 220, oscLvl: .3, noise: .9, ftype: 'highpass', cutoff: 900, vol: -6, a: .001, d: .16, s: 0, r: .12, revMix: .18, revTime: .8 }) },
  { id: 'pre-bass', name: 'お手本 SAW BASS', preset: true, p: R({ wave: 'sawtooth', freq: 110, cutoff: 650, res: 4, vol: -8, a: .004, d: .18, s: .55, r: .06 }) },
  { id: 'pre-pluck', name: 'お手本 PLUCK', preset: true, p: R({ wave: 'square', freq: 440, cutoff: 2600, res: 2, vol: -12, a: .002, d: .22, s: 0, r: .18, dlyMix: .25, dlyTime: .36, dlyFb: .4 }) },
  { id: 'pre-pad', name: 'お手本 PAD', preset: true, p: R({ wave: 'sawtooth', freq: 220, cutoff: 1600, res: 1, vol: -16, a: .35, d: .6, s: .8, r: .9, lfoTarget: 'filter', lfoRate: .4, lfoDepth: .25, revMix: .45, revTime: 3 }) },
];

export const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const libAll = (user: LibItem[]) => [...(user || []), ...PRESETS];
export const libFind = (user: LibItem[], id: string | null) => id ? libAll(user).find(x => x.id === id) || null : null;
