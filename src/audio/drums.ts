/* BEAT コース用のドラム音源（909 風の合成音。サンプル素材は使わない）。
   AudioContext / OfflineAudioContext のどちらでも同じ音が鳴る。 */
export type DrumKind = 0 | 1 | 2 | 3; // 0 KICK, 1 CLAP, 2 C.HAT, 3 O.HAT

export function drum(ac: BaseAudioContext, out: AudioNode, noise: AudioBuffer, k: DrumKind, t: number, vel: number){
  const v = Math.max(0.05, Math.min(1, vel));
  const g = ac.createGain(); g.connect(out);
  const nz = (dur: number) => { const s = ac.createBufferSource(); s.buffer = noise; s.start(t, Math.random() * 1.5); s.stop(t + dur); return s; };
  if (k === 0) {
    // キック：サイン波の音程を一気に下げる「ドン」＋ごく短いクリック
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(48, t + .09);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * .95, t + .002);
    g.gain.exponentialRampToValueAtTime(.001, t + .42);
    o.connect(g); o.start(t); o.stop(t + .45);
    const cg = ac.createGain(), hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    cg.gain.setValueAtTime(v * .22, t); cg.gain.exponentialRampToValueAtTime(.001, t + .012);
    nz(.02).connect(hp); hp.connect(cg); cg.connect(out);
  } else if (k === 1) {
    // クラップ：帯域を絞ったノイズを3回すばやく重ねて「パシッ」
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = .9;
    const G = g.gain; G.setValueAtTime(.0001, t);
    for (let i = 0; i < 3; i++) { const s = t + i * .011; G.setValueAtTime(v * .75, s); G.exponentialRampToValueAtTime(.06, s + .009); }
    G.setValueAtTime(v * .6, t + .033); G.exponentialRampToValueAtTime(.001, t + .26);
    nz(.3).connect(bp); bp.connect(g);
  } else {
    // ハイハット：高い帯域だけのノイズ。閉じたら短く、開いたら長く
    const open = k === 3;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 6200 : 7500;
    g.gain.setValueAtTime(v * (open ? .26 : .34), t);
    g.gain.exponentialRampToValueAtTime(.001, t + (open ? .32 : .05));
    nz(open ? .34 : .07).connect(hp); hp.connect(g);
  }
}
