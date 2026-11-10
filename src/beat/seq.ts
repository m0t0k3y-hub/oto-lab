import { $, $$, h } from '../ui/dom';
import { clamp, dbToGain } from '../util';
import { createKnob } from '../ui/knob';
import { makeNoiseBuffer } from '../audio/engine';
import { drum, type DrumKind } from '../audio/drums';
import { toWav } from '../audio/wav';
import { SAMPLE_BEAT, type Pat, type BeatDemo } from '../data/beatChapters';

/* ================= BEAT コース：ステップシーケンサー =================
   4トラック × 16ステップ × パターン A/B。CHAIN で A→A→A→B のようにつなげる。
   再生は「先読みスケジューリング」：25ms ごとに少し先までの音を予約するので、
   描画が重くなってもリズムがよれない。 */
export interface BeatProj {
  bpm: number; swing: number; pats: Pat[]; cur: number; chain: number[]; mode: 'pat' | 'chain';
  mute: boolean[]; solo: boolean[];
}
export const TRK = [
  { name: 'KICK', col: 'var(--orange)' }, { name: 'CLAP', col: 'var(--blue)' },
  { name: 'C.HAT', col: 'var(--yellow)' }, { name: 'O.HAT', col: 'var(--green)' },
];
const PNAME = ['A', 'B'];
const cp = (p: Pat): Pat => p.map(r => [...r]);
const empty = (): Pat => [0, 1, 2, 3].map(() => new Array(16).fill(0));
export const sampleProj = (): BeatProj => ({ bpm: SAMPLE_BEAT.bpm, swing: SAMPLE_BEAT.swing, pats: [cp(SAMPLE_BEAT.pat), empty()], cur: 0,
  chain: [0, -1, -1, -1], mode: 'pat', mute: [false, false, false, false], solo: [false, false, false, false] });
const onSets = (p: Pat) => p.map(r => r.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0));

export interface BeatDeps {
  ctx: AudioContext; out: AudioNode;
  emit(e: any): void; save(bp: BeatProj): void; toast(s: string): void;
  saved?: BeatProj; reach(): number; ghost(): Record<number, number[]> | null;
}

export function createBeat(D: BeatDeps){
  const { ctx } = D;
  const B: BeatProj = { ...sampleProj(), ...(D.saved || {}) };
  B.pats = (B.pats || []).slice(0, 2).map(p => [0, 1, 2, 3].map(i => Array.from({ length: 16 }, (_, s) => clamp(+(p?.[i]?.[s]) || 0, 0, 1))));
  while (B.pats.length < 2) B.pats.push(empty());
  const noise = makeNoiseBuffer(ctx);
  const bus = ctx.createGain(); bus.gain.value = .9; bus.connect(D.out);
  const tg = TRK.map(() => { const g = ctx.createGain(); g.connect(bus); return g; });
  const save = () => D.save(JSON.parse(JSON.stringify(B)));

  /* ---- ミュート／ソロ ---- */
  const audible = (i: number) => !B.mute[i] && (!B.solo.some(Boolean) || B.solo[i]);
  function updateMix(){ tg.forEach((g, i) => g.gain.setTargetAtTime(audible(i) ? 1 : 0, ctx.currentTime, .005)); }
  updateMix();

  /* ---- 再生 ---- */
  let playing = false, lastPos = -1, timer = 0, nextT = 0, gstep = 0, loops = 0, hiSwing = false, abBypass = false;
  let queue: { t: number; pos: number; bar: number; pi: number }[] = [];
  const stepDur = () => 60 / B.bpm / 4;
  const playList = () => B.mode === 'chain' ? (B.chain.filter(x => x >= 0).length ? B.chain.filter(x => x >= 0) : [B.cur]) : [B.cur];
  const swingOf = () => abBypass ? .5 : B.swing;
  const swingOff = (pos: number, sd: number, sw: number) => pos % 2 ? (sw - .5) * 2 * sd : 0;
  function tick(){
    const sd = stepDur(), list = playList();
    while (nextT < ctx.currentTime + .12) {
      const pos = gstep % 16, bar = Math.floor(gstep / 16) % list.length, pi = list[bar];
      const t = nextT + swingOff(pos, sd, swingOf());
      for (let i = 0; i < 4; i++) { const v = B.pats[pi][i][pos]; if (v > 0) drum(ctx, tg[i], noise, i as DrumKind, t, v); }
      queue.push({ t, pos, bar, pi });
      nextT += sd; gstep++;
    }
  }
  function play(){
    stopDemo(); if (ctx.state !== 'running') ctx.resume();
    playing = true; gstep = 0; loops = 0; lastPos = -1; queue = []; nextT = ctx.currentTime + .06;
    tick(); timer = window.setInterval(tick, 25);
    if (B.swing >= .7) hiSwing = true;
    setPlayBtn(); D.emit(summary('seq')); requestAnimationFrame(vis);
  }
  function stop(){ playing = false; clearInterval(timer); queue = []; setPlayBtn(); paintHead(-1, -1); }
  const toggle = () => playing ? stop() : play();
  function vis(){
    if (!playing) return;
    const now = ctx.currentTime;
    while (queue.length && queue[0].t <= now) {
      const q = queue.shift();
      if (q.pos === 0 && q.bar === 0 && lastPos >= 0) { loops++; D.emit(summary('seq')); }
      lastPos = q.pos; paintHead(q.pos, q.pi);
      $$('.bchain .slot').forEach((s, i) => s.classList.toggle('ph', B.mode === 'chain' && chainIndexAt(q.bar) === i));
    }
    requestAnimationFrame(vis);
  }
  const chainIndexAt = (bar: number) => { let k = -1; for (let i = 0; i < 4; i++) { if (B.chain[i] >= 0) k++; if (k === bar) return i; } return -1; };

  /* ---- お手本（決まった小節数をまとめて予約して鳴らす） ---- */
  let demoBus: GainNode | null = null;
  function stopDemo(){ if (demoBus) { const g = demoBus; g.gain.setTargetAtTime(0, ctx.currentTime, .01); setTimeout(() => g.disconnect(), 200); demoBus = null; } }
  function demo(d: BeatDemo){
    if (playing) stop(); stopDemo(); if (ctx.state !== 'running') ctx.resume();
    const g = ctx.createGain(); g.gain.value = .9; g.connect(D.out); demoBus = g;
    const sd = 60 / d.bpm / 4, t0 = ctx.currentTime + .06, sw = d.swing || .5;
    for (let b = 0; b < d.bars; b++) { const p = d.seq[b % d.seq.length];
      for (let s = 0; s < 16; s++) { const t = t0 + (b * 16 + s) * sd + swingOff(s, sd, sw);
        for (let i = 0; i < 4; i++) { const v = p[i][s]; if (v > 0) drum(ctx, g, noise, i as DrumKind, t, v); } } }
  }

  /* ---- 判定に渡す状態 ---- */
  function summary(type: string, extra: any = {}){
    const A = onSets(B.pats[0]), Bb = onSets(B.pats[1]);
    return { type, loops, bpm: B.bpm, swing: B.swing, mode: B.mode, cur: B.cur, chain: [...B.chain],
      P: onSets(B.pats[B.cur]), V: cp(B.pats[B.cur]), A, B: Bb, mute: [...B.mute], solo: [...B.solo], hiSwing, playing, ...extra };
  }
  function edited(){ save(); paint(); D.emit(summary('edit')); if (playing) D.emit(summary('seq')); }

  /* ================= UI ================= */
  const root = $('#m-seq');
  const R = (n: number) => D.reach() >= n;
  // 上段：トランスポート
  const playBtn = h('button', { class: 'tbtn play', onclick: toggle }, '▶ PLAY');
  function setPlayBtn(){ playBtn.textContent = playing ? '■ STOP' : '▶ PLAY'; playBtn.classList.toggle('on', playing); playBtn.classList.toggle('play', !playing); }
  const bpmKnob = createKnob({ small: true, label: 'BPM', term: 'bpm', get: () => B.bpm, set: v => { B.bpm = Math.round(v); save(); }, def: 124, min: 60, max: 180, fmt: v => String(Math.round(v)), color: 'var(--ink)' }) as any;
  bpmKnob.addEventListener('pointerup', () => { if (playing) D.emit(summary('seq')); });
  bpmKnob.addEventListener('keyup', () => { if (playing) D.emit(summary('seq')); });
  let taps: number[] = [];
  const tapV = h('span', { class: 'iv', style: 'min-width:46px' }, '—');
  const tapBtn = h('button', { class: 'ib tap', 'data-term': 'taptempo', onpointerdown: (e: any) => { e.preventDefault();
    const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; taps.push(now); taps = taps.slice(-8);
    tapBtn.classList.add('hit'); setTimeout(() => tapBtn.classList.remove('hit'), 90);
    if (taps.length >= 4) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); const bpm = Math.round(60000 / iv);
      if (bpm >= 60 && bpm <= 180) { tapV.textContent = bpm + ''; B.bpm = bpm; bpmKnob.sync(); save(); D.emit(summary('tap', { bpm })); } }
    else tapV.textContent = 'あと' + (4 - taps.length);
  } }, 'TAP');
  const swingKnob = createKnob({ small: true, label: 'SWING', term: 'swing', get: () => B.swing, set: v => { B.swing = v; if (v >= .7 && playing) hiSwing = true; save(); }, def: .5, min: .5, max: .75, fmt: v => Math.round(v * 100) + '%', color: 'var(--orange)' }) as any;
  swingKnob.addEventListener('pointerup', () => { if (playing) D.emit(summary('seq')); });
  swingKnob.addEventListener('keyup', () => { if (playing) D.emit(summary('seq')); });
  const abBtn = h('button', { class: 'ib', title: 'スウィングあり／なしを聞き比べる', onclick: () => { abBypass = !abBypass; abBtn.textContent = abBypass ? 'A/B: SWING OFF' : 'A/B: SWING ON'; abBtn.classList.toggle('on', abBypass); } }, 'A/B: SWING ON');
  const stat = h('span', { class: 'bstat mono' }, '');
  const sampleBtn = h('button', { class: 'ib', onclick: () => { backup = JSON.stringify(B); Object.assign(B, sampleProj()); updateMix(); bpmKnob.sync(); swingKnob.sync(); restoreBtn.hidden = false; edited(); D.toast('お手本ループを読み込みました'); } }, 'お手本ループ');
  let backup: string | null = null;
  const restoreBtn = h('button', { class: 'ib', hidden: true, onclick: () => { if (backup) { Object.assign(B, JSON.parse(backup)); backup = null; updateMix(); bpmKnob.sync(); swingKnob.sync(); edited(); } restoreBtn.hidden = true; } }, '↺ 元に戻す');
  const clearBtn = h('button', { class: 'ib', onclick: () => { backup = JSON.stringify(B); B.pats[B.cur] = empty(); restoreBtn.hidden = false; edited(); D.toast(`PATTERN ${PNAME[B.cur]} を消去しました（↺ で戻せます）`); } }, 'CLEAR');
  const lockWrap = (el: HTMLElement, n: number) => { el.dataset.lock = String(n); return el; };
  const tapGrp = lockWrap(h('div', { class: 'bgrp' }, tapBtn, tapV), 4);
  const grvGrp = lockWrap(h('div', { class: 'bgrp' }, swingKnob, abBtn), 5);
  root.append(h('div', { class: 'tlbar' }, playBtn, bpmKnob, tapGrp, grvGrp, h('span', { style: 'flex:1' }), sampleBtn, restoreBtn, clearBtn));

  // グリッド
  const grid = h('div', { class: 'bgrid' });
  const cells: HTMLElement[][] = [];
  const heads: HTMLElement[] = [];
  TRK.forEach((tr, i) => {
    const ms = (k: 'mute' | 'solo', lab: string, term: string) => h('button', { class: 'ms', 'data-term': term, onclick: () => { B[k][i] = !B[k][i]; updateMix(); paint(); edited(); } }, lab);
    const head = h('div', { class: 'bhead' }, h('span', { class: 'bname' }, h('i', { style: `background:${tr.col}` }), tr.name), h('span', { class: 'bms' }, ms('mute', 'M', 'mute'), ms('solo', 'S', 'solo')));
    heads.push(head);
    const row = h('div', { class: 'bsteps' }); row.style.setProperty('--tc', tr.col);
    cells[i] = [];
    for (let s = 0; s < 16; s++) {
      const c = h('div', { class: 'bc' + (Math.floor(s / 4) % 2 ? ' g4' : '') }, h('i', {}));
      bindCell(c, i, s); cells[i].push(c); row.append(c);
    }
    grid.append(head, row);
  });
  const ruler = h('div', { class: 'bsteps bruler' }); for (let s = 0; s < 16; s++) ruler.append(h('span', { class: s % 4 === 0 ? 'bar' : '' }, String(s + 1)));
  grid.append(h('div', { class: 'bhead bhint mono' }, 'STEP'), ruler);
  root.append(grid);

  function bindCell(c: HTMLElement, tr: number, s: number){
    c.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (_) {}
      const p = B.pats[B.cur], v0 = p[tr][s], y0 = e.clientY; let moved = false, created = false;
      if (v0 === 0) { p[tr][s] = 1; created = true; if (!playing) { if (ctx.state !== 'running') ctx.resume(); drum(ctx, tg[tr], noise, tr as DrumKind, ctx.currentTime + .005, 1); } paint(); }
      const start = p[tr][s];
      const mv = (ev: PointerEvent) => { if (!R(5)) return; const dy = y0 - ev.clientY; if (Math.abs(dy) > 4) moved = true;
        if (moved) { p[tr][s] = clamp(Math.round((start + dy / 90) * 20) / 20, .1, 1); paint(); stat.textContent = `${TRK[tr].name} ${s + 1}  VEL ${Math.round(p[tr][s] * 100)}%`; } };
      const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
        if (!moved && !created) p[tr][s] = 0;
        if (moved && !playing) drum(ctx, tg[tr], noise, tr as DrumKind, ctx.currentTime + .005, p[tr][s]);
        edited(); };
      c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    });
  }

  // パターン／チェーン／書き出し
  const patBtns = PNAME.map((n, i) => h('button', { onclick: () => { B.cur = i; edited(); } }, n));
  const copyBuf: { p: Pat | null } = { p: null };
  const slots = [0, 1, 2, 3].map(i => h('button', { class: 'slot', title: 'クリックで — → A → B を切り替え', onclick: () => { B.chain[i] = B.chain[i] >= 1 ? -1 : B.chain[i] + 1; edited(); } }, '—'));
  const modeBtns = (['pat', 'chain'] as const).map(m => h('button', { 'data-term': m === 'chain' ? 'chain' : 'pattern', onclick: () => { B.mode = m; edited(); } }, m === 'pat' ? 'PATTERN' : 'CHAIN'));
  const wavBtn = h('button', { class: 'tbtn play', 'data-term': 'wav', onclick: () => exportWav() }, '⇩ WAV');
  const rStat = h('span', { class: 'bstat mono' }, '');
  const patRow = lockWrap(h('div', { class: 'bpat' },
    h('span', { class: 'il', 'data-term': 'pattern' }, 'PATTERN'), h('div', { class: 'seg bseg' }, ...patBtns),
    h('button', { class: 'ib', onclick: () => { copyBuf.p = cp(B.pats[B.cur]); D.toast(`PATTERN ${PNAME[B.cur]} をコピーしました`); } }, 'COPY'),
    h('button', { class: 'ib', onclick: () => { if (!copyBuf.p) { D.toast('先に COPY してください'); return; } B.pats[B.cur] = cp(copyBuf.p); edited(); } }, 'PASTE'),
    h('span', { class: 'il', 'data-term': 'chain', style: 'margin-left:8px' }, 'CHAIN'), h('div', { class: 'bchain' }, ...slots),
    h('span', { class: 'il', style: 'margin-left:8px' }, 'MODE'), h('div', { class: 'seg bseg' }, ...modeBtns),
    h('span', { style: 'flex:1' }), wavBtn), 6);
  root.append(patRow, h('div', { class: 'bfoot' }, stat, rStat));

  /* ---- 描画 ---- */
  let headPos = -1, headPi = -1;
  function paintHead(pos: number, pi: number){ headPos = pos; headPi = pi;
    cells.forEach(r => r.forEach((c, s) => c.classList.toggle('ph', s === pos && pi === B.cur))); }
  function paint(){
    const p = B.pats[B.cur], gh = D.ghost() || {};
    cells.forEach((r, i) => r.forEach((c, s) => { const v = p[i][s];
      c.classList.toggle('on', v > 0); c.classList.toggle('gh', !!(gh[i] && gh[i].includes(s)) && v === 0);
      (c.firstChild as HTMLElement).style.height = (v * 100) + '%'; c.title = v > 0 ? `VEL ${Math.round(v * 100)}%` : ''; }));
    heads.forEach((hd, i) => { const [m, s] = $$('.ms', hd); m.classList.toggle('m', B.mute[i]); s.classList.toggle('s', B.solo[i]); });
    patBtns.forEach((b, i) => b.classList.toggle('on', B.cur === i));
    modeBtns.forEach(b => b.classList.toggle('on', (b.textContent === 'CHAIN') === (B.mode === 'chain')));
    slots.forEach((b, i) => { b.textContent = B.chain[i] >= 0 ? PNAME[B.chain[i]] : '—'; b.classList.toggle('set', B.chain[i] >= 0); });
    paintHead(headPos, headPi);
    if (!stat.textContent || !stat.textContent.includes('VEL')) stat.textContent = R(5) ? '光っているマスを上下にドラッグで強さ（ベロシティ）を変更' : 'マスをクリックで ON／OFF';
  }
  function applyLocks(){
    $$('[data-lock]', root).forEach(el => { const n = +el.dataset.lock; el.classList.toggle('sublocked', !R(n)); el.title = R(n) ? '' : `B${String(n).padStart(2, '0')} で解放`; });
    if (!R(6) && B.cur !== 0) { B.cur = 0; }
    if (!R(6)) B.mode = 'pat';
    paint();
  }

  /* ---- WAV 書き出し ---- */
  async function exportWav(){
    const list = playList(), bars = B.mode === 'chain' ? list.length : 4, sr = 44100, sd = stepDur();
    const used = TRK.map((_, i) => list.some(pi => B.pats[pi][i].some(v => v > 0)) && audible(i));
    if (!used.some(Boolean)) { D.toast('鳴らす音がありません'); return; }
    const len = bars * 16 * sd;
    const OAC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const off = new OAC(2, Math.ceil(len * sr), sr);
    const nb = makeNoiseBuffer(off), mg = off.createGain(); mg.gain.value = .9; mg.connect(off.destination);
    const sw = B.swing;
    for (let b = 0; b < bars; b++) { const pi = list[b % list.length];
      for (let s = 0; s < 16; s++) { const t = (b * 16 + s) * sd + swingOff(s, sd, sw);
        for (let i = 0; i < 4; i++) { const v = B.pats[pi][i][s]; if (v > 0 && audible(i)) drum(off, mg, nb, i as DrumKind, t, v); } } }
    rStat.textContent = 'RENDERING…';
    const buf = await off.startRendering();
    let pk = 0; for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
    const rawDb = 20 * Math.log10(pk || 1e-9);
    if (pk > 0) { const g = dbToGain(-1) / pk; for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= g; } }
    const url = URL.createObjectURL(toWav(buf)); const d = new Date(), z = (n: number) => String(n).padStart(2, '0');
    const a = h('a', { href: url, download: `otolab-beat-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.wav` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    rStat.textContent = `⇩ ${bars} 小節 / ${len.toFixed(2)} s / PEAK ${rawDb.toFixed(1)} dB → −1.0 dB にノーマライズ`;
    const velVar = list.some(pi => B.pats[pi].some(r => r.some(v => v > 0 && v < .95)));
    D.toast('WAV を書き出しました');
    D.emit(summary('wav', { used, velVar, bars }));
  }

  paint();
  return {
    toggle, stop, demo, paint, applyLocks, isPlaying: () => playing,
    json: () => ({ app: 'otolab-beat', v: 1, ...JSON.parse(JSON.stringify(B)) }),
  };
}
