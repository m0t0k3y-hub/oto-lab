import { $, $$, h } from '../ui/dom';
import { clamp, dbToGain } from '../util';
import { createKnob } from '../ui/knob';
import { makeNoiseBuffer } from '../audio/engine';
import { makeGraph, schedStep, type BarData, type Srcs } from '../beat/engine';
import type { AcidParams } from '../audio/synth';
import { BAD_MIX, BAD_STRIPS, flatStrip, type Strip } from '../data/mixChapters';

/* ================= MIX コース：ミキサー =================
   BEAT と同じ7トラックを、チャンネルストリップ（LOW CUT → EQ 3バンド → サイドチェイン → フェーダー → パン）に通して混ぜる。
   サイドチェインは、キックが鳴る時刻がシーケンサーでわかっているので、その瞬間にストリップの音量を自動で下げて再現する。 */
export interface Material { bpm: number; swing: number; acid: AcidParams; bars: BarData[]; srcs: Srcs }
export interface MixProj { demo: Strip[]; own: Strip[]; scRel: number; src: 'demo' | 'own'; sel: number }
export const STRK = [
  { name: 'KICK', col: '#ff5a1f' }, { name: 'CLAP', col: '#2f6bff' }, { name: 'C.HAT', col: '#e0a800' }, { name: 'O.HAT', col: '#17b26a' },
  { name: 'BASS', col: '#151515' }, { name: 'ACID', col: '#0e9a5a' }, { name: 'CHORD', col: '#5b7cff' },
];
const cpS = (a: Strip[]) => a.map(s => ({ ...s }));
const fmtDb = (v: number) => (v <= -40 ? '−∞' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1));

export interface MixDeps {
  ctx: AudioContext; out: AudioNode; emit(e: any): void; save(m: MixProj): void; toast(s: string): void;
  saved?: any; reach(): number; ownSong(): Material | null;
}

export function createMix(D: MixDeps){
  const { ctx } = D;
  const R = (n: number) => D.reach() >= n;
  const M: MixProj = { demo: cpS(BAD_STRIPS), own: STRK.map(() => flatStrip()), scRel: .25, src: 'demo', sel: 0, ...(D.saved || {}) };
  const fix = (a: any[], def: Strip[]) => def.map((d, i) => ({ ...d, ...(a?.[i] || {}) }));
  M.demo = fix(M.demo, BAD_STRIPS); M.own = fix(M.own, STRK.map(() => flatStrip()));
  const save = () => D.save(JSON.parse(JSON.stringify(M)));
  const strips = () => M.src === 'own' ? M.own : M.demo;
  const before = () => M.src === 'own' ? STRK.map(() => flatStrip()) : BAD_STRIPS;
  let ab = false, abCount = 0, mono = false;
  const eff = (i: number) => ab ? before()[i] : strips()[i];

  /* ---- 配線 ---- */
  const noise = makeNoiseBuffer(ctx);
  const MB = ctx.createGain();                       // マスターバス（メーターはここで測る：リミッターの前）
  const st = ctx.createGain(), mn = ctx.createGain();
  mn.channelCount = 1; mn.channelCountMode = 'explicit'; mn.channelInterpretation = 'speakers'; mn.gain.value = 0;
  MB.connect(st); MB.connect(mn); st.connect(D.out); mn.connect(D.out);
  const mAn = ctx.createAnalyser(); mAn.fftSize = 4096; mAn.smoothingTimeConstant = .8; MB.connect(mAn);
  const G = makeGraph(ctx, MB, 1);
  const S = STRK.map((_, i) => {
    const inp = ctx.createGain();
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.Q.value = .7;
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 120;
    const md = ctx.createBiquadFilter(); md.type = 'peaking'; md.frequency.value = 1000; md.Q.value = .9;
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 6000;
    const duck = ctx.createGain(), fad = ctx.createGain(), pan = ctx.createStereoPanner();
    const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = .8;
    inp.connect(hpf); hpf.connect(lo); lo.connect(md); md.connect(hi); hi.connect(duck); duck.connect(fad); fad.connect(pan); pan.connect(G.bus); fad.connect(an);
    G.tg[i].disconnect(); G.tg[i].connect(inp); if (i === 6) G.tg[6].connect(G.dly);
    return { inp, hpf, lo, md, hi, duck, fad, pan, an };
  });
  const audible = (i: number) => { const s = strips(); return !s[i].mute && (!s.some(x => x.solo) || s[i].solo); };
  function applyStrip(i: number){
    const e = eff(i), n = S[i], t = ctx.currentTime, sm = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, .015);
    sm(n.hpf.frequency, e.hpf); sm(n.lo.gain, e.low); sm(n.md.gain, e.mid); sm(n.hi.gain, e.high);
    sm(n.fad.gain, audible(i) ? dbToGain(e.vol) * (e.vol <= -40 ? 0 : 1) : 0); sm(n.pan.pan, e.pan);
  }
  const applyAll = () => STRK.forEach((_, i) => applyStrip(i));
  function setMono(on: boolean){ mono = on; const t = ctx.currentTime; st.gain.setTargetAtTime(on ? 0 : 1, t, .01); mn.gain.setTargetAtTime(on ? 1 : 0, t, .01); }

  /* ---- 素材 ---- */
  let mat: Material = BAD_MIX as any;
  function loadMaterial(){
    if (M.src === 'own') { const m = D.ownSong(); if (m && m.bars.length) mat = m; else { D.toast('BEAT コースの曲が見つからないので、お手本を使います'); M.src = 'demo'; mat = BAD_MIX as any; } }
    else mat = BAD_MIX as any;
  }
  loadMaterial();

  /* ---- 再生 ---- */
  let playing = false, timer = 0, emitT = 0, nextT = 0, gstep = 0, loops = 0, winPeak = -120, holdPeak = -120, clipT = 0;
  let queue: { t: number; pos: number; bar: number }[] = [];
  const sd = () => 60 / mat.bpm / 4;
  function tick(){
    const d = sd(), bars = mat.bars, srcs = mat.srcs || [];
    while (nextT < ctx.currentTime + .12) {
      const pos = gstep % 16, bar = Math.floor(gstep / 16) % bars.length, bd = bars[bar];
      const tBar = nextT - pos * d;
      schedStep(ctx, G, noise, bd, pos, tBar, d, mat.swing, mat.acid, srcs);
      if (bd.d[0][pos] > 0) { const t = tBar + pos * d; // キックの瞬間に、SC を上げたストリップの音量を下げる
        for (let i = 1; i < 7; i++) { const sc = eff(i).sc; if (sc <= 0) continue; const g = S[i].duck.gain;
          g.setTargetAtTime(1 - sc * .92, t, .003); g.setTargetAtTime(1, t + .025, Math.max(M.scRel, .02) / 3); } }
      queue.push({ t: nextT, pos, bar }); nextT += d; gstep++;
    }
  }
  function play(){
    if (ctx.state !== 'running') ctx.resume();
    playing = true; gstep = 0; loops = 0; queue = []; winPeak = -120; nextT = ctx.currentTime + .06;
    tick(); timer = window.setInterval(tick, 25); emitT = window.setInterval(() => { D.emit(summary('mix')); winPeak = -120; }, 1000);
    setPlayBtn(); D.emit(summary('mix'));
  }
  function stop(){ playing = false; clearInterval(timer); clearInterval(emitT); queue = []; setPlayBtn(); S.forEach(n => { n.duck.gain.cancelScheduledValues(ctx.currentTime); n.duck.gain.setTargetAtTime(1, ctx.currentTime, .01); }); }
  const toggle = () => playing ? stop() : play();

  function summary(type: string){
    return { type, playing, loops, peak: winPeak, strips: cpS(strips()), mono, ab, abCount, sel: M.sel, scRel: M.scRel, src: M.src };
  }
  function edited(i?: number){ if (i == null) applyAll(); else applyStrip(i); save(); paint(); if (playing) D.emit(summary('mix')); else D.emit(summary('edit')); }

  /* ================= UI：MIXER ================= */
  const root = $('#m-mix');
  const lockWrap = (el: HTMLElement, n: number) => { el.dataset.lock = String(n); return el; };
  const playBtn = h('button', { class: 'tbtn play', onclick: toggle }, '▶ PLAY');
  function setPlayBtn(){ playBtn.textContent = playing ? '■ STOP' : '▶ PLAY'; playBtn.classList.toggle('on', playing); playBtn.classList.toggle('play', !playing); }
  const bpmV = h('span', { class: 'iv' }, '');
  const srcBtns = (['demo', 'own'] as const).map(k => h('button', { onclick: () => { if (M.src === k) return; const was = playing; stop(); M.src = k; loadMaterial(); edited(); if (was) play(); } },
    k === 'demo' ? 'お手本（崩れたミックス）' : '自分の BEAT の曲'));
  const resetBtn = h('button', { class: 'ib', title: 'ミキサーを最初の状態に戻す', onclick: () => { if (M.src === 'own') M.own = STRK.map(() => flatStrip()); else M.demo = cpS(BAD_STRIPS); edited(); D.toast('ミキサーを最初の状態に戻しました'); } }, '↺ RESET');
  root.append(h('div', { class: 'tlbar' }, playBtn, h('span', { class: 'il' }, 'BPM'), bpmV, h('div', { class: 'seg bseg' }, ...srcBtns), h('span', { style: 'flex:1' }), resetBtn));

  const wrap = h('div', { class: 'mxstrips' });
  const ui = STRK.map((tr, i) => {
    const k = (key: keyof Strip, label: string, term: string, min: number, max: number, def: number, fmt: (v: number) => string, lock: number, log = false) =>
      lockWrap(createKnob({ small: true, label, term, get: () => strips()[i][key] as number, set: v => { (strips()[i] as any)[key] = v; applyStrip(i); save(); },
        def, min, max, log, fmt, color: tr.col }) as any, lock);
    const knobs = [
      k('hpf', 'LOW CUT', 'lowcut', 20, 1000, 20, v => v < 21 ? 'OFF' : Math.round(v) + ' Hz', 3, true),
      k('low', 'LOW', 'eq', -12, 12, 0, v => (v > 0 ? '+' : '') + v.toFixed(1), 3),
      k('mid', 'MID', 'eq', -12, 12, 0, v => (v > 0 ? '+' : '') + v.toFixed(1), 3),
      k('high', 'HIGH', 'eq', -12, 12, 0, v => (v > 0 ? '+' : '') + v.toFixed(1), 3),
      i ? k('sc', 'SC', 'sidechain', 0, 1, 0, v => Math.round(v * 100) + '%', 4) : lockWrap(h('div', { class: 'scsrc', title: 'サイドチェインのきっかけになる音' }, h('b', {}, 'SC'), h('span', {}, 'SOURCE')), 4),
      k('pan', 'PAN', 'pan', -1, 1, 0, v => Math.abs(v) < .02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100), 2),
    ];
    knobs.forEach(el => { el.addEventListener('pointerup', () => edited(i)); el.addEventListener('keyup', () => edited(i)); el.addEventListener('dblclick', () => setTimeout(() => edited(i), 0)); });
    const name = h('button', { class: 'mxname', onclick: () => { M.sel = i; edited(); } }, h('i', { style: `background:${tr.col}` }), tr.name);
    const meter = h('div', { class: 'mxmeter' }, h('i', {}));
    const thumb = h('div', { class: 'fthumb' });
    const fader = h('div', { class: 'fader', 'data-term': 'fader', title: 'ドラッグで音量（ダブルクリックで 0 dB）' }, h('div', { class: 'f0' }), thumb);
    const dbv = h('div', { class: 'mxdb mono' }, '');
    const posOf = (v: number) => (v - -40) / 46;
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
    const el = h('div', { class: 'mxs' }, name, h('div', { class: 'mxknobs' }, ...knobs), h('div', { class: 'mxfad' }, meter, fader), dbv, h('div', { class: 'bms' }, mb, sb));
    wrap.append(el);
    return { el, knobs, meter: meter.firstChild as HTMLElement, thumb, dbv, mb, sb, name, posOf };
  });
  root.append(wrap);
  function paintStrip(i: number){
    const s = strips()[i], u = ui[i];
    u.thumb.style.bottom = `calc(${u.posOf(s.vol) * 100}% - 7px)`; u.dbv.textContent = fmtDb(s.vol) + ' dB';
    u.mb.classList.toggle('m', s.mute); u.sb.classList.toggle('s', s.solo); u.name.classList.toggle('sel', M.sel === i);
    u.knobs.forEach((k: any) => k.sync && k.sync());
  }

  /* ================= UI：SPECTRUM と MASTER ================= */
  const sroot = $('#m-spec');
  const cv = h('canvas', { class: 'mxspec' }) as HTMLCanvasElement;
  const peakV = h('div', { class: 'mxpeak mono' }, '−∞');
  const clip = h('span', { class: 'mxclip' }, 'CLIP');
  const pbar = h('div', { class: 'mxpbar' }, h('i', {}), h('b', {}));
  const monoBtn = lockWrap(h('button', { class: 'ib', 'data-term': 'mono', onclick: () => { setMono(!mono); paint(); if (playing) D.emit(summary('mix')); } }, 'MONO'), 2);
  const abBtn = h('button', { class: 'ib abbtn', title: '直す前（BEFORE）と今（AFTER）を聞き比べる', onclick: () => { ab = !ab; abCount++; applyAll(); paint(); if (playing) D.emit(summary('mix')); } }, '');
  const relKnob = lockWrap(createKnob({ small: true, label: 'SC RELEASE', term: 'release', get: () => M.scRel, set: v => { M.scRel = v; save(); }, def: .25, min: .03, max: .8, log: true,
    fmt: v => Math.round(v * 1000) + ' ms', color: 'var(--ink)' }) as any, 4);
  relKnob.addEventListener('pointerup', () => edited()); relKnob.addEventListener('keyup', () => edited());
  sroot.append(h('div', { class: 'mxspecwrap' }, cv, h('div', { class: 'mxlegend mono' }, h('span', { class: 'lg m' }, 'MASTER'), h('span', { class: 'lg t' }, ''))),
    h('div', { class: 'mxmaster' },
      h('div', { class: 'mxpk' }, h('span', { class: 'il', 'data-term': 'peak' }, 'PEAK'), peakV, clip),
      pbar, h('div', { class: 'mxmb' }, abBtn, monoBtn, relKnob)));

  /* ---- メーターとスペクトラム ---- */
  const tbuf = new Float32Array(4096), fbuf = new Float32Array(2048);
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
    if (M.sel !== 0 && audible(0)) curve(S[0].an, null, 'rgba(255,90,31,.55)', 1.2);
    curve(S[M.sel].an, null, STRK[M.sel].col, 2);
  }
  function frame(){
    requestAnimationFrame(frame);
    if (document.body.dataset.course !== 'mix') return;
    const pk = peakOf(mAn), now = performance.now();
    if (playing) winPeak = Math.max(winPeak, pk);
    holdPeak = Math.max(pk, holdPeak - .4);
    if (pk > 0) clipT = now;
    peakV.textContent = holdPeak <= -60 ? '−∞' : (holdPeak > 0 ? '+' : '') + holdPeak.toFixed(1) + ' dB';
    peakV.classList.toggle('over', holdPeak > 0);
    clip.classList.toggle('on', now - clipT < 1200);
    const pp = clamp((holdPeak + 48) / 54, 0, 1);
    (pbar.firstChild as HTMLElement).style.width = pp * 100 + '%'; (pbar.firstChild as HTMLElement).classList.toggle('over', holdPeak > 0);
    S.forEach((n, i) => { const p = peakOf(n.an); ui[i].meter.style.height = clamp((p + 48) / 54, 0, 1) * 100 + '%'; ui[i].meter.classList.toggle('over', p > 0); });
    drawSpec();
  }
  requestAnimationFrame(frame);
  (pbar.lastChild as HTMLElement).style.left = (48 / 54 * 100) + '%';

  function paint(){
    bpmV.textContent = String(mat.bpm);
    srcBtns.forEach((b, k) => b.classList.toggle('on', (k ? 'own' : 'demo') === M.src));
    STRK.forEach((_, i) => paintStrip(i));
    abBtn.textContent = ab ? 'A/B: BEFORE' : 'A/B: AFTER'; abBtn.classList.toggle('on', ab);
    (monoBtn as HTMLElement).classList.toggle('on', mono); (relKnob as any).sync();
    ($('.lg.t', sroot) as HTMLElement).textContent = STRK[M.sel].name; ($('.lg.t', sroot) as HTMLElement).style.color = STRK[M.sel].col;
  }
  function applyLocks(){
    $$('[data-lock]', $('#mixRack')).forEach(el => { const n = +el.dataset.lock; el.classList.toggle('sublocked', !R(n)); el.title = R(n) ? '' : `M${String(n).padStart(2, '0')} で解放`; });
    paint();
  }
  applyAll(); paint();
  return { toggle, stop, paint, applyLocks, isPlaying: () => playing, json: () => ({ app: 'otolab-mix', v: 1, ...JSON.parse(JSON.stringify(M)) }) };
}
