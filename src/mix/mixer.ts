import { $, $$, h } from '../ui/dom';
import { clamp, dbToGain } from '../util';
import { createKnob } from '../ui/knob';
import { makeNoiseBuffer, makeIR } from '../audio/engine';
import { makeGraph, schedStep, type BarData, type Srcs, type Graph } from '../beat/engine';
import type { AcidParams } from '../audio/synth';
import { toWav } from '../audio/wav';
import { BAD_MIX, BAD_STRIPS, DEF_MASTER, flatStrip, type Strip, type Master } from '../data/mixChapters';

/* ================= MIX コース：ミキサー =================
   各トラック → ストリップ（LOW CUT → EQ 3バンド → コンプ → サイドチェイン → フェーダー → パン）→ マスターバス
                                                       └→ センド（REV / DLY）→ 共有リターン → マスターバス
   マスターバス → バスコンプ → DRIVE → リミッター → 出力。
   配線は buildChain() にまとめてあり、ライブ再生と WAV 書き出し（OfflineAudioContext）で同じ音になる。
   サイドチェインは、キックが鳴る時刻がシーケンサーでわかっているので、その瞬間にストリップの音量を自動で下げて再現する。 */
export interface Material { bpm: number; swing: number; acid: AcidParams; bars: BarData[]; srcs: Srcs }
export interface MixProj { demo: Strip[]; own: Strip[]; mDemo: Master; mOwn: Master; scRel: number; src: 'demo' | 'own'; sel: number }
export const STRK = [
  { name: 'KICK', col: '#ff5a1f' }, { name: 'CLAP', col: '#2f6bff' }, { name: 'C.HAT', col: '#e0a800' }, { name: 'O.HAT', col: '#17b26a' },
  { name: 'BASS', col: '#151515' }, { name: 'ACID', col: '#0e9a5a' }, { name: 'CHORD', col: '#5b7cff' },
];
const cpS = (a: Strip[]) => a.map(s => ({ ...s }));
const fmtDb = (v: number) => (v <= -40 ? '−∞' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1));
const fmtGr = (v: number) => v > -.05 ? '0.0' : '−' + Math.abs(v).toFixed(1);

/* ---------------- 配線 ---------------- */
interface StripNodes { inp: GainNode; hpf: BiquadFilterNode; lo: BiquadFilterNode; md: BiquadFilterNode; hi: BiquadFilterNode; comp: DynamicsCompressorNode; mk: GainNode;
  duck: GainNode; fad: GainNode; pan: StereoPannerNode; sR: GainNode; sD: GainNode }
interface Chain { G: Graph; S: StripNodes[]; MB: GainNode; out: GainNode; bc: DynamicsCompressorNode; drive: GainNode; lim: DynamicsCompressorNode; cPre: GainNode; cPost: GainNode;
  revHp: BiquadFilterNode; revRet: GainNode; dly: DelayNode; dlyRet: GainNode }
function buildChain(ac: BaseAudioContext, dest: AudioNode): Chain {
  const MB = ac.createGain();
  const bc = ac.createDynamicsCompressor(); bc.knee.value = 10; bc.attack.value = .03; bc.release.value = .2;
  const drive = ac.createGain();
  const lim = ac.createDynamicsCompressor(); lim.knee.value = 0; lim.attack.value = .001; lim.release.value = .08;
  const out = ac.createGain();
  // リミッターの後ろに「天井で必ず止める」クリッパー。ブラウザのコンプは完全には止めきれないため。
  // OFF のときは +18 dB まで余白をとって、実質効かないようにする（0 dB を超える音割れはメーターに出る）。
  const cPre = ac.createGain(), shp = ac.createWaveShaper(), cPost = ac.createGain();
  const curve = new Float32Array(2049); for (let k = 0; k < curve.length; k++) curve[k] = k / 1024 - 1; shp.curve = curve; shp.oversample = '4x';
  MB.connect(bc); bc.connect(drive); drive.connect(lim); lim.connect(cPre); cPre.connect(shp); shp.connect(cPost); cPost.connect(out); out.connect(dest);
  const G = makeGraph(ac, MB, 1);
  // 共有リターン：リバーブ（LOW CUT 付き）とディレイ（付点8分）
  const revIn = ac.createGain(), conv = ac.createConvolver(), revHp = ac.createBiquadFilter(), revRet = ac.createGain();
  conv.buffer = makeIR(ac, 2.4); revHp.type = 'highpass'; revHp.Q.value = .7;
  revIn.connect(conv); conv.connect(revHp); revHp.connect(revRet); revRet.connect(G.bus);
  const dlyIn = ac.createGain(), dly = ac.createDelay(2), fb = ac.createGain(), dlp = ac.createBiquadFilter(), dlyRet = ac.createGain();
  fb.gain.value = .42; dlp.type = 'lowpass'; dlp.frequency.value = 3200;
  dlyIn.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(dlyRet); dlyRet.connect(G.bus);
  const S = STRK.map((_, i) => {
    const inp = ac.createGain();
    const hpf = ac.createBiquadFilter(); hpf.type = 'highpass'; hpf.Q.value = .7;
    const lo = ac.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 120;
    const md = ac.createBiquadFilter(); md.type = 'peaking'; md.frequency.value = 1000; md.Q.value = .9;
    const hi = ac.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 6000;
    const comp = ac.createDynamicsCompressor(); comp.knee.value = 6; const mk = ac.createGain();
    const duck = ac.createGain(), fad = ac.createGain(), pan = ac.createStereoPanner(), sR = ac.createGain(), sD = ac.createGain();
    inp.connect(hpf); hpf.connect(lo); lo.connect(md); md.connect(hi); hi.connect(comp); comp.connect(mk); mk.connect(duck); duck.connect(fad); fad.connect(pan); pan.connect(G.bus);
    pan.connect(sR); sR.connect(revIn); pan.connect(sD); sD.connect(dlyIn);
    G.tg[i].disconnect(); G.tg[i].connect(inp); if (i === 6) G.tg[6].connect(G.dly);
    return { inp, hpf, lo, md, hi, comp, mk, duck, fad, pan, sR, sD };
  });
  return { G, S, MB, out, bc, drive, lim, cPre, cPost, revHp, revRet, dly, dlyRet };
}
function applyStripTo(C: Chain, i: number, e: Strip, aud: boolean, t: number){
  const n = C.S[i], sm = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, .015);
  sm(n.hpf.frequency, e.hpf); sm(n.lo.gain, e.low); sm(n.md.gain, e.mid); sm(n.hi.gain, e.high);
  sm(n.comp.threshold, e.cRat > 1.01 ? e.cThr : 0); sm(n.comp.ratio, Math.max(1, e.cRat)); sm(n.comp.attack, e.cAtk); sm(n.comp.release, e.cRel); sm(n.mk.gain, dbToGain(e.cRat > 1.01 ? e.cMk : 0));
  sm(n.fad.gain, aud && e.vol > -40 ? dbToGain(e.vol) : 0); sm(n.pan.pan, e.pan); sm(n.sR.gain, e.rev); sm(n.sD.gain, e.dly);
}
function applyMasterTo(C: Chain, m: Master, t: number){
  const sm = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, .015);
  sm(C.bc.threshold, m.bRat > 1.01 ? m.bThr : 0); sm(C.bc.ratio, Math.max(1, m.bRat));
  sm(C.drive.gain, dbToGain(m.limOn ? m.drive : 0));
  sm(C.lim.threshold, m.limOn ? m.ceil - .3 : 0); sm(C.lim.ratio, m.limOn ? 20 : 1);
  const cl = m.limOn ? dbToGain(m.ceil - .4) : 8; C.cPre.gain.setValueAtTime(1 / cl, t); C.cPost.gain.setValueAtTime(cl, t);
  sm(C.out.gain, 1); sm(C.revRet.gain, m.revRet); sm(C.revHp.frequency, m.revHpf); sm(C.dlyRet.gain, m.dlyRet);
}
/** キックの瞬間に、SC を上げたストリップの音量を下げる */
function duckAt(C: Chain, strips: Strip[], t: number, rel: number){
  for (let i = 1; i < 7; i++) { const sc = strips[i].sc; if (sc <= 0) continue; const g = C.S[i].duck.gain;
    g.setTargetAtTime(1 - sc * .92, t, .003); g.setTargetAtTime(1, t + .025, Math.max(rel, .02) / 3); }
}

export interface MixDeps {
  ctx: AudioContext; out: AudioNode; emit(e: any): void; save(m: MixProj): void; toast(s: string): void;
  saved?: any; reach(): number; ownSong(): Material | null;
}

export function createMix(D: MixDeps){
  const { ctx } = D;
  const R = (n: number) => D.reach() >= n;
  const M: MixProj = { demo: cpS(BAD_STRIPS), own: STRK.map(() => flatStrip()), mDemo: { ...DEF_MASTER }, mOwn: { ...DEF_MASTER }, scRel: .25, src: 'demo', sel: 0, ...(D.saved || {}) };
  const fix = (a: any[], def: Strip[]) => def.map((d, i) => ({ ...d, ...(a?.[i] || {}) }));
  M.demo = fix(M.demo, BAD_STRIPS); M.own = fix(M.own, STRK.map(() => flatStrip()));
  M.mDemo = { ...DEF_MASTER, ...(M.mDemo || {}) }; M.mOwn = { ...DEF_MASTER, ...(M.mOwn || {}) };
  const save = () => D.save(JSON.parse(JSON.stringify(M)));
  const strips = () => M.src === 'own' ? M.own : M.demo;
  const master = () => M.src === 'own' ? M.mOwn : M.mDemo;
  const before = () => M.src === 'own' ? STRK.map(() => flatStrip()) : BAD_STRIPS;
  let ab = false, abCount = 0, mono = false;
  const effS = (): Strip[] => ab ? before() : strips();
  const effM = (): Master => ab ? DEF_MASTER : master();

  /* ---- ライブの配線と計測 ---- */
  const noise = makeNoiseBuffer(ctx);
  const tap = ctx.createGain(), st = ctx.createGain(), mn = ctx.createGain();
  mn.channelCount = 1; mn.channelCountMode = 'explicit'; mn.channelInterpretation = 'speakers'; mn.gain.value = 0;
  tap.connect(st); tap.connect(mn); st.connect(D.out); mn.connect(D.out);
  const C = buildChain(ctx, tap);
  const mAn = ctx.createAnalyser(); mAn.fftSize = 4096; mAn.smoothingTimeConstant = .8; tap.connect(mAn);
  // ラウドネス用：K 特性（低域を削り、高域を少し持ち上げる）を通した音の二乗平均
  const kHp = ctx.createBiquadFilter(), kHs = ctx.createBiquadFilter(), kAn = ctx.createAnalyser();
  kHp.type = 'highpass'; kHp.frequency.value = 38; kHp.Q.value = .5; kHs.type = 'highshelf'; kHs.frequency.value = 1500; kHs.gain.value = 4; kAn.fftSize = 2048;
  tap.connect(kHp); kHp.connect(kHs); kHs.connect(kAn);
  const sAn = C.S.map(n => { const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = .8; n.fad.connect(an); return an; });
  const audible = (i: number) => { const s = strips(); return !s[i].mute && (!s.some(x => x.solo) || s[i].solo); };
  const applyStrip = (i: number) => applyStripTo(C, i, effS()[i], audible(i), ctx.currentTime);
  const applyAll = () => { STRK.forEach((_, i) => applyStrip(i)); applyMasterTo(C, effM(), ctx.currentTime); };
  function setMono(on: boolean){ mono = on; const t = ctx.currentTime; st.gain.setTargetAtTime(on ? 0 : 1, t, .01); mn.gain.setTargetAtTime(on ? 1 : 0, t, .01); }

  /* ---- 素材 ---- */
  let mat: Material = BAD_MIX as any;
  function loadMaterial(){
    if (M.src === 'own') { const m = D.ownSong(); if (m && m.bars.length) mat = m; else { D.toast('BEAT コースの曲が見つからないので、お手本を使います'); M.src = 'demo'; mat = BAD_MIX as any; } }
    else mat = BAD_MIX as any;
    C.dly.delayTime.setValueAtTime(3 * 60 / mat.bpm / 4, ctx.currentTime);
  }
  loadMaterial();

  /* ---- 再生 ---- */
  let playing = false, timer = 0, emitT = 0, nextT = 0, gstep = 0, loops = 0;
  let winPeak = -120, holdPeak = -120, clipT = 0, msRing: number[] = [], lufsS = -70;
  let grWin = new Array(7).fill(0), busGrWin = 0, limGrWin = 0;
  const sd = () => 60 / mat.bpm / 4;
  function tick(){
    const d = sd(), bars = mat.bars, srcs = mat.srcs || [];
    while (nextT < ctx.currentTime + .12) {
      const pos = gstep % 16, bar = Math.floor(gstep / 16) % bars.length, bd = bars[bar], tBar = nextT - pos * d;
      schedStep(ctx, C.G, noise, bd, pos, tBar, d, mat.swing, mat.acid, srcs);
      if (bd.d[0][pos] > 0) duckAt(C, effS(), tBar + pos * d, M.scRel);
      nextT += d; gstep++;
    }
  }
  function resetWin(){ winPeak = -120; grWin = new Array(7).fill(0); busGrWin = 0; limGrWin = 0; }
  function play(){
    if (ctx.state !== 'running') ctx.resume();
    playing = true; gstep = 0; loops = 0; resetWin(); msRing = []; nextT = ctx.currentTime + .06;
    tick(); timer = window.setInterval(tick, 25); emitT = window.setInterval(() => { D.emit(summary('mix')); resetWin(); }, 1000);
    setPlayBtn(); D.emit(summary('mix'));
  }
  function stop(){ playing = false; clearInterval(timer); clearInterval(emitT); setPlayBtn();
    C.S.forEach(n => { n.duck.gain.cancelScheduledValues(ctx.currentTime); n.duck.gain.setTargetAtTime(1, ctx.currentTime, .01); }); }
  const toggle = () => playing ? stop() : play();

  function summary(type: string, extra: any = {}){
    return { type, playing, loops, peak: winPeak, strips: cpS(strips()), master: { ...master() }, mono, ab, abCount, sel: M.sel, scRel: M.scRel, src: M.src,
      gr: [...grWin], busGr: busGrWin, limGr: limGrWin, lufs: lufsS, ...extra };
  }
  function edited(i?: number){ if (i == null) applyAll(); else applyStrip(i); save(); paint(); if (playing) D.emit(summary('mix')); else D.emit(summary('edit')); }

  /* ================= UI：MIXER ================= */
  const root = $('#m-mix');
  const lockWrap = (el: HTMLElement, n: number) => { el.dataset.lock = String(n); return el; };
  const allKnobs: any[] = [];
  const playBtn = h('button', { class: 'tbtn play', onclick: toggle }, '▶ PLAY');
  function setPlayBtn(){ playBtn.textContent = playing ? '■ STOP' : '▶ PLAY'; playBtn.classList.toggle('on', playing); playBtn.classList.toggle('play', !playing); }
  const bpmV = h('span', { class: 'iv' }, '');
  const srcBtns = (['demo', 'own'] as const).map(k => h('button', { onclick: () => { if (M.src === k) return; const was = playing; stop(); M.src = k; loadMaterial(); edited(); if (was) play(); } },
    k === 'demo' ? 'お手本（崩れたミックス）' : '自分の BEAT の曲'));
  const resetBtn = h('button', { class: 'ib', title: 'ミキサーとマスターを最初の状態に戻す', onclick: () => {
    if (M.src === 'own') { M.own = STRK.map(() => flatStrip()); M.mOwn = { ...DEF_MASTER }; } else { M.demo = cpS(BAD_STRIPS); M.mDemo = { ...DEF_MASTER }; }
    edited(); D.toast('ミキサーを最初の状態に戻しました'); } }, '↺ RESET');
  root.append(h('div', { class: 'tlbar' }, playBtn, h('span', { class: 'il' }, 'BPM'), bpmV, h('div', { class: 'seg bseg' }, ...srcBtns), h('span', { style: 'flex:1' }), resetBtn));

  const kn = (o: any, after: () => void) => { const el = createKnob({ small: true, ...o }) as any;
    el.addEventListener('pointerup', after); el.addEventListener('keyup', after); el.addEventListener('dblclick', () => setTimeout(after, 0)); allKnobs.push(el); return el; };
  const wrap = h('div', { class: 'mxstrips' });
  const ui = STRK.map((tr, i) => {
    const k = (key: keyof Strip, label: string, term: string, min: number, max: number, def: number, fmt: (v: number) => string, lock: number, log = false) =>
      lockWrap(kn({ label, term, get: () => strips()[i][key] as number, set: (v: number) => { (strips()[i] as any)[key] = v; applyStrip(i); save(); }, def, min, max, log, fmt, color: tr.col }, () => edited(i)), lock);
    const knobs = [
      k('hpf', 'LOW CUT', 'lowcut', 20, 1000, 20, v => v < 21 ? 'OFF' : Math.round(v) + ' Hz', 3, true),
      k('low', 'LOW', 'eq', -12, 12, 0, v => (v > 0 ? '+' : '') + v.toFixed(1), 3),
      k('mid', 'MID', 'eq', -12, 12, 0, v => (v > 0 ? '+' : '') + v.toFixed(1), 3),
      k('high', 'HIGH', 'eq', -12, 12, 0, v => (v > 0 ? '+' : '') + v.toFixed(1), 3),
      i ? k('sc', 'SC', 'sidechain', 0, 1, 0, v => Math.round(v * 100) + '%', 4) : lockWrap(h('div', { class: 'scsrc', title: 'サイドチェインのきっかけになる音' }, h('b', {}, 'SC'), h('span', {}, 'SOURCE')), 4),
      k('pan', 'PAN', 'pan', -1, 1, 0, v => Math.abs(v) < .02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100), 2),
    ];
    const name = h('button', { class: 'mxname', onclick: () => { M.sel = i; edited(); } }, h('i', { style: `background:${tr.col}` }), tr.name);
    const flags = h('div', { class: 'mxflags mono' });
    const meter = h('div', { class: 'mxmeter' }, h('i', {}));
    const thumb = h('div', { class: 'fthumb' });
    const fader = h('div', { class: 'fader', 'data-term': 'fader', title: 'ドラッグで音量（ダブルクリックで 0 dB）' }, h('div', { class: 'f0' }), thumb);
    const dbv = h('div', { class: 'mxdb mono' }, '');
    fader.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault(); try { fader.setPointerCapture(e.pointerId); } catch (_) {}
      const r = fader.getBoundingClientRect();
      const set = (ev: PointerEvent) => { const p = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); strips()[i].vol = Math.round((-40 + p * 46) * 2) / 2; applyStrip(i); paintStrip(i); };
      set(e);
      const up = () => { fader.removeEventListener('pointermove', set); fader.removeEventListener('pointerup', up); fader.removeEventListener('pointercancel', up); edited(i); };
      fader.addEventListener('pointermove', set); fader.addEventListener('pointerup', up); fader.addEventListener('pointercancel', up);
    });
    fader.addEventListener('dblclick', () => { strips()[i].vol = 0; edited(i); });
    const msb = (key: 'mute' | 'solo', lab: string) => h('button', { class: 'ms', 'data-term': key, onclick: () => { strips()[i][key] = !strips()[i][key]; edited(); } }, lab);
    const mb = msb('mute', 'M'), sb = msb('solo', 'S');
    wrap.append(h('div', { class: 'mxs' }, name, flags, h('div', { class: 'mxknobs' }, ...knobs), h('div', { class: 'mxfad' }, meter, fader), dbv, h('div', { class: 'bms' }, mb, sb)));
    return { knobs, meter: meter.firstChild as HTMLElement, thumb, dbv, mb, sb, name, flags };
  });
  root.append(wrap);
  function paintStrip(i: number){
    const s = strips()[i], u = ui[i];
    u.thumb.style.bottom = `calc(${(s.vol + 40) / 46 * 100}% - 7px)`; u.dbv.textContent = fmtDb(s.vol) + ' dB';
    u.mb.classList.toggle('m', s.mute); u.sb.classList.toggle('s', s.solo); u.name.classList.toggle('sel', M.sel === i);
    u.flags.innerHTML = ''; if (s.cRat > 1.01) u.flags.append(h('span', { class: 'fl c' }, 'COMP')); if (s.rev > 0) u.flags.append(h('span', { class: 'fl r' }, 'REV')); if (s.dly > 0) u.flags.append(h('span', { class: 'fl d' }, 'DLY'));
  }

  /* ================= UI：STRIP DETAIL（コンプとセンド） ================= */
  const droot = $('#m-det');
  const dName = h('span', { class: 'dname mono' }, '');
  const sk = (key: keyof Strip, label: string, term: string, min: number, max: number, def: number, fmt: (v: number) => string, log = false, color = 'var(--ink)') =>
    kn({ label, term, get: () => strips()[M.sel][key] as number, set: (v: number) => { (strips()[M.sel] as any)[key] = v; applyStrip(M.sel); save(); }, def, min, max, log, fmt, color }, () => edited(M.sel));
  const grBar = h('div', { class: 'grbar' }, h('i', {})), grV = h('span', { class: 'iv' }, '0.0');
  const compSec = lockWrap(h('div', { class: 'dsec' }, h('div', { class: 'dhead' }, h('span', { class: 'il', 'data-term': 'compressor' }, 'COMP'),
      h('span', { class: 'hint' }, 'RATIO 1:1 のときは効きません')),
    h('div', { class: 'krow dk' },
      sk('cThr', 'THRESH', 'threshold', -48, 0, 0, v => v.toFixed(1) + ' dB'),
      sk('cRat', 'RATIO', 'ratio', 1, 20, 1, v => v < 1.05 ? '1:1' : v.toFixed(1) + ':1', true),
      sk('cAtk', 'ATTACK', 'attack', .001, .1, .01, v => (v * 1000).toFixed(v < .01 ? 1 : 0) + ' ms', true),
      sk('cRel', 'RELEASE', 'release', .03, 1, .15, v => Math.round(v * 1000) + ' ms', true),
      sk('cMk', 'MAKEUP', 'makeup', 0, 18, 0, v => '+' + v.toFixed(1) + ' dB')),
    h('div', { class: 'grrow' }, h('span', { class: 'il', 'data-term': 'gainreduction' }, 'GR'), grBar, grV, h('span', { class: 'il' }, 'dB'))), 5);
  const sendSec = lockWrap(h('div', { class: 'dsec' }, h('div', { class: 'dhead' }, h('span', { class: 'il', 'data-term': 'send' }, 'SEND'), h('span', { class: 'hint' }, '共有のリバーブ／ディレイへ送る量')),
    h('div', { class: 'krow dk' }, sk('rev', 'REV', 'reverb', 0, 1, 0, v => Math.round(v * 100) + '%', false, 'var(--blue)'), sk('dly', 'DLY', 'delay', 0, 1, 0, v => Math.round(v * 100) + '%', false, 'var(--green)'))), 6);
  droot.append(h('div', { class: 'tlbar' }, h('span', { class: 'il' }, 'TRACK'), dName, h('span', { class: 'hint' }, 'MIXER のトラック名をクリックで切り替え')), h('div', { class: 'dgrid' }, compSec, sendSec));

  /* ================= UI：SPECTRUM と MASTER ================= */
  const sroot = $('#m-spec');
  const cv = h('canvas', { class: 'mxspec' }) as HTMLCanvasElement;
  const peakV = h('div', { class: 'mxpeak mono' }, '−∞');
  const clip = h('span', { class: 'mxclip' }, 'CLIP');
  const pbar = h('div', { class: 'mxpbar' }, h('i', {}), h('b', {}));
  const lufsV = h('span', { class: 'mxlufs mono' }, '−∞');
  const monoBtn = lockWrap(h('button', { class: 'ib', 'data-term': 'mono', onclick: () => { setMono(!mono); paint(); if (playing) D.emit(summary('mix')); } }, 'MONO'), 2);
  const abBtn = h('button', { class: 'ib abbtn', title: '直す前（BEFORE）と今（AFTER）を聞き比べる', onclick: () => { ab = !ab; abCount++; applyAll(); paint(); if (playing) D.emit(summary('mix')); } }, '');
  const relKnob = lockWrap(kn({ label: 'SC RELEASE', term: 'release', get: () => M.scRel, set: (v: number) => { M.scRel = v; save(); }, def: .25, min: .03, max: .8, log: true,
    fmt: (v: number) => Math.round(v * 1000) + ' ms', color: 'var(--ink)' }, () => edited()), 4);
  const mk = (key: keyof Master, label: string, term: string, min: number, max: number, def: number, fmt: (v: number) => string, log = false, color = 'var(--ink)') =>
    kn({ label, term, get: () => master()[key] as number, set: (v: number) => { (master() as any)[key] = v; applyMasterTo(C, effM(), ctx.currentTime); save(); }, def, min, max, log, fmt, color }, () => edited());
  const retSec = lockWrap(h('div', { class: 'msec' }, h('span', { class: 'il', 'data-term': 'returnbus' }, 'RETURN'),
    mk('revRet', 'REV', 'reverb', 0, 1.2, .8, v => Math.round(v * 100) + '%', false, 'var(--blue)'),
    mk('revHpf', 'REV LOW CUT', 'lowcut', 20, 1000, 20, v => v < 21 ? 'OFF' : Math.round(v) + ' Hz', true, 'var(--blue)'),
    mk('dlyRet', 'DLY', 'delay', 0, 1.2, .7, v => Math.round(v * 100) + '%', false, 'var(--green)')), 6);
  const busGrV = h('span', { class: 'iv' }, '0.0'), limGrV = h('span', { class: 'iv' }, '0.0');
  const limBtn = h('button', { class: 'ib', 'data-term': 'limiter', onclick: () => { master().limOn = !master().limOn; edited(); } }, '');
  const wavBtn = h('button', { class: 'tbtn play', 'data-term': 'wav', onclick: () => exportWav() }, '⇩ WAV');
  const wStat = h('span', { class: 'bstat mono' }, '');
  const busSec = lockWrap(h('div', { class: 'msec' }, h('span', { class: 'il', 'data-term': 'buscomp' }, 'BUS COMP'),
    mk('bThr', 'THRESH', 'threshold', -30, 0, -12, v => v.toFixed(1) + ' dB'), mk('bRat', 'RATIO', 'ratio', 1, 8, 1, v => v < 1.05 ? '1:1' : v.toFixed(1) + ':1', true),
    h('span', { class: 'il' }, 'GR'), busGrV), 7);
  const limSec = lockWrap(h('div', { class: 'msec' }, h('span', { class: 'il', 'data-term': 'limiter' }, 'LIMITER'), limBtn,
    mk('ceil', 'CEILING', 'ceiling', -6, 0, -1, v => v.toFixed(1) + ' dB'), mk('drive', 'DRIVE', 'limiter', 0, 18, 0, v => '+' + v.toFixed(1) + ' dB', false, 'var(--orange)'),
    h('span', { class: 'il' }, 'GR'), limGrV), 7);
  sroot.append(h('div', { class: 'mxspecwrap' }, cv, h('div', { class: 'mxlegend mono' }, h('span', { class: 'lg m' }, 'MASTER'), h('span', { class: 'lg t' }, ''))),
    h('div', { class: 'mxmaster' },
      h('div', { class: 'mxpk' }, h('span', { class: 'il', 'data-term': 'peak' }, 'PEAK'), peakV, clip),
      pbar, h('div', { class: 'mxmb' }, abBtn, monoBtn, relKnob)),
    lockWrap(h('div', { class: 'mxlrow' }, h('span', { class: 'il', 'data-term': 'loudness' }, 'LOUDNESS'), lufsV, h('span', { class: 'il' }, 'LUFS（直近3秒）'),
      h('span', { class: 'hint' }, '目安：配信 −14 ／ クラブ向けテクノ −10 〜 −7')), 7),
    h('div', { class: 'mxrack' }, retSec, busSec, limSec),
    lockWrap(h('div', { class: 'mxexp' }, wavBtn, wStat), 7));

  /* ---- メーターとスペクトラム ---- */
  const tbuf = new Float32Array(4096), fbuf = new Float32Array(2048), kbuf = new Float32Array(2048);
  const peakOf = (an: AnalyserNode) => { an.getFloatTimeDomainData(tbuf); let m = 0; for (let k = 0; k < an.fftSize; k++) { const v = Math.abs(tbuf[k]); if (v > m) m = v; } return m > 0 ? 20 * Math.log10(m) : -120; };
  function drawSpec(){
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, hh = cv.clientHeight; if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    const fx = (f: number) => Math.log(f / 20) / Math.log(1000) * w, fy = (db: number) => clamp((-db - 12) / 84, 0, 1) * hh;
    c.fillStyle = 'rgba(21,21,21,.04)'; c.fillRect(0, 0, fx(250), hh); c.fillStyle = 'rgba(21,21,21,.02)'; c.fillRect(fx(4000), 0, w - fx(4000), hh);
    c.strokeStyle = '#d8d7d0'; c.lineWidth = 1; c.font = '9px IBM Plex Mono, monospace'; c.fillStyle = '#9a9991';
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(f => { const x = fx(f); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); c.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 2, hh - 4); });
    c.fillText('LOW', 4, 11); c.fillText('MID', fx(900), 11); c.fillText('HIGH', fx(6000), 11);
    const curve = (an: AnalyserNode, fill: string | null, stroke: string, lw: number) => {
      an.getFloatFrequencyData(fbuf); const ny = ctx.sampleRate / 2, n = an.frequencyBinCount;
      c.beginPath(); let started = false;
      for (let px = 0; px <= w; px += 2) { const f = 20 * Math.pow(1000, px / w), k = Math.min(n - 1, Math.round(f / ny * n)); const y = fy(fbuf[k]);
        if (!started) { c.moveTo(px, y); started = true; } else c.lineTo(px, y); }
      if (fill) { c.lineTo(w, hh); c.lineTo(0, hh); c.closePath(); c.fillStyle = fill; c.fill(); }
      else { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
    };
    curve(mAn, 'rgba(21,21,21,.12)', '', 0);
    if (M.sel !== 0 && audible(0)) curve(sAn[0], null, 'rgba(255,90,31,.55)', 1.2);
    curve(sAn[M.sel], null, STRK[M.sel].col, 2);
  }
  const grSet = (el: HTMLElement, v: number) => { el.textContent = fmtGr(v); };
  function frame(){
    requestAnimationFrame(frame);
    if (document.body.dataset.course !== 'mix') return;
    const pk = peakOf(mAn), now = performance.now();
    holdPeak = Math.max(pk, holdPeak - .4);
    if (pk > 0) clipT = now;
    // ラウドネス（直近3秒の K 特性二乗平均）
    kAn.getFloatTimeDomainData(kbuf); let ms = 0; for (let k = 0; k < kbuf.length; k++) ms += kbuf[k] * kbuf[k]; ms /= kbuf.length;
    msRing.push(ms); if (msRing.length > 180) msRing.shift();
    const avg = msRing.reduce((a, b) => a + b, 0) / msRing.length;
    lufsS = avg > 1e-9 ? -0.691 + 10 * Math.log10(avg * 2) : -70;
    const grs = C.S.map(n => n.comp.reduction), bgr = C.bc.reduction, lgr = C.lim.reduction;
    if (playing) { winPeak = Math.max(winPeak, pk); grs.forEach((g, i) => grWin[i] = Math.min(grWin[i], g)); busGrWin = Math.min(busGrWin, bgr); limGrWin = Math.min(limGrWin, lgr); }
    peakV.textContent = holdPeak <= -60 ? '−∞' : (holdPeak > 0 ? '+' : '') + holdPeak.toFixed(1) + ' dB';
    peakV.classList.toggle('over', holdPeak > 0);
    clip.classList.toggle('on', now - clipT < 1200);
    const pp = clamp((holdPeak + 48) / 54, 0, 1);
    (pbar.firstChild as HTMLElement).style.width = pp * 100 + '%'; (pbar.firstChild as HTMLElement).classList.toggle('over', holdPeak > 0);
    sAn.forEach((an, i) => { const p = peakOf(an); ui[i].meter.style.height = clamp((p + 48) / 54, 0, 1) * 100 + '%'; ui[i].meter.classList.toggle('over', p > 0); });
    lufsV.textContent = lufsS <= -60 ? '−∞' : lufsS.toFixed(1);
    const g = grs[M.sel]; (grBar.firstChild as HTMLElement).style.width = clamp(-g / 24, 0, 1) * 100 + '%'; grSet(grV, g);
    grSet(busGrV, bgr); grSet(limGrV, lgr);
    drawSpec();
  }
  requestAnimationFrame(frame);
  (pbar.lastChild as HTMLElement).style.left = (48 / 54 * 100) + '%';

  /* ---- WAV 書き出し（同じ配線を OfflineAudioContext に組んで計算） ---- */
  async function exportWav(){
    const d = sd(), sr = 44100, reps = M.src === 'demo' ? 2 : 1, nb = mat.bars.length * reps, tail = 1.6;
    const len = nb * 16 * d + tail;
    const OAC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const off = new OAC(2, Math.ceil(len * sr), sr);
    const OC = buildChain(off, off.destination), es = effS(), em = effM(), aud = STRK.map((_, i) => audible(i));
    es.forEach((s, i) => applyStripTo(OC, i, s, aud[i], 0)); applyMasterTo(OC, em, 0);
    OC.dly.delayTime.setValueAtTime(3 * d, 0);
    const noiseO = makeNoiseBuffer(off);
    for (let b = 0; b < nb; b++) { const bd = mat.bars[b % mat.bars.length];
      for (let s = 0; s < 16; s++) { schedStep(off, OC.G, noiseO, bd, s, b * 16 * d, d, mat.swing, mat.acid, mat.srcs || []); if (bd.d[0][s] > 0) duckAt(OC, es, (b * 16 + s) * d, M.scRel); } }
    wStat.textContent = 'RENDERING…';
    const buf = await off.startRendering();
    let pk = 0; for (let ch = 0; ch < 2; ch++) { const a = buf.getChannelData(ch); for (let k = 0; k < a.length; k++) pk = Math.max(pk, Math.abs(a[k])); }
    const wavPeak = 20 * Math.log10(pk || 1e-9);
    // ラウドネス（ファイル全体）：K 特性を通してもう一度計算
    const off2 = new OAC(2, buf.length, sr), src = off2.createBufferSource(); src.buffer = buf;
    const h1 = off2.createBiquadFilter(), h2 = off2.createBiquadFilter(); h1.type = 'highpass'; h1.frequency.value = 38; h1.Q.value = .5; h2.type = 'highshelf'; h2.frequency.value = 1500; h2.gain.value = 4;
    src.connect(h1); h1.connect(h2); h2.connect(off2.destination); src.start();
    const kb = await off2.startRendering(); let sum = 0; for (let ch = 0; ch < 2; ch++) { const a = kb.getChannelData(ch); let s2 = 0; for (let k = 0; k < a.length; k++) s2 += a[k] * a[k]; sum += s2 / a.length; }
    const wavLufs = sum > 1e-12 ? -0.691 + 10 * Math.log10(sum) : -70;
    const url = URL.createObjectURL(toWav(buf)); const dt = new Date(), z = (n: number) => String(n).padStart(2, '0');
    const a = h('a', { href: url, download: `otolab-mix-${dt.getFullYear()}${z(dt.getMonth() + 1)}${z(dt.getDate())}-${z(dt.getHours())}${z(dt.getMinutes())}.wav` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    wStat.textContent = `⇩ ${nb} 小節 / ${len.toFixed(1)} s / PEAK ${(wavPeak > 0 ? '+' : '') + wavPeak.toFixed(1)} dB / ${wavLufs.toFixed(1)} LUFS`;
    wStat.classList.toggle('over', wavPeak > 0);
    D.toast('WAV を書き出しました');
    D.emit(summary('wav', { wavPeak, wavLufs }));
  }

  function paint(){
    bpmV.textContent = String(mat.bpm);
    srcBtns.forEach((b, k) => b.classList.toggle('on', (k ? 'own' : 'demo') === M.src));
    STRK.forEach((_, i) => paintStrip(i));
    allKnobs.forEach(k => k.sync && k.sync());
    abBtn.textContent = ab ? 'A/B: BEFORE' : 'A/B: AFTER'; abBtn.classList.toggle('on', ab);
    (monoBtn as HTMLElement).classList.toggle('on', mono);
    limBtn.textContent = master().limOn ? 'ON' : 'OFF'; limBtn.classList.toggle('on', master().limOn);
    dName.textContent = STRK[M.sel].name; dName.style.color = STRK[M.sel].col;
    ($('.lg.t', sroot) as HTMLElement).textContent = STRK[M.sel].name; ($('.lg.t', sroot) as HTMLElement).style.color = STRK[M.sel].col;
  }
  function applyLocks(){
    $$('[data-lock]', $('#mixRack')).forEach(el => { const n = +el.dataset.lock; el.classList.toggle('sublocked', !R(n)); el.title = R(n) ? '' : `M${String(n).padStart(2, '0')} で解放`; });
    droot.classList.toggle('locked', !R(5));
    paint();
  }
  applyAll(); paint();
  return { toggle, stop, paint, applyLocks, isPlaying: () => playing, json: () => ({ app: 'otolab-mix', v: 2, ...JSON.parse(JSON.stringify(M)) }) };
}
