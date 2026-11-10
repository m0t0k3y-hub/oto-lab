import { drum, type DrumKind } from '../audio/drums';
import { bassNote, acidNote, chordNote, masterHz, type AcidParams } from '../audio/synth';
import type { Pat } from '../data/beatChapters';

/* BEAT コースの再生エンジン（ライブ再生・お手本・WAV 書き出しで共通）。
   トラック番号：0 KICK / 1 CLAP / 2 C.HAT / 3 O.HAT / 4 BASS / 5 ACID / 6 CHORD */
export interface Note { s: number; n: number; len: number; acc?: boolean; sl?: boolean }
export interface Auto { acid: number[] | null; master: number[] | null }
/** 1小節ぶんのデータ：ドラム（d）、ノート（n = [BASS, ACID, CHORD]）、オートメーション（au） */
export interface BarData { d: Pat; n: Note[][]; au: Auto }
export interface Graph { bus: GainNode; mlp: BiquadFilterNode; tg: GainNode[]; dly: DelayNode }
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
  return { bus, mlp, tg, dly };
}

/** 1ステップぶんの音を予約する。tBar は小節の頭（スウィング前）の時刻 */
export function schedStep(ac: BaseAudioContext, G: Graph, noise: AudioBuffer, bar: BarData, pos: number, tBar: number, sd: number, sw: number, ap: AcidParams){
  const at = (k: number) => tBar + k * sd + swingOff(k, sd, sw), t = at(pos);
  if (pos === 0) G.dly.delayTime.setValueAtTime(3 * sd, Math.max(tBar, ac.currentTime));
  // マスターフィルターのオートメーション
  const mv = bar.au.master ? bar.au.master[pos] : null;
  if (mv != null || pos === 0) G.mlp.frequency.setTargetAtTime(mv == null ? 20000 : masterHz(mv), t, .02);
  for (let i = 0; i < 4; i++) { const v = bar.d[i][pos]; if (v > 0) drum(ac, G.tg[i], noise, i as DrumKind, t, v); }
  const [bass, acid, chord] = bar.n;
  for (const nt of bass) if (nt.s === pos) bassNote(ac, G.tg[4], t, nt.len * sd, nt.n);
  const p = { ...ap, cut: bar.au.acid ? bar.au.acid[pos] : ap.cut };
  for (const nt of acid) {
    if (nt.s !== pos) continue;
    // 前のノートからスライドしてきた音は、前のノートが続けて鳴らすので鳴らさない
    if (acid.some(q => q.sl && q.s + q.len === pos)) continue;
    const nx = nt.sl ? acid.find(q => q.s === nt.s + nt.len) : null;
    const dur = nx ? at(nx.s + nx.len) - t : nt.len * sd * .82;
    acidNote(ac, G.tg[5], t, dur, nt.n, p, !!nt.acc, nx ? { t: at(nx.s), n: nx.n } : undefined);
  }
  for (const nt of chord) if (nt.s === pos) chordNote(ac, G.tg[6], t, nt.len * sd, nt.n);
}

/** お手本データ（ドラムだけの配列でも可）を BarData にそろえる */
export function toBar(x: any): BarData {
  if (Array.isArray(x)) return { d: x, n: [[], [], []], au: emptyAuto() };
  return { d: x.d || [0, 1, 2, 3].map(() => new Array(16).fill(0)), n: x.n || [[], [], []], au: { ...emptyAuto(), ...(x.au || {}) } };
}
