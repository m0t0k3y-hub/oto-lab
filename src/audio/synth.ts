/* BEAT コース第2段階のシンセ音源（ベース・アシッド・コード）。
   drums.ts と同じく AudioContext / OfflineAudioContext のどちらでも同じ音が鳴る。 */
export const m2f = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export interface AcidParams { cut: number; res: number; env: number; dec: number }
/** 0〜1 のつまみ値 → カットオフ周波数（80 Hz 〜 約 10 kHz） */
export const acidHz = (cut: number) => 80 * Math.pow(2, cut * 7);
/** 0〜1 → マスターフィルターの周波数（120 Hz 〜 20 kHz） */
export const masterHz = (v: number) => 120 * Math.pow(2, v * 7.4);

/** ベース：ノコギリ波＋サイン波のサブを低めのローパスで丸めた、太くて短い音 */
export function bassNote(ac: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, vel = 1){
  const f = m2f(n), o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
  o1.type = 'sawtooth'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f;
  lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(320, t + .12);
  const s1 = ac.createGain(); s1.gain.value = .45; const s2 = ac.createGain(); s2.gain.value = .8;
  o1.connect(s1); s1.connect(lp); o2.connect(s2); s2.connect(lp); lp.connect(g); g.connect(out);
  const end = t + Math.max(dur * .92, .06);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.42 * vel, t + .004);
  g.gain.setTargetAtTime(.3 * vel, t + .004, .08); g.gain.setTargetAtTime(0, end, .015);
  o1.start(t); o2.start(t); o1.stop(end + .12); o2.stop(end + .12);
}

/** アシッド：303 風。強いレゾナンスのローパスを、ノートごとのエンベロープで開く。
   acc = アクセント（大きく・より開く）、slideTo = 次のノートへ音程をなめらかにつなぐ */
export function acidNote(ac: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, p: AcidParams, acc = false, slideTo?: { t: number; n: number }){
  const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(m2f(n), t);
  if (slideTo) { o.frequency.setValueAtTime(m2f(n), slideTo.t); o.frequency.linearRampToValueAtTime(m2f(slideTo.n), slideTo.t + .07); }
  const base = acidHz(p.cut), em = p.env * (acc ? 1.7 : 1), peak = Math.min(18000, base * (1 + em * 9));
  lp.type = 'lowpass'; lp.Q.value = 1 + p.res * 19;
  lp.frequency.setValueAtTime(peak, t); lp.frequency.setTargetAtTime(base, t + .002, .03 + p.dec * .5 * (acc ? .6 : 1));
  o.connect(lp); lp.connect(g); g.connect(out);
  const lvl = .2 * (acc ? 1.45 : 1), end = t + Math.max(dur, .05);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + .003);
  g.gain.setTargetAtTime(lvl * .75, t + .003, .1); g.gain.setTargetAtTime(0, end, .008);
  o.start(t); o.stop(end + .08);
}

/** コード（スタブ）：少しずらした2本のノコギリ波を短く切る。ディレイはトラック側でかける */
export function chordNote(ac: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, vel = 1){
  const lp = ac.createBiquadFilter(), g = ac.createGain();
  lp.type = 'lowpass'; lp.Q.value = 1.2; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(900, t + .25);
  lp.connect(g); g.connect(out);
  const os = [-8, 8].map(dt => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = m2f(n); o.detune.value = dt; o.connect(lp); return o; });
  const end = t + Math.min(Math.max(dur, .08), 1.5);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.075 * vel, t + .005);
  g.gain.setTargetAtTime(.0001, t + .005, .09 + Math.min(dur, 1) * .12); g.gain.setTargetAtTime(0, end, .02);
  os.forEach(o => { o.start(t); o.stop(end + .15); });
}
