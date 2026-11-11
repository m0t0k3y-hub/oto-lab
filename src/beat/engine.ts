import { drum, type DrumKind } from '../audio/drums';
import { bassNote, acidNote, chordNote, masterHz, type AcidParams } from '../audio/synth';
import type { Pat } from '../data/beatChapters';
import type { Recipe } from '../types';
import { makeRig, type Rig } from '../audio/engine';
import { m2f } from '../audio/synth';

/* BEAT コースの再生エンジン（ライブ再生・お手本・WAV 書き出しで共通）。
   トラック番号：0 KICK / 1 CLAP / 2 C.HAT / 3 O.HAT / 4 BASS / 5 ACID / 6 CHORD */
export interface Note { s: number; n: number; len: number; acc?: boolean; sl?: boolean }
export interface Auto { acid: number[] | null; master: number[] | null }
/** 1小節ぶんのデータ：ドラム（d）、ノート（n = [BASS, ACID, CHORD]）、オートメーション（au） */
export interface BarData { d: Pat; n: Note[][]; au: Auto }
export interface Graph { bus: GainNode; mlp: BiquadFilterNode; tg: GainNode[]; dly: DelayNode; rigs: (Rig | null)[]; rp: (Recipe | null)[] }
/** トラックの音源：null = 内蔵の音、Recipe = SOUND LIBRARY の音色 */
export type Srcs = (Recipe | null)[];
export const NT = 3; // ノートトラックの数
export const emptyAuto = (): Auto => ({ acid: null, master: null });

export const swingOff = (pos: number, sd: number, sw: number) => pos % 2 ? (sw - .5) * 2 * sd : 0;

/** 出力の配線：各トラック → BUS → マスターフィルター → dest。CHORD だけディレイを通す */
export function makeGraph(ac: BaseAudioContext, dest: AudioNode, level = .9): Graph {
  const bus = ac.createGain(); bus.gain.value = level;
  const mlp = ac.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 20000; mlp.Q.value = .9;
  bus.connect(mlp); mlp.connect(dest);
  const tg = [0, 1, 2, 3, 4, 5, 6].map(() => { const g = ac.createGain(); g.connect(bus); return g; });
  const dly = ac.createDelay(2), fb = ac.createGain(), dlp = ac.createBiquadFilter(), wet = ac.createGain();
  dly.delayTime.value = .36; fb.gain.value = .45; dlp.type = 'lowpass'; dlp.frequency.value = 2200; wet.gain.value = .4;
  tg[6].connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(wet); wet.connect(bus);
  return { bus, mlp, tg, dly, rigs: [], rp: [] };
}

/** 1ステップぶんの音を予約する。tBar は小節の頭（スウィング前）の時刻 */
/** SOUND の音色を鳴らすための「リグ」をトラックごとに用意する（音色が変わったときだけ設定し直す） */
function rigFor(ac: BaseAudioContext, G: Graph, i: number, p: Recipe): Rig {
  if (!G.rigs[i]) { const boost = ac.createGain(); boost.gain.value = 2.4; boost.connect(G.tg[i]); G.rigs[i] = makeRig(ac, boost); G.rp[i] = null; }
  if (G.rp[i] !== p) { G.rigs[i].apply(p); G.rp[i] = p; }
  return G.rigs[i];
}
export function playRecipe(ac: BaseAudioContext, G: Graph, i: number, p: Recipe, freq: number, t: number, hold: number, vel: number){
  const v = rigFor(ac, G, i, p).voice(freq, p, t);
  v.vg.gain.value = v.vg.gain.value * vel;
  v.release(p.r, t + hold);
}

export function schedStep(ac: BaseAudioContext, G: Graph, noise: AudioBuffer, bar: BarData, pos: number, tBar: number, sd: number, sw: number, ap: AcidParams, srcs: Srcs = []){
  const at = (k: number) => tBar + k * sd + swingOff(k, sd, sw), t = at(pos);
  if (pos === 0) G.dly.delayTime.setValueAtTime(3 * sd, Math.max(tBar, ac.currentTime));
  // マスターフィルターのオートメーション
  const mv = bar.au.master ? bar.au.master[pos] : null;
  if (mv != null || pos === 0) G.mlp.frequency.setTargetAtTime(mv == null ? 20000 : masterHz(mv), t, .02);
  for (let i = 0; i < 4; i++) { const v = bar.d[i][pos]; if (v > 0) { const sp = srcs[i];
    if (sp) playRecipe(ac, G, i, sp, sp.freq, t, Math.max(sd, Math.min(sp.a + sp.d, .5)), v); else drum(ac, G.tg[i], noise, i as DrumKind, t, v); } }
  const [bass, acid, chord] = bar.n;
  // SOUND の音色に切り替えたノートトラック：ピアノロールの高さで鳴らす（ACCENT は少し強く、SLIDE はなし）
  for (let k = 0; k < 3; k++) { const sp = srcs[4 + k]; if (!sp) continue;
    for (const nt of bar.n[k]) if (nt.s === pos) playRecipe(ac, G, 4 + k, sp, m2f(nt.n), t, nt.len * sd * .95, nt.acc ? 1 : (k === 1 ? .8 : .9)); }
  if (!srcs[4]) for (const nt of bass) if (nt.s === pos) bassNote(ac, G.tg[4], t, nt.len * sd, nt.n);
  const p = { ...ap, cut: bar.au.acid ? bar.au.acid[pos] : ap.cut };
  for (const nt of acid) {
    if (srcs[5] || nt.s !== pos) continue;
    // 前のノートからスライドしてきた音は、前のノートが続けて鳴らすので鳴らさない
    if (acid.some(q => q.sl && q.s + q.len === pos)) continue;
    const nx = nt.sl ? acid.find(q => q.s === nt.s + nt.len) : null;
    const dur = nx ? at(nx.s + nx.len) - t : nt.len * sd * .82;
    acidNote(ac, G.tg[5], t, dur, nt.n, p, !!nt.acc, nx ? { t: at(nx.s), n: nx.n } : undefined);
  }
  if (!srcs[6]) for (const nt of chord) if (nt.s === pos) chordNote(ac, G.tg[6], t, nt.len * sd, nt.n);
}

/** お手本データ（ドラムだけの配列でも可）を BarData にそろえる */
export function toBar(x: any): BarData {
  if (Array.isArray(x)) return { d: x, n: [[], [], []], au: emptyAuto() };
  return { d: x.d || [0, 1, 2, 3].map(() => new Array(16).fill(0)), n: x.n || [[], [], []], au: { ...emptyAuto(), ...(x.au || {}) } };
}
