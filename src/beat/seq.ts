import { $, $$, h } from '../ui/dom';
import { clamp, dbToGain } from '../util';
import { createKnob } from '../ui/knob';
import { makeNoiseBuffer } from '../audio/engine';
import { drum, type DrumKind } from '../audio/drums';
import { bassNote, acidNote, chordNote, type AcidParams } from '../audio/synth';
import { toWav } from '../audio/wav';
import { SAMPLE_BEAT, type Pat, type BeatDemo } from '../data/beatChapters';
import { makeGraph, schedStep, toBar, emptyAuto, swingOff, type Note, type Auto, type BarData } from './engine';

/* ================= BEAT コース：シーケンサー =================
   ドラム4トラック（ステップ）＋ノート3トラック（ピアノロール）× パターン A〜D。
   CHAIN（4枠）と SONG（ブロックを並べるアレンジ）でパターンをつなげる。
   再生は「先読みスケジューリング」：25ms ごとに少し先までの音を予約するので、
   描画が重くなってもリズムがよれない。 */
export interface SongBlock { p: number; bars: number }
export interface BeatProj {
  bpm: number; swing: number; pats: Pat[]; notes: Note[][][]; auto: Auto[];
  acid: AcidParams; key: { root: number; lock: boolean }; song: SongBlock[];
  cur: number; chain: number[]; mode: 'pat' | 'chain' | 'song';
  mute: boolean[]; solo: boolean[];
  ntr: number; view: number[]; triad: boolean; autoT: 'acid' | 'master';
}
export const TRK = [
  { name: 'KICK', col: 'var(--orange)' }, { name: 'CLAP', col: 'var(--blue)' },
  { name: 'C.HAT', col: 'var(--yellow)' }, { name: 'O.HAT', col: 'var(--green)' },
];
export const NTRK = [
  { name: 'BASS', col: 'var(--ink)', lock: 7, term: 'bassline' },
  { name: 'ACID', col: 'var(--green)', lock: 8, term: 'acid' },
  { name: 'CHORD', col: 'var(--blue)', lock: 9, term: 'chord' },
];
const NP = 4, PNAME = ['A', 'B', 'C', 'D'];
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => NN[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const ROWS = 24, ROW_H = 15;
const DEF_VIEW = [24, 36, 48];
const cp = (p: Pat): Pat => p.map(r => [...r]);
const cpN = (n: Note[][]): Note[][] => n.map(t => t.map(x => ({ ...x })));
const empty = (): Pat => [0, 1, 2, 3].map(() => new Array(16).fill(0));
const emptyN = (): Note[][] => [[], [], []];
const DEF_ACID: AcidParams = { cut: .35, res: .6, env: .5, dec: .35 };
export const sampleProj = (): BeatProj => ({ bpm: SAMPLE_BEAT.bpm, swing: SAMPLE_BEAT.swing,
  pats: [cp(SAMPLE_BEAT.pat), empty(), empty(), empty()], notes: [0, 1, 2, 3].map(emptyN), auto: [0, 1, 2, 3].map(emptyAuto),
  acid: { ...DEF_ACID }, key: { root: 9, lock: false }, song: [],
  cur: 0, chain: [0, -1, -1, -1], mode: 'pat', mute: new Array(7).fill(false), solo: new Array(7).fill(false),
  ntr: 0, view: [...DEF_VIEW], triad: false, autoT: 'acid' });
const onSets = (p: Pat) => p.map(r => r.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0));

export interface BeatDeps {
  ctx: AudioContext; out: AudioNode;
  emit(e: any): void; save(bp: BeatProj): void; toast(s: string): void;
  saved?: any; reach(): number; ghost(): Record<number, number[]> | null;
  ghostN(): { t: number; notes: { s: number; n: number; len?: number }[] } | null;
}

/** 保存データを今の形式にそろえる（第1段階のデータもそのまま読める） */
function normalize(s: any): BeatProj {
  const d = sampleProj(), B: BeatProj = { ...d, ...(s || {}) };
  B.pats = s?.pats ? Array.from({ length: NP }, (_, pi) => [0, 1, 2, 3].map(i => Array.from({ length: 16 }, (_, k) => clamp(+(s.pats?.[pi]?.[i]?.[k]) || 0, 0, 1)))) : d.pats;
  B.notes = Array.from({ length: NP }, (_, pi) => [0, 1, 2].map(t => ((s?.notes?.[pi]?.[t]) || []).map((x: any) => ({ s: clamp(+x.s | 0, 0, 15), n: clamp(+x.n | 0, 12, 96), len: clamp(+x.len || 1, 1, 16), acc: !!x.acc, sl: !!x.sl }))));
  B.auto = Array.from({ length: NP }, (_, pi) => ({ ...emptyAuto(), ...(s?.auto?.[pi] || {}) }));
  B.acid = { ...DEF_ACID, ...(s?.acid || {}) }; B.key = { ...d.key, ...(s?.key || {}) };
  B.song = (s?.song || []).map((b: any) => ({ p: clamp(+b.p | 0, 0, NP - 1), bars: [1, 2, 4, 8].includes(+b.bars) ? +b.bars : 4 }));
  B.chain = [0, 1, 2, 3].map(i => s?.chain?.[i] ?? d.chain[i]);
  B.mute = Array.from({ length: 7 }, (_, i) => !!s?.mute?.[i]); B.solo = Array.from({ length: 7 }, (_, i) => !!s?.solo?.[i]);
  B.view = [0, 1, 2].map(i => s?.view?.[i] ?? DEF_VIEW[i]);
  return B;
}

export function createBeat(D: BeatDeps){
  const { ctx } = D;
  const B = normalize(D.saved);
  const noise = makeNoiseBuffer(ctx);
  const G = makeGraph(ctx, D.out);
  const save = () => D.save(JSON.parse(JSON.stringify(B)));
  const R = (n: number) => D.reach() >= n;
  const kickless = (pi: number) => B.pats[pi][0].every(v => v === 0);

  /* ---- ミュート／ソロ（0〜3 ドラム、4〜6 ノート） ---- */
  const audible = (i: number) => !B.mute[i] && (!B.solo.some(Boolean) || B.solo[i]);
  function updateMix(){ G.tg.forEach((g, i) => g.gain.setTargetAtTime(audible(i) ? 1 : 0, ctx.currentTime, .005)); }
  updateMix();

  /* ---- 再生 ---- */
  let playing = false, lastPos = -1, prevPi = -1, timer = 0, nextT = 0, gstep = 0, loops = 0, hiSwing = false, abBypass = false;
  let cutMin = 1, cutMax = 0;
  let queue: { t: number; pos: number; bar: number; pi: number }[] = [];
  const stepDur = () => 60 / B.bpm / 4;
  const songBars = (): number[] => B.song.flatMap(b => new Array(b.bars).fill(b.p));
  const playList = (): number[] => {
    if (B.mode === 'chain') { const c = B.chain.filter(x => x >= 0); return c.length ? c : [B.cur]; }
    if (B.mode === 'song') { const s = songBars(); return s.length ? s : [B.cur]; }
    return [B.cur];
  };
  const swingOf = () => abBypass ? .5 : B.swing;
  const barData = (pi: number): BarData => ({ d: B.pats[pi], n: B.notes[pi], au: B.auto[pi] });
  function tick(){
    const sd = stepDur(), list = playList();
    while (nextT < ctx.currentTime + .12) {
      const pos = gstep % 16, bar = Math.floor(gstep / 16) % list.length, pi = list[bar];
      schedStep(ctx, G, noise, barData(pi), pos, nextT - pos * sd, sd, swingOf(), B.acid);
      queue.push({ t: nextT + swingOff(pos, sd, swingOf()), pos, bar, pi });
      nextT += sd; gstep++;
    }
  }
  function play(){
    stopDemo(); if (ctx.state !== 'running') ctx.resume();
    playing = true; gstep = 0; loops = 0; lastPos = -1; prevPi = -1; queue = []; nextT = ctx.currentTime + .06;
    cutMin = cutMax = B.acid.cut;
    tick(); timer = window.setInterval(tick, 25);
    if (B.swing >= .7) hiSwing = true;
    setPlayBtn(); D.emit(summary('seq')); requestAnimationFrame(vis);
  }
  function stop(){ playing = false; clearInterval(timer); queue = []; setPlayBtn(); paintHead(-1, -1, -1);
    G.mlp.frequency.cancelScheduledValues(ctx.currentTime); G.mlp.frequency.setTargetAtTime(20000, ctx.currentTime, .02); }
  const toggle = () => playing ? stop() : play();
  function vis(){
    if (!playing) return;
    const now = ctx.currentTime;
    while (queue.length && queue[0].t <= now) {
      const q = queue.shift();
      if (q.pos === 0) {
        if (B.mode === 'song' && prevPi >= 0 && kickless(prevPi) && !kickless(q.pi)) D.emit(summary('drop'));
        prevPi = q.pi;
        if (q.bar === 0 && lastPos >= 0) { loops++; D.emit(summary('seq')); }
      }
      lastPos = q.pos; paintHead(q.pos, q.pi, q.bar);
    }
    requestAnimationFrame(vis);
  }
  const chainIndexAt = (bar: number) => { let k = -1; for (let i = 0; i < 4; i++) { if (B.chain[i] >= 0) k++; if (k === bar) return i; } return -1; };
  const songIndexAt = (bar: number) => { let acc = 0; for (let i = 0; i < B.song.length; i++) { acc += B.song[i].bars; if (bar < acc) return i; } return -1; };

  /* ---- お手本（決まった小節数をまとめて予約して鳴らす） ---- */
  let demoG: ReturnType<typeof makeGraph> | null = null;
  function stopDemo(){ if (demoG) { const g = demoG; g.bus.gain.setTargetAtTime(0, ctx.currentTime, .01); setTimeout(() => g.mlp.disconnect(), 250); demoG = null; } }
  function demo(d: BeatDemo & { acid?: Partial<AcidParams> }){
    if (playing) stop(); stopDemo(); if (ctx.state !== 'running') ctx.resume();
    const g = makeGraph(ctx, D.out); demoG = g;
    const sd = 60 / d.bpm / 4, t0 = ctx.currentTime + .06, sw = d.swing || .5, ap = { ...DEF_ACID, ...(d.acid || {}) };
    const bars = d.seq.map(toBar);
    for (let b = 0; b < d.bars; b++) { const bd = bars[b % bars.length];
      for (let s = 0; s < 16; s++) schedStep(ctx, g, noise, bd, s, t0 + b * 16 * sd, sd, sw, ap); }
  }

  /* ---- 判定に渡す状態 ---- */
  function summary(type: string, extra: any = {}){
    const D4 = B.pats.map(onSets);
    return { type, loops, bpm: B.bpm, swing: B.swing, mode: B.mode, cur: B.cur, chain: [...B.chain],
      P: D4[B.cur], V: cp(B.pats[B.cur]), A: D4[0], B: D4[1], D: D4,
      notes: B.notes.map(cpN), N: cpN(B.notes[B.cur]), auto: JSON.parse(JSON.stringify(B.auto)),
      acid: { ...B.acid }, key: { ...B.key }, song: B.song.map(b => ({ ...b })), songBars: songBars().length,
      acidSweep: cutMax - cutMin >= .35, mute: [...B.mute], solo: [...B.solo], hiSwing, playing, ...extra };
  }
  function edited(){ save(); paint(); D.emit(summary('edit')); if (playing) D.emit(summary('seq')); }

  /* ================= UI：SEQUENCER（ドラム） ================= */
  const root = $('#m-seq');
  const playBtn = h('button', { class: 'tbtn play', onclick: toggle }, '▶ PLAY');
  function setPlayBtn(){ playBtn.textContent = playing ? '■ STOP' : '▶ PLAY'; playBtn.classList.toggle('on', playing); playBtn.classList.toggle('play', !playing); }
  const reemit = (el: HTMLElement) => { el.addEventListener('pointerup', () => { if (playing) D.emit(summary('seq')); }); el.addEventListener('keyup', () => { if (playing) D.emit(summary('seq')); }); return el; };
  const bpmKnob = reemit(createKnob({ small: true, label: 'BPM', term: 'bpm', get: () => B.bpm, set: v => { B.bpm = Math.round(v); save(); }, def: 124, min: 60, max: 180, fmt: v => String(Math.round(v)), color: 'var(--ink)' })) as any;
  let taps: number[] = [];
  const tapV = h('span', { class: 'iv', style: 'min-width:46px' }, '—');
  const tapBtn = h('button', { class: 'ib tap', 'data-term': 'taptempo', onpointerdown: (e: any) => { e.preventDefault();
    const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; taps.push(now); taps = taps.slice(-8);
    tapBtn.classList.add('hit'); setTimeout(() => tapBtn.classList.remove('hit'), 90);
    if (taps.length >= 4) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); const bpm = Math.round(60000 / iv);
      if (bpm >= 60 && bpm <= 180) { tapV.textContent = bpm + ''; B.bpm = bpm; bpmKnob.sync(); save(); D.emit(summary('tap', { bpm })); } }
    else tapV.textContent = 'あと' + (4 - taps.length);
  } }, 'TAP');
  const swingKnob = reemit(createKnob({ small: true, label: 'SWING', term: 'swing', get: () => B.swing, set: v => { B.swing = v; if (v >= .7 && playing) hiSwing = true; save(); }, def: .5, min: .5, max: .75, fmt: v => Math.round(v * 100) + '%', color: 'var(--orange)' })) as any;
  const abBtn = h('button', { class: 'ib', title: 'スウィングあり／なしを聞き比べる', onclick: () => { abBypass = !abBypass; abBtn.textContent = abBypass ? 'A/B: SWING OFF' : 'A/B: SWING ON'; abBtn.classList.toggle('on', abBypass); } }, 'A/B: SWING ON');
  const stat = h('span', { class: 'bstat mono' }, '');
  let backup: string | null = null;
  const loadAll = (src: any) => { Object.assign(B, normalize(src)); updateMix(); syncKnobs(); };
  const sampleBtn = h('button', { class: 'ib', onclick: () => { backup = JSON.stringify(B); loadAll(sampleProj()); restoreBtn.hidden = false; edited(); D.toast('お手本ループを読み込みました'); } }, 'お手本ループ');
  const restoreBtn = h('button', { class: 'ib', hidden: true, onclick: () => { if (backup) { loadAll(JSON.parse(backup)); backup = null; edited(); } restoreBtn.hidden = true; } }, '↺ 元に戻す');
  const clearBtn = h('button', { class: 'ib', title: '今のパターンのドラムを消す', onclick: () => { backup = JSON.stringify(B); B.pats[B.cur] = empty(); restoreBtn.hidden = false; edited(); D.toast(`PATTERN ${PNAME[B.cur]} のドラムを消去しました（↺ で戻せます）`); } }, 'CLEAR');
  const lockWrap = (el: HTMLElement, n: number) => { el.dataset.lock = String(n); return el; };
  root.append(h('div', { class: 'tlbar' }, playBtn, bpmKnob, lockWrap(h('div', { class: 'bgrp' }, tapBtn, tapV), 4), lockWrap(h('div', { class: 'bgrp' }, swingKnob, abBtn), 5),
    h('span', { style: 'flex:1' }), sampleBtn, restoreBtn, clearBtn));

  const ms = (i: number, k: 'mute' | 'solo') => h('button', { class: 'ms', 'data-trk': i, 'data-k': k, 'data-term': k, onclick: () => { B[k][i] = !B[k][i]; updateMix(); edited(); } }, k === 'mute' ? 'M' : 'S');
  const grid = h('div', { class: 'bgrid' });
  const cells: HTMLElement[][] = [];
  TRK.forEach((tr, i) => {
    const head = h('div', { class: 'bhead' }, h('span', { class: 'bname' }, h('i', { style: `background:${tr.col}` }), tr.name), h('span', { class: 'bms' }, ms(i, 'mute'), ms(i, 'solo')));
    const row = h('div', { class: 'bsteps' }); row.style.setProperty('--tc', tr.col);
    cells[i] = [];
    for (let s = 0; s < 16; s++) { const c = h('div', { class: 'bc' + (Math.floor(s / 4) % 2 ? ' g4' : '') }, h('i', {})); bindCell(c, i, s); cells[i].push(c); row.append(c); }
    grid.append(head, row);
  });
  const ruler = h('div', { class: 'bsteps bruler' }); for (let s = 0; s < 16; s++) ruler.append(h('span', { class: s % 4 === 0 ? 'bar' : '' }, String(s + 1)));
  grid.append(h('div', { class: 'bhead bhint mono' }, 'STEP'), ruler);
  root.append(grid);

  function bindCell(c: HTMLElement, tr: number, s: number){
    c.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (_) {}
      const p = B.pats[B.cur], v0 = p[tr][s], y0 = e.clientY; let moved = false, created = false;
      if (v0 === 0) { p[tr][s] = 1; created = true; if (!playing) hit(tr, 1); paint(); }
      const start = p[tr][s];
      const mv = (ev: PointerEvent) => { if (!R(5)) return; const dy = y0 - ev.clientY; if (Math.abs(dy) > 4) moved = true;
        if (moved) { p[tr][s] = clamp(Math.round((start + dy / 90) * 20) / 20, .1, 1); paint(); stat.textContent = `${TRK[tr].name} ${s + 1}  VEL ${Math.round(p[tr][s] * 100)}%`; } };
      const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
        if (!moved && !created) p[tr][s] = 0;
        if (moved && !playing) hit(tr, p[tr][s]);
        edited(); };
      c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    });
  }
  const hit = (tr: number, v: number) => { if (ctx.state !== 'running') ctx.resume(); drum(ctx, G.tg[tr], noise, tr as DrumKind, ctx.currentTime + .005, v); };

  // パターン／チェーン／モード／書き出し
  let sel: Note | null = null;
  const patBtns = PNAME.map((n, i) => { const b = h('button', { onclick: () => { B.cur = i; sel = null; edited(); } }, n); if (i >= 2) lockWrap(b, 11); return b; });
  let copyBuf: { d: Pat; n: Note[][]; au: Auto } | null = null;
  const slots = [0, 1, 2, 3].map(i => h('button', { class: 'slot', title: 'クリックでパターンを切り替え', onclick: () => {
    const max = R(11) ? 3 : 1; B.chain[i] = B.chain[i] >= max ? -1 : B.chain[i] + 1; edited(); } }, '—'));
  const MODES = [['pat', 'PATTERN', 'pattern', 0], ['chain', 'CHAIN', 'chain', 0], ['song', 'SONG', 'arrangement', 11]] as const;
  const modeBtns = MODES.map(([m, lab, term, lk]) => { const b = h('button', { 'data-term': term, 'data-m': m, onclick: () => { B.mode = m; edited(); } }, lab); if (lk) lockWrap(b, lk); return b; });
  const wavBtn = h('button', { class: 'tbtn play', 'data-term': 'wav', onclick: () => exportWav() }, '⇩ WAV');
  const rStat = h('span', { class: 'bstat mono' }, '');
  const patRow = lockWrap(h('div', { class: 'bpat' },
    h('span', { class: 'il', 'data-term': 'pattern' }, 'PATTERN'), h('div', { class: 'seg bseg' }, ...patBtns),
    h('button', { class: 'ib', onclick: () => { copyBuf = { d: cp(B.pats[B.cur]), n: cpN(B.notes[B.cur]), au: JSON.parse(JSON.stringify(B.auto[B.cur])) }; D.toast(`PATTERN ${PNAME[B.cur]} をコピーしました`); } }, 'COPY'),
    h('button', { class: 'ib', onclick: () => { if (!copyBuf) { D.toast('先に COPY してください'); return; } B.pats[B.cur] = cp(copyBuf.d); B.notes[B.cur] = cpN(copyBuf.n); B.auto[B.cur] = JSON.parse(JSON.stringify(copyBuf.au)); sel = null; edited(); } }, 'PASTE'),
    h('span', { class: 'il', 'data-term': 'chain', style: 'margin-left:8px' }, 'CHAIN'), h('div', { class: 'bchain' }, ...slots),
    h('span', { class: 'il', style: 'margin-left:8px' }, 'MODE'), h('div', { class: 'seg bseg' }, ...modeBtns),
    h('span', { style: 'flex:1' }), wavBtn), 6);
  root.append(patRow, h('div', { class: 'bfoot' }, stat, rStat));

  /* ================= UI：PIANO ROLL ================= */
  const rollRoot = $('#m-roll');
  const inScale = (n: number) => MINOR.includes((((n - B.key.root) % 12) + 12) % 12);
  const ntBtns = NTRK.map((t, i) => lockWrap(h('button', { 'data-term': t.term, onclick: () => { B.ntr = i; sel = null; edited(); } }, h('i', { class: 'nsq', style: `background:${t.col}` }), t.name), t.lock));
  const nms = h('span', { class: 'bms' });
  const keyV = h('span', { class: 'iv note' }, '');
  const keyGrp = lockWrap(h('div', { class: 'bgrp' }, h('span', { class: 'il', 'data-term': 'key' }, 'KEY'),
    h('button', { class: 'ib', onclick: () => { B.key.root = (B.key.root + 11) % 12; edited(); } }, '◀'), keyV,
    h('button', { class: 'ib', onclick: () => { B.key.root = (B.key.root + 1) % 12; edited(); } }, '▶'), h('span', { class: 'il', 'data-term': 'scale' }, 'MINOR')), 9);
  const lockBtn = h('button', { class: 'ib', 'data-term': 'scale', onclick: () => { B.key.lock = !B.key.lock; edited(); } }, '');
  const triadBtn = h('button', { class: 'ib', 'data-term': 'chord', onclick: () => { B.triad = !B.triad; edited(); } }, '');
  const octDn = h('button', { class: 'ib', 'data-term': 'octave', onclick: () => { B.view[B.ntr] = Math.max(12, B.view[B.ntr] - 12); edited(); } }, 'OCT −');
  const octUp = h('button', { class: 'ib', 'data-term': 'octave', onclick: () => { B.view[B.ntr] = Math.min(72, B.view[B.ntr] + 12); edited(); } }, 'OCT ＋');
  const clrN = h('button', { class: 'ib', title: '今のトラック・パターンのノートを消す', onclick: () => { backup = JSON.stringify(B); B.notes[B.cur][B.ntr] = []; sel = null; restoreBtn.hidden = false; edited(); D.toast(`${NTRK[B.ntr].name}（PATTERN ${PNAME[B.cur]}）のノートを消去しました`); } }, 'CLEAR');
  rollRoot.append(h('div', { class: 'tlbar' }, h('div', { class: 'seg bseg ntseg' }, ...ntBtns), nms, keyGrp, lockWrap(lockBtn, 9), lockWrap(triadBtn, 9),
    h('span', { style: 'flex:1' }), octDn, octUp, clrN));
  const acidKnobs = ([['cut', 'CUTOFF', 'cutoff'], ['res', 'RESO', 'resonance'], ['env', 'ENV MOD', 'envmod'], ['dec', 'DECAY', 'decay']] as const).map(([k, lab, term]) =>
    reemit(createKnob({ small: true, label: lab, term, get: () => B.acid[k], set: v => { B.acid[k] = v; if (k === 'cut' && playing) { cutMin = Math.min(cutMin, v); cutMax = Math.max(cutMax, v); } save(); },
      def: DEF_ACID[k], min: 0, max: 1, fmt: v => Math.round(v * 100) + '%', color: 'var(--green)' })) as any);
  const acidRow = h('div', { class: 'acidrow' }, h('span', { class: 'il', 'data-term': 'acid' }, 'ACID'), ...acidKnobs);
  rollRoot.append(acidRow);
  const labels = h('div', { class: 'plabels' });
  const plane = h('div', { class: 'plane' });
  const phR = h('div', { class: 'pph' });
  rollRoot.append(h('div', { class: 'proll' }, labels, plane));
  const insp = h('div', { class: 'insp pinsp' });
  rollRoot.append(insp);

  // オートメーション
  const AT = ['acid', 'master'] as const;
  const autoBtns = AT.map(t => h('button', { onclick: () => { B.autoT = t; edited(); } }, t === 'acid' ? 'ACID CUTOFF' : 'MASTER FILTER'));
  const lane = h('div', { class: 'alane' });
  const abars = Array.from({ length: 16 }, (_, i) => { const c = h('div', { class: 'ab' + (Math.floor(i / 4) % 2 ? ' g4' : '') }, h('i', {})); lane.append(c); return c; });
  const autoOff = h('button', { class: 'ib', title: 'このパターンのオートメーションを消す', onclick: () => { B.auto[B.cur][B.autoT] = null; edited(); } }, 'OFF');
  const autoSec = lockWrap(h('div', { class: 'asec' }, h('div', { class: 'tlbar' }, h('span', { class: 'il', 'data-term': 'automation' }, 'AUTOMATION'), h('div', { class: 'seg bseg' }, ...autoBtns), autoOff,
    h('span', { class: 'bstat mono', style: 'margin-left:auto' }, 'バーを左右になぞって描く（パターンごと）')), lane), 10);
  rollRoot.append(autoSec);
  lane.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault(); try { lane.setPointerCapture(e.pointerId); } catch (_) {}
    const au = B.auto[B.cur]; if (!au[B.autoT]) au[B.autoT] = new Array(16).fill(B.autoT === 'acid' ? B.acid.cut : 1);
    const arr = au[B.autoT]; let last = -1;
    const put = (ev: PointerEvent) => { const r = lane.getBoundingClientRect(); const i = clamp(Math.floor((ev.clientX - r.left) / r.width * 16), 0, 15);
      const v = Math.round(clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) * 100) / 100;
      if (last >= 0 && Math.abs(i - last) > 1) { const a = Math.min(i, last), b = Math.max(i, last), va = arr[last]; for (let k = a + 1; k < b; k++) arr[k] = Math.round((va + (v - va) * (k - last) / (i - last)) * 100) / 100; }
      arr[i] = v; last = i; paintAuto(); };
    put(e);
    const up = () => { lane.removeEventListener('pointermove', put); lane.removeEventListener('pointerup', up); lane.removeEventListener('pointercancel', up); edited(); };
    lane.addEventListener('pointermove', put); lane.addEventListener('pointerup', up); lane.addEventListener('pointercancel', up);
  });

  // ノートの操作
  const notesT = () => B.notes[B.cur][B.ntr];
  const mono = () => B.ntr !== 2;
  function resolveOverlap(n: Note){ if (!mono()) return; B.notes[B.cur][B.ntr] = notesT().filter(q => q === n || q.s + q.len <= n.s || q.s >= n.s + n.len); }
  function preview(n: number, len = 1){ if (playing) return; if (ctx.state !== 'running') ctx.resume(); const t = ctx.currentTime + .005, sd = stepDur();
    if (B.ntr === 0) bassNote(ctx, G.tg[4], t, len * sd, n); else if (B.ntr === 1) acidNote(ctx, G.tg[5], t, len * sd * .82, n, B.acid); else chordNote(ctx, G.tg[6], t, len * sd, n); }
  function triadOf(n: number): number[] {
    if (!inScale(n)) return [n, n + 3, n + 7];
    const sc: number[] = []; for (let m = n; m < n + 24; m++) if (inScale(m)) sc.push(m);
    return [sc[0], sc[2], sc[4]];
  }
  const rowToNote = (row: number) => B.view[B.ntr] + ROWS - 1 - row;
  plane.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault(); try { plane.setPointerCapture(e.pointerId); } catch (_) {}
    const r = plane.getBoundingClientRect(), sw = r.width / 16;
    const sAt = (x: number) => clamp(Math.floor((x - r.left) / sw), 0, 15), rowAt = (y: number) => clamp(Math.floor((y - r.top) / ROW_H), 0, ROWS - 1);
    const el = (e.target as HTMLElement).closest('.pn') as any;
    let n: Note, mode: 'len' | 'move', wasSel = false, created = false, moved = false;
    const x0 = e.clientX, y0 = e.clientY;
    if (el && el._n) {
      n = el._n; wasSel = sel === n; sel = n;
      mode = e.clientX > el.getBoundingClientRect().right - Math.min(10, sw * .35) ? 'len' : 'move';
    } else {
      const s = sAt(e.clientX), m = rowToNote(rowAt(e.clientY));
      if (B.key.lock && !inScale(m)) { D.toast('スケールの外の音です（SCALE LOCK 中）'); return; }
      if (B.ntr === 2 && B.triad) {
        const ns = triadOf(m).map(k => ({ s, n: k, len: 2 }));
        B.notes[B.cur][2] = notesT().filter(q => !(q.s === s && ns.some(x => x.n === q.n)));
        notesT().push(...ns); ns.forEach(x => preview(x.n, 2)); sel = ns[0]; edited(); return;
      }
      n = { s, n: m, len: 1 }; notesT().push(n); resolveOverlap(n); sel = n; created = true; mode = 'len'; preview(m);
    }
    const s0 = n.s, n0 = n.n, l0 = n.len;
    renderRoll();
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      const ds = Math.round((ev.clientX - x0) / sw), dr = Math.round((ev.clientY - y0) / ROW_H);
      if (mode === 'len') n.len = clamp(l0 + ds, 1, 16 - n.s);
      else { n.s = clamp(s0 + ds, 0, 16 - n.len); const m = clamp(n0 - dr, 12, 96); if (m !== n.n && !(B.key.lock && !inScale(m))) { n.n = m; preview(m); } }
      renderRoll();
    };
    const up = () => { plane.removeEventListener('pointermove', mv); plane.removeEventListener('pointerup', up); plane.removeEventListener('pointercancel', up);
      if (!moved && !created) { if (wasSel) { B.notes[B.cur][B.ntr] = notesT().filter(q => q !== n); sel = null; } else preview(n.n, n.len); }
      else resolveOverlap(n);
      edited(); };
    plane.addEventListener('pointermove', mv); plane.addEventListener('pointerup', up); plane.addEventListener('pointercancel', up);
  });

  function renderInsp(){
    insp.innerHTML = '';
    if (!sel || !notesT().includes(sel)) { sel = null;
      insp.append(h('span', { class: 'hint' }, B.ntr === 2 && B.triad ? 'クリックで和音（3つの音）を置く ／ ノートをクリック → もう一度クリックで削除'
        : '空いているマスをクリック → ノートを置く（そのまま右へドラッグで長く）／ ドラッグで移動 ／ 右端をドラッグで長さ ／ 選んだノートをもう一度クリックで削除')); return; }
    const n = sel;
    insp.append(h('span', { class: 'il' }, 'NOTE'), h('span', { class: 'iv note' }, noteName(n.n)), h('span', { class: 'il' }, 'START'), h('span', { class: 'iv' }, String(n.s + 1)),
      h('span', { class: 'il', 'data-term': 'gate' }, 'LENGTH'), h('span', { class: 'iv' }, n.len + ' マス'));
    if (B.ntr === 1) {
      insp.append(lockWrap(h('button', { class: 'ib' + (n.acc ? ' on' : ''), 'data-term': 'accent', onclick: () => { n.acc = !n.acc; edited(); } }, 'ACCENT'), 8),
        lockWrap(h('button', { class: 'ib' + (n.sl ? ' on' : ''), 'data-term': 'slide', onclick: () => { n.sl = !n.sl; edited(); } }, 'SLIDE →'), 8));
    }
    insp.append(h('button', { class: 'ib del', onclick: () => { B.notes[B.cur][B.ntr] = notesT().filter(q => q !== n); sel = null; edited(); } }, 'DELETE'));
  }
  function renderRoll(){
    const base = B.view[B.ntr], col = NTRK[B.ntr].col;
    labels.innerHTML = ''; plane.innerHTML = '';
    plane.style.height = ROWS * ROW_H + 'px'; plane.style.setProperty('--tc', col);
    for (let r = 0; r < ROWS; r++) {
      const m = base + ROWS - 1 - r, pc = ((m % 12) + 12) % 12, isC = pc === 0, rootRow = ((m - B.key.root) % 12 + 12) % 12 === 0, ins = inScale(m);
      labels.append(h('div', { class: 'pl' + (isC ? ' c' : '') + (rootRow && R(9) ? ' root' : '') + (NN[pc].includes('#') ? ' blk' : '') }, noteName(m)));
      plane.append(h('div', { class: 'prow' + (R(9) && ins ? ' ins' : '') + (B.key.lock && !ins ? ' off' : '') + (NN[pc].includes('#') ? ' blk' : '') + (isC ? ' c' : ''), style: `top:${r * ROW_H}px;height:${ROW_H}px` }));
    }
    const gh = D.ghostN();
    if (gh && gh.t === B.ntr) gh.notes.forEach(g => { const r = base + ROWS - 1 - g.n; if (r < 0 || r >= ROWS) return;
      if (notesT().some(q => q.s === g.s && q.n === g.n)) return;
      plane.append(h('div', { class: 'pg', style: `left:${g.s / 16 * 100}%;width:${(g.len || 1) / 16 * 100}%;top:${r * ROW_H}px;height:${ROW_H}px` })); });
    for (const n of notesT()) {
      const r = base + ROWS - 1 - n.n; if (r < 0 || r >= ROWS) continue;
      const el = h('div', { class: 'pn' + (n === sel ? ' sel' : '') + (n.acc ? ' acc' : ''), style: `left:${n.s / 16 * 100}%;width:${n.len / 16 * 100}%;top:${r * ROW_H + 1}px;height:${ROW_H - 2}px` },
        n.sl ? h('span', { class: 'sl' }, '→') : null);
      el._n = n; plane.append(el);
    }
    const out = notesT().filter(n => { const r = base + ROWS - 1 - n.n; return r < 0 || r >= ROWS; }).length;
    if (out) plane.append(h('div', { class: 'pout' }, `表示範囲の外に ${out} 音（OCT ± で移動）`));
    plane.append(phR);
    renderInsp();
  }
  function paintAuto(){
    const arr = B.auto[B.cur][B.autoT];
    abars.forEach((c, i) => { (c.firstChild as HTMLElement).style.height = arr ? arr[i] * 100 + '%' : '0'; });
    lane.classList.toggle('off', !arr); lane.classList.toggle('master', B.autoT === 'master');
    autoBtns.forEach((b, i) => { b.classList.toggle('on', AT[i] === B.autoT); b.classList.toggle('has', !!B.auto[B.cur][AT[i]]); });
  }

  /* ================= UI：ARRANGE（SONG） ================= */
  const songRoot = $('#m-song');
  let songSel = -1;
  const songTot = h('span', { class: 'bstat mono' }, '');
  const strip = h('div', { class: 'sstrip' });
  const sctl = h('div', { class: 'insp sctl' });
  songRoot.append(h('div', { class: 'tlbar' },
    h('button', { class: 'tbtn', onclick: () => { if (B.song.length >= 16) { D.toast('ブロックは16個までです'); return; } B.song.push({ p: B.cur, bars: 4 }); songSel = B.song.length - 1; edited(); } }, '＋ ブロック追加（今のパターン）'),
    h('button', { class: 'ib', onclick: () => { if (!B.song.length) return; backup = JSON.stringify(B); B.song = []; songSel = -1; restoreBtn.hidden = false; edited(); } }, 'CLEAR'),
    h('span', { style: 'flex:1' }), songTot), strip, sctl);
  function renderSong(){
    strip.innerHTML = '';
    if (!B.song.length) strip.append(h('div', { class: 'hint sempty' }, '「＋ ブロック追加」で、今選んでいるパターンを4小節ぶん並べます。'));
    B.song.forEach((b, i) => {
      const brk = kickless(b.p);
      strip.append(h('button', { class: 'sblk' + (i === songSel ? ' sel' : '') + (brk ? ' brk' : ''), style: `flex-grow:${b.bars}`, onclick: () => { songSel = songSel === i ? -1 : i; renderSong(); } },
        h('b', {}, PNAME[b.p]), h('span', {}, '×' + b.bars), brk ? h('small', {}, 'NO KICK') : null));
    });
    const tb = songBars().length, sec = tb * 16 * stepDur();
    songTot.textContent = `合計 ${tb} 小節 / ${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
    sctl.innerHTML = '';
    if (songSel < 0 || !B.song[songSel]) { songSel = -1; sctl.append(h('span', { class: 'hint' }, 'ブロックをクリックで選択 → パターン・小節数・順番を変更。MODE を SONG にすると、この並びで再生・書き出しします。')); return; }
    const b = B.song[songSel];
    sctl.append(h('span', { class: 'il' }, 'PATTERN'), h('div', { class: 'seg bseg' }, ...PNAME.map((n, i) => h('button', { class: b.p === i ? 'on' : '', onclick: () => { b.p = i; edited(); } }, n))),
      h('span', { class: 'il' }, 'BARS'), h('div', { class: 'seg bseg' }, ...[1, 2, 4, 8].map(k => h('button', { class: b.bars === k ? 'on' : '', onclick: () => { b.bars = k; edited(); } }, String(k)))),
      h('button', { class: 'ib', onclick: () => { if (songSel > 0) { [B.song[songSel - 1], B.song[songSel]] = [B.song[songSel], B.song[songSel - 1]]; songSel--; edited(); } } }, '◀'),
      h('button', { class: 'ib', onclick: () => { if (songSel < B.song.length - 1) { [B.song[songSel + 1], B.song[songSel]] = [B.song[songSel], B.song[songSel + 1]]; songSel++; edited(); } } }, '▶'),
      h('button', { class: 'ib', onclick: () => { if (B.song.length >= 16) return; B.song.splice(songSel + 1, 0, { ...b }); songSel++; edited(); } }, 'DUPLICATE'),
      h('button', { class: 'ib del', onclick: () => { B.song.splice(songSel, 1); songSel = -1; edited(); } }, 'DELETE'));
  }

  /* ---- 描画 ---- */
  let headPos = -1, headPi = -1, headBar = -1;
  function paintHead(pos: number, pi: number, bar: number){ headPos = pos; headPi = pi; headBar = bar;
    cells.forEach(r => r.forEach((c, s) => c.classList.toggle('ph', s === pos && pi === B.cur)));
    phR.style.display = pos >= 0 && pi === B.cur ? 'block' : 'none'; phR.style.left = (pos / 16 * 100) + '%';
    abars.forEach((c, s) => c.classList.toggle('ph', s === pos && pi === B.cur));
    slots.forEach((s, i) => s.classList.toggle('ph', B.mode === 'chain' && pos >= 0 && chainIndexAt(bar) === i));
    const si = B.mode === 'song' && pos >= 0 ? songIndexAt(bar) : -1;
    $$('.sblk', strip).forEach((el, i) => el.classList.toggle('ph', i === si));
    patBtns.forEach((b, i) => b.classList.toggle('play', pos >= 0 && i === pi));
  }
  function syncKnobs(){ bpmKnob.sync(); swingKnob.sync(); acidKnobs.forEach(k => k.sync()); }
  function paint(){
    const p = B.pats[B.cur], gh = D.ghost() || {};
    cells.forEach((r, i) => r.forEach((c, s) => { const v = p[i][s];
      c.classList.toggle('on', v > 0); c.classList.toggle('gh', !!(gh[i] && gh[i].includes(s)) && v === 0);
      (c.firstChild as HTMLElement).style.height = (v * 100) + '%'; c.title = v > 0 ? `VEL ${Math.round(v * 100)}%` : ''; }));
    patBtns.forEach((b, i) => { b.classList.toggle('on', B.cur === i); b.classList.toggle('has', B.pats[i].some(r => r.some(v => v > 0)) || B.notes[i].some(t => t.length > 0)); });
    modeBtns.forEach(b => b.classList.toggle('on', b.dataset.m === B.mode));
    slots.forEach((b, i) => { b.textContent = B.chain[i] >= 0 ? PNAME[B.chain[i]] : '—'; b.classList.toggle('set', B.chain[i] >= 0); });
    // ピアノロール
    ntBtns.forEach((b, i) => b.classList.toggle('on', B.ntr === i));
    nms.innerHTML = ''; nms.append(ms(4 + B.ntr, 'mute'), ms(4 + B.ntr, 'solo'));
    $$('.ms[data-trk]').forEach(b => b.classList.toggle(b.dataset.k === 'mute' ? 'm' : 's', B[b.dataset.k as 'mute' | 'solo'][+b.dataset.trk]));
    keyV.textContent = NN[B.key.root];
    lockBtn.textContent = 'SCALE LOCK: ' + (B.key.lock ? 'ON' : 'OFF'); lockBtn.classList.toggle('on', B.key.lock);
    triadBtn.textContent = 'TRIAD: ' + (B.triad ? 'ON' : 'OFF'); triadBtn.classList.toggle('on', B.triad); triadBtn.style.display = B.ntr === 2 ? '' : 'none';
    acidRow.style.display = B.ntr === 1 ? '' : 'none';
    renderRoll(); paintAuto(); renderSong();
    paintHead(headPos, headPi, headBar);
    if (!stat.textContent || !stat.textContent.includes('VEL')) stat.textContent = R(5) ? '光っているマスを上下にドラッグで強さ（ベロシティ）を変更' : 'マスをクリックで ON／OFF';
  }
  function applyLocks(){
    if (!R(6) && B.cur !== 0) B.cur = 0;
    if (!R(11) && B.cur > 1) B.cur = 0;
    if (!R(6) && B.mode !== 'pat') B.mode = 'pat';
    if (!R(11) && B.mode === 'song') B.mode = 'pat';
    if (!R(NTRK[B.ntr].lock)) B.ntr = 0;
    rollRoot.classList.toggle('locked', !R(7)); songRoot.classList.toggle('locked', !R(11));
    paint();
    $$('[data-lock]', $('#beatRack')).forEach(el => { const n = +el.dataset.lock; el.classList.toggle('sublocked', !R(n)); el.title = R(n) ? '' : `B${String(n).padStart(2, '0')} で解放`; });
  }

  /* ---- WAV 書き出し ---- */
  async function exportWav(){
    const list = playList(), bars = B.mode === 'pat' ? 4 : list.length, sr = 44100, sd = stepDur();
    const used = [0, 1, 2, 3, 4, 5, 6].map(i => audible(i) && list.some(pi => i < 4 ? B.pats[pi][i].some(v => v > 0) : B.notes[pi][i - 4].length > 0));
    if (!used.some(Boolean)) { D.toast('鳴らす音がありません'); return; }
    const len = bars * 16 * sd;
    const OAC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const off = new OAC(2, Math.ceil(len * sr), sr);
    const nb = makeNoiseBuffer(off), og = makeGraph(off, off.destination);
    og.tg.forEach((g, i) => g.gain.value = audible(i) ? 1 : 0);
    for (let b = 0; b < bars; b++) { const bd = barData(list[b % list.length]); for (let s = 0; s < 16; s++) schedStep(off, og, nb, bd, s, b * 16 * sd, sd, B.swing, B.acid); }
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
    const songInfo = { brk: list.some(pi => kickless(pi)) && list.some(pi => !kickless(pi)), auto: list.some(pi => !!(B.auto[pi].acid || B.auto[pi].master)) };
    D.toast('WAV を書き出しました');
    D.emit(summary('wav', { used, velVar, bars, songInfo }));
  }

  paint();
  return {
    toggle, stop, demo, paint, applyLocks, isPlaying: () => playing,
    json: () => ({ app: 'otolab-beat', v: 2, ...JSON.parse(JSON.stringify(B)) }),
  };
}
