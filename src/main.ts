import './style.css';
import type { Recipe, Project, PlayParams, TrackData } from './types';
import { $, $$, h } from './ui/dom';
import { clamp, dbToGain } from './util';
import { createKnob, type KnobEl } from './ui/knob';
import { T } from './data/terms';
import { DEF } from './data/defaults';
import { CH } from './data/chapters';
import { SAMPLE } from './data/sample';
import { makeRig, tremBase, type Rig, type Voice } from './audio/engine';
import { toWav } from './audio/wav';
import { BCH } from './data/beatChapters';
import { createBeat, type BeatProj } from './beat/seq';
import { libAll, libFind, newId, type LibItem } from './library';

/* ================= PROGRESS ================= */
const KEY='otolab-v1';
interface Progress { done: Record<string, boolean>; ch: number; reach: number; learned: string[]; proj?: Project; backup?: Project;
  course?: 'sound'|'beat'; bch?: number; breach?: number; bproj?: BeatProj; lib?: LibItem[] }
let P: Progress={done:{},ch:0,reach:0,learned:[],course:'sound',bch:0,breach:0};
try{const s=JSON.parse(localStorage.getItem(KEY)||'null'); if(s)P={...P,...s};}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(P));}catch(e){}};
/* ---- コース（SOUND = 00〜09章 / BEAT = B00〜） ---- */
const isBeat=()=>P.course==='beat';
const chs=()=>isBeat()?BCH:CH;
const chI=()=>isBeat()?(P.bch||0):P.ch;
const reachI=()=>isBeat()?(P.breach||0):P.reach;
const chLabel=i=>(isBeat()?'B':'')+String(i).padStart(2,'0');
const chDone=i=>{ const st=chs()[i].steps; return !!st&&st.length>0&&st.every(s=>P.done[s.id]); };

/* ================= APP AUDIO ================= */
const AC=window.AudioContext||(window as any).webkitAudioContext;
// タッチ端末（スマホ）は処理落ちしやすいので、音声バッファを大きめにとる
const LOW_POWER=matchMedia('(hover: none)').matches;
const ctx=new AC({latencyHint:LOW_POWER?'playback':'interactive'});
const S={...DEF};
let view='wave';
const lim=ctx.createDynamicsCompressor();
lim.threshold.value=-4; lim.knee.value=2; lim.ratio.value=12; lim.attack.value=.003; lim.release.value=.15;
const analyser=ctx.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=.55;
lim.connect(analyser); analyser.connect(ctx.destination);
interface Track extends TrackData { g: GainNode; pn: StereoPannerNode; rig: Rig }
const masterG=ctx.createGain(); masterG.connect(lim);
const PROJ={bpm:120,master:0,normalize:false};
const tracks=[0,1,2,3].map(i=>{ const g=ctx.createGain(), pn=ctx.createStereoPanner(); g.connect(pn); pn.connect(masterG);
  const t: Track={name:'TRACK '+(i+1),p:{...DEF},clips:[],vol:0,pan:0,mute:false,solo:false,g,pn,rig:null}; t.rig=makeRig(ctx,g); t.rig.apply(t.p); return t; });
let SEL=0;
const curRig=()=>tracks[SEL].rig;
function updateMix(){ const anySolo=tracks.some(t=>t.solo), now=ctx.currentTime;
  tracks.forEach(t=>{ const on=!t.mute&&(!anySolo||t.solo); t.g.gain.setTargetAtTime(on?dbToGain(t.vol):0,now,.01); t.pn.pan.setTargetAtTime(t.pan,now,.01); });
  masterG.gain.setTargetAtTime(dbToGain(PROJ.master),now,.01); }
const demoRig=makeRig(ctx,lim);
const beat=createBeat({ctx,out:lim,emit:e=>emit(e),save:bp=>{ P.bproj=bp; save(); },toast:m=>toast(m),saved:P.bproj,
  lib:id=>libFind(P.lib,id), pickSource:(cur,cb)=>openLib({pick:cb,cur}),
  reach:()=>P.breach||0,ghost:()=>{ try{ return beatGhost(); }catch(e){ return null; } },
  ghostN:()=>{ try{ if(!isBeat())return null; const c=curStep(); return c&&c.ghostN||null; }catch(e){ return null; } }});
const dummyFilter=ctx.createBiquadFilter();

const voices=new Map();
let sweepMin=0,sweepMax=0,sweepStart=0;
function noteOn(id: string, freq: number, p: PlayParams, user: boolean, src?: string){
  if(ctx.state!=='running')ctx.resume();
  if(voices.has(id))noteOff(id);
  const rig=user?curRig():demoRig;
  if(!user)rig.apply(p);
  const v=rig.voice(freq,p); v.id=id; v.user=user; voices.set(id,v);
  if(user){ sweepMin=sweepMax=sweepStart=S.cutoff; emit({type:'play',src,...snap(freq)}); }
}
function noteOff(id){ const v=voices.get(id); if(!v)return; voices.delete(id); v.release(v.p.r); }
function demo(p){
  if(p&&p.beat){ beat.demo(p.beat); return; }
  const q={...DEF,...p}; const id='demo'+Math.random();
  noteOn(id,q.freq,q,false); setTimeout(()=>noteOff(id),(q._dur||1)*1000);
}
const userVoices=()=>[...voices.values()].filter(v=>v.user);
function snap(freq){ return {...S,view,freq:freq??S.freq}; }
const RIG_KEYS=['lfoTarget','lfoWave','lfoRate','lfoDepth','revMix','revTime','dlyTime','dlyFb','dlyMix'];
let irTimer;
function applyLive(k){
  if(RIG_KEYS.includes(k)){
    const rg=curRig(); rg.apply(S,k!=='revTime');
    if(k==='revTime'){ clearTimeout(irTimer); irTimer=setTimeout(()=>rg.apply(S,true),120); }
  }
  const t=ctx.currentTime;
  for(const v of userVoices()){
    if(k==='wave')v.osc.type=S.wave;
    if(k==='freq'&&v.id==='pad'){v.osc.frequency.setTargetAtTime(S.freq,t,.01); v.freq=S.freq;}
    if(k==='cutoff')v.f.frequency.setTargetAtTime(S.cutoff,t,.01);
    if(k==='res')v.f.Q.setTargetAtTime(S.res,t,.01);
    if(k==='ftype')v.f.type=S.ftype;
    if(k==='vol')v.vg.gain.setTargetAtTime(dbToGain(S.vol),t,.01);
    if(k==='oscLvl')v.og.gain.setTargetAtTime(S.oscLvl,t,.01);
    if(k==='noise')v.ng.gain.setTargetAtTime(S.noise*.8,t,.01);
    if(k==='lfoTarget'||k==='lfoDepth')v.trem.gain.setTargetAtTime(tremBase(S),t,.01);
  }
}
function setParam(k,v){
  S[k]=v; tracks[SEL].p[k]=v; applyLive(k); saveProj();
  if(k==='a'||k==='d'||k==='s'||k==='r')drawEnv();
  if(k==='cutoff'||k==='res'||k==='ftype')drawFilt();
  if(k.startsWith('lfo'))drawLfo();
  if(k.startsWith('rev')||k.startsWith('dly'))drawSpace();
  const uv=userVoices();
  if(uv.length){
    const sn=snap(uv[0].freq);
    if(k==='cutoff'){ sweepMin=Math.min(sweepMin,v); sweepMax=Math.max(sweepMax,v); if(sweepMax/sweepMin>=8)emit({type:'sweep',...sn,up:v>sweepStart}); }
    emit({type:'play',src:uv[0].id==='pad'?'pad':'key',live:true,...sn});
  }
}

/* ================= EVENTS / STEPS ================= */
function emit(e){
  const c=chs()[chI()]; if(!c||!c.steps)return;
  let changed=false;
  for(const s of c.steps){ if(!P.done[s.id]&&s.c(e)){ P.done[s.id]=true; changed=true; toast('STEP CLEAR — '+s.id); } }
  if(changed){ save(); renderGuide(); renderTabs(); if(isBeat())beat.paint(); }
}
let toastT;
function toast(msg){ const el=$('#toast'); el.innerHTML='<i></i>'+msg; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),1600); }

/* ================= KNOBS ================= */
const knobs: Record<string, KnobEl> = {};
function knob(o: any): KnobEl {
  if(o.key){ const k=o.key; o={get:()=>S[k],set:(v: any)=>setParam(k,v),def:DEF[k],...o}; }
  const el=createKnob(o); if(o.key)knobs[o.key]=el; return el;
}
const fHz=v=>v<1000?v.toFixed(0)+' Hz':(v/1000).toFixed(v<10000?2:1)+' kHz';
const fSec=v=>v<1?(v*1000).toFixed(0)+' ms':v.toFixed(2)+' s';
$('#k-osc').append(knob({key:'freq',label:'PITCH',term:'freq',min:30,max:1760,log:true,fmt:fHz,color:'var(--blue)'}),
  h('div',{class:'pdgrp',id:'pdGrp'},
    knob({key:'pdAmt',label:'DROP',term:'pitchdrop',min:0,max:48,fmt:v=>v<.5?'OFF':v.toFixed(0)+' st',color:'var(--blue)'}),
    knob({key:'pdTime',label:'D.TIME',term:'pitchdrop',min:.005,max:.5,log:true,fmt:fSec,color:'var(--blue)'})));
$('#k-amp').append(knob({key:'vol',label:'VOLUME',term:'db',min:-48,max:0,fmt:v=>v.toFixed(1)+' dB',color:'var(--grey)'}));
$('#k-env').append(
  knob({key:'a',label:'ATTACK',term:'attack',min:.001,max:3,log:true,fmt:fSec,color:'var(--green)'}),
  knob({key:'d',label:'DECAY',term:'decay',min:.01,max:3,log:true,fmt:fSec,color:'var(--green)'}),
  knob({key:'s',label:'SUSTAIN',term:'sustain',min:0,max:1,fmt:v=>(v*100).toFixed(0)+' %',color:'var(--green)'}),
  knob({key:'r',label:'RELEASE',term:'release',min:.01,max:5,log:true,fmt:fSec,color:'var(--green)'}));
$('#k-filter').append(
  knob({key:'cutoff',label:'CUTOFF',term:'cutoff',min:40,max:20000,log:true,fmt:fHz,color:'var(--orange)'}),
  knob({key:'res',label:'RESONANCE',term:'resonance',min:.1,max:25,fmt:v=>v.toFixed(1),color:'var(--orange)'}));
const fPct=v=>(v*100).toFixed(0)+' %';
$('#k-lfo').append(
  knob({key:'lfoRate',label:'RATE',term:'rate',min:.1,max:20,log:true,fmt:v=>v.toFixed(v<10?2:1)+' Hz',color:'var(--yellow)'}),
  knob({key:'lfoDepth',label:'DEPTH',term:'depth',min:0,max:1,fmt:fPct,color:'var(--yellow)'}));
$('#k-noise').append(
  knob({key:'noise',label:'NOISE',term:'noise',min:0,max:1,fmt:fPct,color:'var(--ink)'}),
  knob({key:'oscLvl',label:'OSC LVL',term:'mix',min:0,max:1,fmt:fPct,color:'var(--blue)'}));
$('#k-rev').append(
  knob({key:'revMix',label:'MIX',term:'drywet',min:0,max:1,fmt:fPct,color:'var(--blue)'}),
  knob({key:'revTime',label:'TIME',term:'revtime',min:.3,max:8,log:true,fmt:fSec,color:'var(--blue)'}));
$('#k-dly').append(
  knob({key:'dlyTime',label:'TIME',term:'delay',min:.03,max:1.2,log:true,fmt:fSec,color:'var(--blue)'}),
  knob({key:'dlyFb',label:'FDBK',term:'feedback',min:0,max:.9,fmt:fPct,color:'var(--blue)'}),
  knob({key:'dlyMix',label:'MIX',term:'drywet',min:0,max:1,fmt:fPct,color:'var(--blue)'}));

/* waves */
const WAVES=[['sine','SINE','sine','M1 8 C5 0,9 0,13 8 S21 16,25 8 S29 0,33 8'],['square','SQUARE','square','M1 13 V3 H9 V13 H17 V3 H25 V13 H33'],['sawtooth','SAW','saw','M1 13 L9 3 V13 L17 3 V13 L25 3 V13 L33 3'],['triangle','TRI','tri','M1 13 L5 3 L13 13 L21 3 L29 13 L33 8']];
for(const [v,lab,term,d] of WAVES){
  const b=h('button',{class:'wbtn'+(S.wave===v?' on':''),'data-term':term,'data-v':v,onclick:()=>{ $$('.wbtn').forEach(x=>x.classList.remove('on')); b.classList.add('on'); setParam('wave',v); }},
    h('span',{html:`<svg viewBox="0 0 34 16"><path d="${d}" fill="none" stroke="#151515" stroke-width="1.6" stroke-linejoin="round"/></svg>`}),h('span',{},lab));
  $('#waves').append(b);
}
$$('#ftypeSeg button').forEach(b=>b.onclick=()=>{ $$('#ftypeSeg button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); setParam('ftype',b.dataset.v); });
function bindSeg(sel,key){ $$(sel+' button').forEach(b=>b.onclick=()=>{ $$(sel+' button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); setParam(key,b.dataset.v); }); }
bindSeg('#lfoTargetSeg','lfoTarget'); bindSeg('#lfoWaveSeg','lfoWave');
$$('#viewSeg button').forEach(b=>b.onclick=()=>{ $$('#viewSeg button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); view=b.dataset.v; const uv=userVoices(); if(uv.length)emit({type:'play',src:'pad',...snap(uv[0].freq)}); });

/* ================= PERFORM ================= */
const pad=$('#pad');
const padDown=()=>{ if(pad.classList.contains('down'))return; pad.classList.add('down'); noteOn('pad',S.freq,S,true,'pad'); };
const padUp=()=>{ pad.classList.remove('down'); noteOff('pad'); };
pad.addEventListener('pointerdown',e=>{ try{pad.setPointerCapture(e.pointerId);}catch(_){} padDown(); });
pad.addEventListener('pointerup',padUp); pad.addEventListener('pointercancel',padUp);

const NOTES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B','C'];
const PCK=['a','w','s','e','d','f','t','g','y','h','u','j','k'];
const keyEls: Record<number, any>={};
(function buildKeys(){
  const wrap=$('#keys'); const whites=NOTES.map((n,i)=>[n,i] as [string,number]).filter(([n])=>!n.includes('#'));
  const wW=100/whites.length;
  whites.forEach(([n,i])=>{ const k=h('div',{class:'key'},PCK[i].toUpperCase()); k.style.flex='1'; keyEls[i]=k; wrap.append(k); });
  let wi=0;
  NOTES.forEach((n,i)=>{ if(!n.includes('#')){wi++;return;} const k=h('div',{class:'key blk'},PCK[i].toUpperCase()); k.style.left=`calc(${wi*wW}% - ${wW*0.3}%)`; k.style.width=wW*.6+'%'; keyEls[i]=k; wrap.append(k); });
  Object.entries(keyEls).forEach(([i,k])=>{
    const on=(e: any)=>{ e.preventDefault(); try{k.setPointerCapture(e.pointerId);}catch(_){} keyOn(+i); };
    const off=()=>keyOff(+i);
    k.addEventListener('pointerdown',on); k.addEventListener('pointerup',off); k.addEventListener('pointercancel',off);
  });
})();
const noteFreq=i=>261.63*Math.pow(2,i/12);
function keyOn(i){ if(isBeat()||P.reach<1)return; keyEls[i].classList.add('down'); if(selClip&&P.reach>=7){ selClip.c.note=60+i; renderTL(); saveProj(); } noteOn('k'+i,noteFreq(i),S,true,'key'); }
function keyOff(i){ keyEls[i]?.classList.remove('down'); noteOff('k'+i); }
addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if($('#start').classList.contains('show'))return;
  // Space は押しっぱなしのキーリピート中もスクロールを止める（PLAY は最初の1回だけ）
  if(e.code==='Space'){ e.preventDefault(); if(!e.repeat){ if(isBeat())beat.toggle(); else padDown(); } return; }
  if(e.repeat)return;
  if((e.key==='Delete'||e.key==='Backspace')&&selClip){ e.preventDefault(); deleteSel(); return; }
  if(e.key==='Escape'&&selClip){ selClip=null; renderTL(); return; }
  const i=PCK.indexOf(e.key.toLowerCase()); if(i>=0)keyOn(i);
});
// keyup でも止める：フォーカス中のボタンが Space で押されてしまうのを防ぐ
addEventListener('keyup',e=>{ if(e.code==='Space'){ if(!$('#start').classList.contains('show'))e.preventDefault(); padUp(); return; } const i=PCK.indexOf(e.key.toLowerCase()); if(i>=0)keyOff(i); });
addEventListener('blur',()=>{ padUp(); for(let i=0;i<13;i++)keyOff(i); });

/* ================= GRAPHS ================= */
function fit(cv){ const r=cv.getBoundingClientRect(); const d=devicePixelRatio||1; const w=Math.max(1,Math.round(r.width*d)),hh=Math.max(1,Math.round(r.height*d)); if(cv.width!==w||cv.height!==hh){cv.width=w;cv.height=hh;} const c=cv.getContext('2d'); c.setTransform(d,0,0,d,0,0); return [c,r.width,r.height]; }
function drawEnv(){
  const [c,w,hh]=fit($('#envGraph')); c.clearRect(0,0,w,hh);
  const hold=.5, tot=S.a+S.d+hold+S.r; const pad=6, W=w-pad*2, H=hh-pad*2-10;
  const X=t=>pad+t/tot*W, Y=v=>pad+H-v*H;
  const pts=[[0,0],[S.a,1],[S.a+S.d,S.s],[S.a+S.d+hold,S.s],[tot,0]];
  c.beginPath(); pts.forEach(([t,v],i)=>i?c.lineTo(X(t),Y(v)):c.moveTo(X(t),Y(v)));
  c.lineTo(X(tot),Y(0)); c.closePath(); c.fillStyle='rgba(23,178,106,.15)'; c.fill();
  c.beginPath(); pts.forEach(([t,v],i)=>i?c.lineTo(X(t),Y(v)):c.moveTo(X(t),Y(v))); c.strokeStyle='#17b26a'; c.lineWidth=2; c.stroke();
  c.font='9px IBM Plex Mono, monospace'; c.fillStyle='#7c7b75'; c.textAlign='center';
  const seg=[['A',0,S.a],['D',S.a,S.a+S.d],['S',S.a+S.d,S.a+S.d+hold],['R',S.a+S.d+hold,tot]];
  (seg as [string,number,number][]).forEach(([l,t0,t1])=>c.fillText(l,X((t0+t1)/2),hh-3));
  c.strokeStyle='#c8c7bf'; c.setLineDash([2,3]); c.lineWidth=1;
  [S.a,S.a+S.d,S.a+S.d+hold].forEach(t=>{c.beginPath();c.moveTo(X(t),pad);c.lineTo(X(t),pad+H);c.stroke();}); c.setLineDash([]);
  c.textAlign='right'; c.fillText('押す ― 離す',w-pad,pad+8);
}
function drawFilt(){
  const [c,w,hh]=fit($('#filtGraph')); c.clearRect(0,0,w,hh);
  dummyFilter.type=S.ftype; dummyFilter.frequency.value=S.cutoff; dummyFilter.Q.value=S.res;
  const N=160, fr=new Float32Array(N), mag=new Float32Array(N), ph=new Float32Array(N);
  for(let i=0;i<N;i++)fr[i]=20*Math.pow(1000,i/(N-1));
  dummyFilter.getFrequencyResponse(fr,mag,ph);
  const Y=db=>hh/2-db/36*(hh/2-6);
  c.strokeStyle='#e4e3dd'; c.lineWidth=1;
  [100,1000,10000].forEach(f=>{const x=Math.log(f/20)/Math.log(1000)*w; c.beginPath();c.moveTo(x,0);c.lineTo(x,hh);c.stroke();});
  c.beginPath(); c.moveTo(0,Y(0)); c.lineTo(w,Y(0)); c.stroke();
  c.beginPath();
  for(let i=0;i<N;i++){ const db=clamp(20*Math.log10(mag[i]||1e-6),-40,36); const x=i/(N-1)*w; i?c.lineTo(x,Y(db)):c.moveTo(x,Y(db)); }
  c.lineTo(w,hh); c.lineTo(0,hh); c.closePath(); c.fillStyle='rgba(255,90,31,.14)'; c.fill();
  c.beginPath();
  for(let i=0;i<N;i++){ const db=clamp(20*Math.log10(mag[i]||1e-6),-40,36); const x=i/(N-1)*w; i?c.lineTo(x,Y(db)):c.moveTo(x,Y(db)); }
  c.strokeStyle='#ff5a1f'; c.lineWidth=2; c.stroke();
  c.font='9px IBM Plex Mono, monospace'; c.fillStyle='#7c7b75';
  c.fillText('低い',4,hh-4); c.textAlign='right'; c.fillText('高い',w-4,hh-4); c.textAlign='left';
}
function drawLfo(){
  const [c,w,hh]=fit($('#lfoGraph')); c.clearRect(0,0,w,hh);
  const sec=2,N=700,mid=hh/2+4;
  const wv=x=>{x=x%1; if(S.lfoWave==='square')return x<.5?1:-1; if(S.lfoWave==='triangle')return 1-4*Math.abs(x-.5); return Math.sin(2*Math.PI*x);};
  c.strokeStyle='#e4e3dd'; c.lineWidth=1; c.beginPath(); c.moveTo(0,mid); c.lineTo(w,mid); c.stroke();
  c.beginPath();
  for(let i=0;i<=N;i++){ const t=i/N*sec, x=i/N*w, y=mid-wv(t*S.lfoRate)*S.lfoDepth*(hh/2-12); i?c.lineTo(x,y):c.moveTo(x,y); }
  c.strokeStyle='#e0a400'; c.lineWidth=2; c.stroke();
  c.font='9px IBM Plex Mono, monospace'; c.fillStyle='#7c7b75';
  c.fillText({pitch:'→ 音程をゆらす',amp:'→ 音量をゆらす',filter:'→ カットオフをゆらす'}[S.lfoTarget],4,10);
  c.textAlign='right'; c.fillText(S.lfoDepth<.01?'DEPTH 0 = ゆれなし':'2秒間',w-4,10); c.textAlign='left';
}
function drawSpace(){
  const [c,w,hh]=fit($('#spaceGraph')); c.clearRect(0,0,w,hh);
  const sec=clamp(S.revTime*1.1,3,8), X=t=>8+t/sec*(w-16), base=hh-13, H=base-14;
  if(S.revMix>0){
    c.beginPath(); c.moveTo(X(.012),base);
    for(let i=0;i<=140;i++){ const t=.012+i/140*(sec-.012); c.lineTo(X(t),base-H*.85*S.revMix*Math.exp(-6.9*t/S.revTime)); }
    c.lineTo(X(sec),base); c.closePath(); c.fillStyle='rgba(47,107,255,.18)'; c.fill();
  }
  c.fillStyle='#2f6bff';
  if(S.dlyMix>0){ let a=S.dlyMix; for(let t=S.dlyTime;t<sec&&a>.01;t+=S.dlyTime){ c.fillRect(X(t)-1.5,base-H*a*.9,3,H*a*.9); a*=S.dlyFb; } }
  const dA=1-S.revMix*.5; c.fillStyle='#151515'; c.fillRect(X(0)-1.5,base-H*dA,3,H*dA);
  c.strokeStyle='#c8c7bf'; c.beginPath(); c.moveTo(4,base); c.lineTo(w-4,base); c.stroke();
  c.font='9px IBM Plex Mono, monospace'; c.fillStyle='#7c7b75';
  c.fillText('0s',4,hh-2); c.textAlign='right'; c.fillText(sec.toFixed(1)+'s',w-4,hh-2);
  c.fillText('■ 元の音   ▮ ディレイ   ▬ リバーブ',w-4,10); c.textAlign='left';
}
const tbuf=new Float32Array(analyser.fftSize), fbuf=new Float32Array(analyser.frequencyBinCount);
let lastFrame=0;
function loop(now=0){
  // スマホでは描画を 30fps に間引いて CPU を音に回す
  if(LOW_POWER&&now-lastFrame<32){ requestAnimationFrame(loop); return; }
  lastFrame=now;
  if(isBeat()){ requestAnimationFrame(loop); return; }
  const [c,w,hh]=fit($('#scope'));
  c.fillStyle='#161616'; c.fillRect(0,0,w,hh);
  c.strokeStyle='#262626'; c.lineWidth=1;
  for(let x=0;x<w;x+=w/12){c.beginPath();c.moveTo(x,0);c.lineTo(x,hh);c.stroke();}
  for(let y=0;y<hh;y+=hh/6){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
  let peak=0;
  if(view==='wave'){
    analyser.getFloatTimeDomainData(tbuf);
    let st=0; for(let i=1;i<tbuf.length/2;i++){ if(tbuf[i-1]<0&&tbuf[i]>=0){st=i;break;} }
    const n=1024;
    c.beginPath();
    for(let i=0;i<n;i++){ const v=tbuf[st+i]||0; peak=Math.max(peak,Math.abs(v)); const x=i/(n-1)*w, y=hh/2-v*(hh/2-8)*1.6; i?c.lineTo(x,y):c.moveTo(x,y); }
    c.strokeStyle='#ffc21a'; c.lineWidth=2; if(!LOW_POWER){ c.shadowColor='#ffc21a'; c.shadowBlur=6; } c.stroke(); c.shadowBlur=0;
    c.fillStyle='#555'; c.font='10px IBM Plex Mono, monospace'; c.fillText('TIME →',8,hh-8);
  }else{
    analyser.getFloatFrequencyData(fbuf);
    const ny=ctx.sampleRate/2, bins=fbuf.length;
    c.beginPath(); c.moveTo(0,hh);
    for(let x=0;x<w;x+=1.5){
      const f=20*Math.pow(1000,x/w); const i=Math.min(bins-1,Math.round(f/ny*bins));
      const db=fbuf[i]; const y=hh-clamp((db+110)/100,0,1)*(hh-8); c.lineTo(x,y);
      peak=Math.max(peak,db>-60?1:0);
    }
    c.lineTo(w,hh); c.closePath();
    const gr=c.createLinearGradient(0,0,0,hh); gr.addColorStop(0,'#ff5a1f'); gr.addColorStop(1,'rgba(255,90,31,.15)');
    c.fillStyle=gr; c.fill();
    c.fillStyle='#777'; c.font='10px IBM Plex Mono, monospace';
    ([[100,'100Hz'],[1000,'1k'],[10000,'10k']] as [number,string][]).forEach(([f,l])=>{const x=Math.log(f/20)/Math.log(1000)*w; c.fillRect(x,hh-14,1,6); c.fillText(l,x+3,hh-6);});
    c.fillText('← 低い音   高い音 →',8,14);
  }
  if(playing){ const spb=60/PROJ.bpm, b=(ctx.currentTime-playT0)/spb;
    if(b>=TL){ playing=false; sched=[]; setPlayBtn(); $('#playhead').style.display='none'; }
    else if(b>=0){ const ph=$('#playhead'); ph.style.display='block'; ph.style.left=(b/TL*100)+'%'; $('#tTime').textContent=(b*spb).toFixed(2)+' s'; } }
  const uv=userVoices();
  $('#meter').textContent= uv.length? `▶ ${S.wave.toUpperCase()}  ${fHz(uv[0].freq)}  ${S.vol.toFixed(1)} dB` : (peak>0.002?'… 余韻':'— 音が鳴るとここに映ります');
  requestAnimationFrame(loop);
}

/* ================= TOOLTIP ================= */
const tip=$('#tip');
let tipT=0;
function showTip(el: HTMLElement, term: string){
  const t=T[term]; if(!t)return;
  tip.innerHTML=`<span class="en">${t.en}</span><b>${t.n}</b>${t.d}`;
  const r=el.getBoundingClientRect(); tip.style.opacity=1;
  const tw=tip.offsetWidth, th=tip.offsetHeight;
  let x=clamp(r.left+r.width/2-tw/2,8,innerWidth-tw-8), y=r.top-th-8; if(y<8)y=r.bottom+8;
  tip.style.left=x+'px'; tip.style.top=y+'px';
}
const hideTip=()=>{ tip.style.opacity=0; };
// マウス：ホバーで表示
document.addEventListener('pointerover',e=>{
  if(e.pointerType!=='mouse')return;
  const tg=e.target as any; const el=tg.closest&&tg.closest('[data-term]'); if(!el)return;
  showTip(el,el.dataset.term);
});
document.addEventListener('pointerout',e=>{ const tg=e.target as any; const el=tg.closest&&tg.closest('[data-term]'); if(el)hideTip(); });
// タッチ：用語をタップで表示（ボタンは操作を優先して出さない）。5秒で消える
const noHover=matchMedia('(hover: none)');
function tapTip(el: HTMLElement, term: string){ showTip(el,term); clearTimeout(tipT); tipT=window.setTimeout(hideTip,5000); }
document.addEventListener('click',e=>{
  if(!noHover.matches)return;
  const tg=e.target as any; if(tg.closest&&tg.closest('.knob'))return; // ノブは termtap で処理
  const el=tg.closest&&tg.closest('[data-term]');
  if(!el||el.closest('button')){ hideTip(); return; }
  tapTip(el,el.dataset.term);
});
document.addEventListener('termtap',(e: any)=>tapTip(e.detail.anchor,e.detail.term));
addEventListener('scroll',hideTip,{passive:true});

/* ================= PROJECT / TIMELINE ================= */
const TL=16;
const TCOL=['var(--orange)','var(--blue)','var(--green)','var(--yellow)'];
const NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName=n=>NN[((n%12)+12)%12]+(Math.floor(n/12)-1);
const m2f=n=>440*Math.pow(2,(n-69)/12);
const f2m=f=>Math.round(69+12*Math.log2(f/440));
let selClip=null, playing=false, playT0=0, sched=[];
let spT;
function pick(p: Recipe): Recipe { const r: any={}; for(const k of Object.keys(DEF)){ const v=p[k]; r[k]=typeof v==='number'?+v.toFixed(4):v; } return r; }
function projectJSON(): Project { return {app:'otolab',v:2,bpm:PROJ.bpm,master:+PROJ.master.toFixed(2),normalize:PROJ.normalize,
  tracks:tracks.map(t=>({name:t.name,p:pick(t.p),clips:t.clips.map(c=>({...c})),vol:+t.vol.toFixed(2),pan:+t.pan.toFixed(2),mute:t.mute,solo:t.solo}))}; }
function saveProj(){ clearTimeout(spT); spT=setTimeout(()=>{ P.proj=projectJSON(); save(); },250); }
function syncSegs(){
  $$('.wbtn').forEach(b=>b.classList.toggle('on',b.dataset.v===S.wave));
  [['#ftypeSeg','ftype'],['#lfoTargetSeg','lfoTarget'],['#lfoWaveSeg','lfoWave']].forEach(([sel,k])=>$$(sel+' button').forEach(b=>b.classList.toggle('on',b.dataset.v===S[k])));
}
function selectTrack(i){ SEL=i; Object.assign(S,tracks[i].p); Object.values(knobs).forEach(k=>k.sync()); syncSegs(); redrawAll(); renderTL(); }
const beatAt=(e,lane)=>{ const r=lane.getBoundingClientRect(); return (e.clientX-r.left)/r.width*TL; };
function previewClip(i,c){
  if(ctx.state!=='running')ctx.resume();
  const t=tracks[i], spb=60/PROJ.bpm; t.rig.apply(t.p);
  const v=t.rig.voice(m2f(c.note),t.p); v.release(t.p.r,ctx.currentTime+Math.min(c.len*spb,1.2));
}
function clipEl(i,c){
  const el=h('div',{class:'clip'+(selClip&&selClip.c===c?' sel':'')},h('span',{},noteName(c.note)),h('div',{class:'rh'}));
  if(i===3)el.style.setProperty('--tt','#151515');
  const pos=()=>{ el.style.left=c.start/TL*100+'%'; el.style.width=c.len/TL*100+'%'; }; pos();
  el.addEventListener('pointerdown',e=>{
    e.stopPropagation(); e.preventDefault();
    const lane=el.parentElement, mode=e.target.classList.contains('rh')?'resize':'move';
    const b0=beatAt(e,lane), s0=c.start, l0=c.len; let moved=false;
    selClip={t:i,c}; $$('.clip.sel').forEach(x=>x.classList.remove('sel')); el.classList.add('sel'); renderInspector();
    const mv=ev=>{ const db=beatAt(ev,lane)-b0; if(Math.abs(db)>.08)moved=true;
      if(mode==='move')c.start=clamp(Math.round((s0+db)*4)/4,0,TL-c.len);
      else c.len=clamp(Math.round((l0+db)*4)/4,.25,TL-c.start);
      pos(); renderInspector(); };
    const up=()=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',up);
      if(SEL!==i)selectTrack(i); else if(moved)renderTL(); if(!moved)previewClip(i,c); saveProj(); };
    addEventListener('pointermove',mv); addEventListener('pointerup',up);
  });
  return el;
}
function renderTL(){
  const box=$('#tlTracks'); box.innerHTML='';
  tracks.forEach((t,i)=>{
    const head=h('div',{class:'th'+(i===SEL?' sel':''),onpointerdown:e=>{ if(e.target.closest('.knob,.ms'))return; if(SEL!==i)selectTrack(i); }},
      h('div',{class:'tname'},h('i',{style:`background:${TCOL[i]}`}),t.name,i===SEL?h('span',{class:'edit'},'EDIT'):null),
      h('div',{class:'tmix'+(P.reach<8?' sublocked':'')},
        h('button',{class:'ms'+(t.mute?' m':''),'data-term':'mute',onclick:()=>{ t.mute=!t.mute; updateMix(); renderTL(); saveProj(); }},'M'),
        h('button',{class:'ms'+(t.solo?' s':''),'data-term':'solo',onclick:()=>{ t.solo=!t.solo; updateMix(); renderTL(); saveProj(); }},'S'),
        knob({small:true,label:'VOL',term:'layer',get:()=>t.vol,set:v=>{ t.vol=v; updateMix(); saveProj(); },def:0,min:-36,max:6,fmt:v=>v.toFixed(1)+'dB',color:TCOL[i]}),
        knob({small:true,label:'PAN',term:'pan',get:()=>t.pan,set:v=>{ t.pan=v; updateMix(); saveProj(); },def:0,min:-1,max:1,fmt:v=>Math.abs(v)<.02?'C':(v<0?'L':'R')+Math.round(Math.abs(v)*100),color:TCOL[i]})));
    head.style.setProperty('--tc',TCOL[i]);
    const lane=h('div',{class:'lane'}); lane.style.setProperty('--tc',TCOL[i]);
    const slotEnd=[], slots=new Map();
    [...t.clips].sort((a,b)=>a.start-b.start).forEach(c=>{ let k=slotEnd.findIndex(e=>e<=c.start+1e-6); if(k<0){k=slotEnd.length;slotEnd.push(0);} slotEnd[k]=c.start+c.len; slots.set(c,k); });
    const ns=Math.max(1,slotEnd.length), hh=46/ns;
    t.clips.forEach(c=>{ const el=clipEl(i,c); el.style.top=(9+slots.get(c)*hh)+'px'; el.style.bottom='auto'; el.style.height=(hh-(ns>1?2:0))+'px'; if(ns>2)el.style.fontSize='8px'; if(ns>2)el.style.padding='0 4px'; lane.append(el); });
    lane.addEventListener('pointerdown',e=>{
      if(e.target!==lane||P.reach<7)return;
      const b=beatAt(e,lane);
      const c={start:clamp(Math.floor(b*4)/4,0,TL-1),len:1,note:clamp(f2m(t.p.freq),24,96)};
      t.clips.push(c); selClip={t:i,c};
      if(SEL!==i)selectTrack(i); else renderTL();
      previewClip(i,c); saveProj();
    });
    box.append(h('div',{class:'trow'},head,lane));
  });
  renderInspector();
}
function renderInspector(){
  const box=$('#tlInsp'); box.innerHTML='';
  if(!selClip||!tracks[selClip.t].clips.includes(selClip.c)){ selClip=null;
    box.append(h('span',{class:'hint'},'空いている所をクリック → クリップを追加 ／ ドラッグで移動 ／ 右端をドラッグで長さを変更 ／ クリップを選んで鍵盤を弾くと音程が変わる ／ Delete で削除')); return; }
  const {t,c}=selClip;
  const nb=(lab,fn)=>h('button',{class:'ib',onclick:()=>{ fn(); renderTL(); saveProj(); previewClip(t,c); }},lab);
  box.append(
    h('span',{class:'il','data-term':'clip'},'CLIP'),h('span',{class:'iv',style:'min-width:auto'},tracks[t].name),
    h('span',{class:'il'},'START'),h('span',{class:'iv'},(c.start+1).toFixed(2)+' 拍目'),
    h('span',{class:'il'},'LENGTH'),h('span',{class:'iv'},c.len.toFixed(2)+' 拍'),
    h('span',{class:'il'},'NOTE'),nb('◀',()=>c.note=clamp(c.note-1,24,96)),h('span',{class:'iv note'},noteName(c.note)),nb('▶',()=>c.note=clamp(c.note+1,24,96)),
    nb('OCT−',()=>c.note=clamp(c.note-12,24,96)),nb('OCT＋',()=>c.note=clamp(c.note+12,24,96)),
    h('button',{class:'ib del',onclick:deleteSel},'DELETE'));
}
function deleteSel(){ if(!selClip)return; const cl=tracks[selClip.t].clips; const k=cl.indexOf(selClip.c); if(k>=0)cl.splice(k,1); selClip=null; renderTL(); saveProj(); }
function summary(){
  const anySolo=tracks.some(t=>t.solo);
  return {bpm:PROJ.bpm,tr:tracks.map(t=>{ const notes=t.clips.map(c=>c.note);
    return {n:t.clips.length,notes,avg:notes.length?notes.reduce((a,b)=>a+b,0)/notes.length:0,maxLen:Math.max(0,...t.clips.map(c=>c.len)),
      pan:t.pan,mute:t.mute,solo:t.solo,aud:!t.mute&&(!anySolo||t.solo),rev:t.p.revMix>=.05}; })};
}
function setPlayBtn(){ const b=$('#tPlay'); b.textContent=playing?'■ STOP':'▶ PLAY'; b.classList.toggle('on',playing); b.classList.toggle('play',!playing); }
function tPlay(){
  tStop(); if(ctx.state!=='running')ctx.resume();
  const spb=60/PROJ.bpm, t0=ctx.currentTime+.08;
  tracks.forEach(t=>{ t.rig.apply(t.p); t.clips.forEach(c=>{ const st=t0+c.start*spb; const v=t.rig.voice(m2f(c.note),t.p,st); v.release(t.p.r,st+c.len*spb); sched.push(v); }); });
  playing=true; playT0=t0; setPlayBtn();
  emit({type:'transport',...summary()});
}
function tStop(){ playing=false; sched.forEach(v=>v.kill()); sched=[]; setPlayBtn(); $('#playhead').style.display='none'; $('#tTime').textContent='0.00 s'; }
function loadProject(pj){
  tStop();
  PROJ.bpm=clamp(+pj.bpm||120,60,200); PROJ.master=+(pj.master??0); PROJ.normalize=!!pj.normalize;
  tracks.forEach((t,i)=>{ const s=(pj.tracks&&pj.tracks[i])||{};
    t.name=s.name||'TRACK '+(i+1); Object.assign(t.p,DEF,s.p||{});
    t.clips=(s.clips||[]).map(c=>({start:+c.start,len:+c.len,note:+c.note}));
    t.vol=+(s.vol??0); t.pan=+(s.pan??0); t.mute=!!s.mute; t.solo=!!s.solo; t.rig.apply(t.p); });
  selClip=null; updateMix(); $('#bpmV').textContent=PROJ.bpm; masterKnob.sync(); setNormBtn();
  selectTrack(0); saveProj();
}
const ACTIONS: Record<string, () => void> = { loadSample: () => loadSample(),
  gotoBeat: () => { emit({type:'gobeat'}); setCourse('beat'); goCh(13); } };
function loadSample(){ P.backup=projectJSON(); loadProject(SAMPLE); $('#restoreBtn').hidden=false; toast('お手本プロジェクトを読み込みました'); }

/* ---- render / export ---- */
let lastRender=null;
function setNormBtn(){ const b=$('#normBtn'); b.textContent='NORMALIZE: '+(PROJ.normalize?'ON':'OFF'); b.classList.toggle('on',PROJ.normalize); }
async function renderMix(){
  const spb=60/PROJ.bpm, anySolo=tracks.some(t=>t.solo);
  const live=tracks.filter(t=>t.clips.length&&!t.mute&&(!anySolo||t.solo));
  if(!live.length){ toast('鳴らすクリップがありません'); return; }
  let end=0,tail=0;
  live.forEach(t=>{ const p=t.p; t.clips.forEach(c=>end=Math.max(end,(c.start+c.len)*spb));
    let tl=p.r*1.8; if(p.revMix>.01)tl=Math.max(tl,p.revTime);
    if(p.dlyMix>.01&&p.dlyFb>.01)tl=Math.max(tl,Math.min(6,p.dlyTime*Math.log(.01)/Math.log(p.dlyFb)));
    tail=Math.max(tail,tl); });
  const dur=Math.min(30,end+tail+.3), sr=44100;
  const OAC=window.OfflineAudioContext||(window as any).webkitOfflineAudioContext;
  const off=new OAC(2,Math.ceil(dur*sr),sr);
  const mg=off.createGain(); mg.gain.value=dbToGain(PROJ.master); mg.connect(off.destination);
  live.forEach(t=>{ const g=off.createGain(); g.gain.value=dbToGain(t.vol); const pn=off.createStereoPanner(); pn.pan.value=t.pan; g.connect(pn); pn.connect(mg);
    const rig=makeRig(off,g); rig.apply(t.p);
    t.clips.forEach(c=>{ const st=.03+c.start*spb; const v=rig.voice(m2f(c.note),t.p,st); v.release(t.p.r,st+c.len*spb); }); });
  $('#rStat').textContent='RENDERING…';
  const buf=await off.startRendering();
  let pk=0; for(let ch=0;ch<buf.numberOfChannels;ch++){ const d=buf.getChannelData(ch); for(let i=0;i<d.length;i++){ const a=Math.abs(d[i]); if(a>pk)pk=a; } }
  const rawDb=20*Math.log10(pk||1e-9); let outDb=rawDb;
  if(PROJ.normalize&&pk>0){ const gN=dbToGain(-1)/pk; for(let ch=0;ch<buf.numberOfChannels;ch++){ const d=buf.getChannelData(ch); for(let i=0;i<d.length;i++)d[i]*=gN; } outDb=-1; }
  lastRender={buf,rawDb,outDb,dur};
  drawRender();
  $('#listenBtn').disabled=false; $('#dlBtn').disabled=false;
  emit({type:'render',peak:rawDb,normalize:PROJ.normalize,...summary()});
}
function drawRender(){
  const [c,w,hh]=fit($('#rCanvas')); c.fillStyle='#161616'; c.fillRect(0,0,w,hh);
  if(!lastRender)return;
  const {buf,rawDb,outDb,dur}=lastRender, L0=buf.getChannelData(0), R0=buf.getChannelData(buf.numberOfChannels>1?1:0), n=L0.length, mid=hh/2, sc=hh/2-6;
  c.strokeStyle='#333'; c.setLineDash([3,3]); [mid-sc,mid+sc].forEach(y=>{c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}); c.setLineDash([]);
  for(let x=0;x<w;x++){ const i0=Math.floor(x/w*n), i1=Math.floor((x+1)/w*n); let mn=0,mx=0;
    for(let i=i0;i<i1;i++){ const v=(L0[i]+R0[i])/2; if(v<mn)mn=v; if(v>mx)mx=v; }
    const clip=Math.max(-mn,mx)>=1; c.fillStyle=clip?'#ff3b3b':'#ffc21a';
    c.fillRect(x,mid-Math.min(mx,1.05)*sc,1,Math.max(1,(Math.min(mx,1.05)-Math.max(mn,-1.05))*sc)); }
  c.fillStyle='#666'; c.font='9px IBM Plex Mono, monospace'; c.fillText('0 dB',4,mid-sc-1);
  const st=$('#rStat'); st.innerHTML='';
  const clipTxt=rawDb>0?' <span class="bad">CLIP! 0 dB を超えています</span>':'';
  st.innerHTML=`PEAK <b>${rawDb.toFixed(1)} dB</b>${PROJ.normalize?` → NORMALIZE 後 <b>${outDb.toFixed(1)} dB</b>`:''}${PROJ.normalize?'':clipTxt}　LENGTH <b>${dur.toFixed(2)} s</b>　44.1 kHz / 16 bit / STEREO`;
}
/* ================= RENDER ================= */
function renderTabs(){
  const tabs=$('#tabs'); tabs.innerHTML='';
  chs().forEach((c,i)=>{
    const b=h('button',{class:'tab'+(i===chI()?' on':'')+(chDone(i)?' done':''),title:c.soon?`${c.title}（第${c.soon}段階で追加）`:c.title,disabled:!!c.soon,onclick:()=>goCh(i)},chLabel(i));
    tabs.append(b);
  });
  $('#glossCnt').textContent=P.learned.length;
  $$('#courseSeg button').forEach(b=>b.classList.toggle('on',b.dataset.c===(P.course||'sound')));
  $('#libBtn').hidden=!(isBeat()?(P.breach||0)>=13:P.reach>=10);
}
function termCard(k){
  const t=T[k];
  return h('div',{class:'term'},
    h('div',{},h('b',{},t.n),h('span',{class:'en'},t.en)),
    t.demo?h('button',{class:'play-mini',title:'聞いてみる',onclick:()=>demo(t.demo)},'▶'):h('span',{}),
    h('p',{},t.d));
}
const curStep=()=>chs()[chI()].steps.find(s=>!P.done[s.id]);
/* ---- スマホ用：下部タブと現在ステップの帯 ---- */
const isMobile=()=>matchMedia('(max-width:760px)').matches;
const SYNTH_FOCUS=['osc','amp','env','filter','lfo','noise','space','pad'];
const beatGhost=()=>{ if(!isBeat())return null; const c=curStep(); return c&&c.ghost||null; };
function setMTab(t: string){
  document.body.dataset.mtab=t; hideTip();
  $$('#mtabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  const cur=curStep(), f=cur&&cur.focus;
  const m=f&&((t==='synth'&&SYNTH_FOCUS.includes(f))||(t==='tl'&&(f==='tl'||f==='master'||f==='pad'))||(t==='seq'&&(f==='seq'||f==='roll'||f==='song')))?$('#m-'+f):null;
  // 非表示中に描いたグラフは幅0になるので、表示してから描き直す
  requestAnimationFrame(()=>{ redrawAll(); if(m)m.scrollIntoView({block:'center'}); else scrollTo(0,0); });
}
function renderStrip(){
  const c=chs()[chI()], st=$('#mstrip'), cur=curStep(); st.innerHTML='';
  const idx=cur?c.steps.indexOf(cur)+1:c.steps.length;
  st.append(...[h('span',{class:'no'},cur?`STEP ${idx}/${c.steps.length}`:'CLEAR!'),
    h('span',{class:'txt'},cur?cur.t:'この章はクリア！ ガイドから次の章へ進もう'),
    cur&&cur.demo?h('button',{class:'pl',onclick:()=>demo(cur.demo)},'▶'):null,
    isBeat()?h('button',{class:'tr',title:'シーケンサーの再生／停止',onclick:()=>beat.toggle()},'▶■'):null,
    h('button',{onclick:()=>setMTab('guide')},'ガイド')].filter(Boolean));
}
function renderGuide(){
  const c=chs()[chI()], g=$('#guide'); g.innerHTML='';
  const cur=curStep();
  renderStrip();
  g.append(
    h('div',{class:'chnum'},chLabel(chI()),h('small',{},'CH. / '+c.tag)),
    h('div',{class:'chtitle'},c.title),
    h('p',{class:'intro'},c.intro),
    h('div',{class:'sect'},'TERMS ／ この章の用語'),
    h('div',{class:'terms'},c.terms.map(termCard)),
    h('div',{class:'sect'},`STEPS ／ やってみよう  ${c.steps.filter(s=>P.done[s.id]).length}/${c.steps.length}`),
    h('ol',{class:'steps'},c.steps.map(s=>h('li',{class:'step'+(P.done[s.id]?' ok':'')+(s===cur?' cur':'')},
      h('span',{class:'box'}),
      h('div',{},h('div',{class:'txt'},s.t), s.demo?h('button',{class:'demo',onclick:()=>demo(s.demo)},'▶ お手本を聞く'):null, s.act?h('button',{class:'demo',onclick:ACTIONS[s.act.action]},s.act.label):null))))
  );
  const nextI=chI()+1, next=chs()[nextI], open=next&&!next.soon;
  const endMsg=isBeat()
    ?'BEAT コース全14章クリア、おめでとうございます！ 四つ打ちとハイハット、テンポとグルーヴ、パターンとフィル、ピアノロールでのベースとアシッドライン、スケールとコード、オートメーション、そしてアレンジと書き出しまで、テクノを1曲つくる流れはひと通り身につきました。SOUND コースでつくった自分の音でも、どんどん鳴らしてみてください。'
    :'SOUND コース全11章クリア、おめでとうございます！ 音の正体から波形・エンベロープ・フィルター・LFO・ノイズ・空間、タイムライン・レイヤー・マスタリング、そしてドラムの音づくりまで、サウンドデザインの基礎はひと通り身につきました。つくった音色は BEAT コースのトラックでも鳴らせます。';
  const clr=h('div',{class:'clear'+(chDone(chI())?' show':'')},
    h('h4',{},open?'CHAPTER CLEAR!':'ALL CLEAR!'),
    h('p',{},open?(isBeat()?`「${c.title}」をマスター。次は「${next.title}」へ進もう。`:`「${c.title}」をマスター。次は「${next.title}」で新しいモジュールが解放されます。`):endMsg),
    open?h('button',{class:'next',onclick:()=>goCh(nextI)},'NEXT → CH.'+chLabel(nextI)):(isBeat()?h('button',{class:'next',onclick:()=>setCourse('sound')},'SOUND コースへ →'):null));
  g.append(clr);
  $$('.mod,.perform').forEach(m=>m.classList.remove('focus'));
  if(cur&&cur.focus){ const m=$('#m-'+cur.focus); m&&m.classList.add('focus'); }
}
function redrawAll(){drawEnv();drawFilt();drawLfo();drawSpace();drawRender();}
function applyLocks(){
  if(isBeat()){ beat.applyLocks(); return; }
  const r=P.reach;
  $('#m-env').classList.toggle('locked',r<2);
  $('#m-filter').classList.toggle('locked',r<3);
  $('#m-lfo').classList.toggle('locked',r<4);
  $('#m-noise').classList.toggle('locked',r<5);
  $('#m-space').classList.toggle('locked',r<6);
  $('#m-tl').classList.toggle('locked',r<7);
  $('#m-master').classList.toggle('locked',r<9);
  $('#pdGrp').classList.toggle('sublocked',r<10);
  $('#pdGrp').title=r<10?'CH.10 で解放':'';
  $('#mtabs [data-tab="tl"]').disabled=r<7;
  renderTL();
  $('#waveSub').classList.toggle('locked',r<1);
  $('#keysWrap').classList.toggle('locked',r<1);
  requestAnimationFrame(redrawAll);
}
function goCh(i){
  const L=chs(); if(!L[i]||L[i].soon)return;
  if(isBeat()){ P.bch=i; P.breach=Math.max(P.breach||0,i); } else { P.ch=i; P.reach=Math.max(P.reach,i); }
  for(const k of L[i].terms) if(!P.learned.includes(k))P.learned.push(k);
  save(); renderTabs(); renderGuide(); applyLocks(); if(isBeat())beat.paint();
  if(isMobile()&&document.body.dataset.mtab!=='guide')setMTab('guide');
  $('#guide').scrollTop=0;
  if(innerWidth<920)scrollTo({top:0,behavior:'smooth'});
}

function setCourse(c: 'sound'|'beat'){
  if(c!==P.course){ tStop(); beat.stop(); padUp(); }
  P.course=c; document.body.dataset.course=c; hideTip();
  goCh(chI());
  if(isMobile())setMTab('guide');
  if(c==='sound')requestAnimationFrame(redrawAll);
}
$$('#courseSeg button').forEach(b=>b.onclick=()=>setCourse(b.dataset.c));

/* glossary */
function renderGloss(){
  const l=$('#glList'); l.innerHTML='';
  Object.keys(T).forEach(k=>{
    if(P.learned.includes(k)){ l.append(termCard(k)); }
    else l.append(h('div',{class:'term unk'},h('div',{},h('b',{},'？？？'),h('span',{class:'en'},'LOCKED')),h('span',{}),h('p',{},'先の章で登場します')));
  });
}
$('#glossBtn').onclick=()=>{ renderGloss(); $('#glossary').classList.add('show'); };

/* ================= SOUND LIBRARY ================= */
let libOpts: { pick?: (id: string|null)=>void; cur?: string|null } = {};
function openLib(o: typeof libOpts = {}){ libOpts=o; renderLib(); $('#libDlg').classList.add('show'); }
const closeLib=()=>$('#libDlg').classList.remove('show');
$('#libBtn').onclick=()=>openLib();
$('#libClose').onclick=closeLib;
$('#libDlg').addEventListener('click',e=>{ if(e.target.id==='libDlg')closeLib(); });
function previewLib(p: Recipe){ demo({...p,_dur:Math.min(Math.max(p.a+p.d+.05,.25),1.6)}); }
function renderLib(){
  const pickMode=!!libOpts.pick, body=$('#libBody'); body.innerHTML='';
  P.lib=P.lib||[];
  $('#libTitle').textContent=pickMode?'音源を選ぶ':'SOUND LIBRARY';
  $('#libSub').textContent=pickMode?'このトラックで鳴らす音色を選びます。ノートのトラックでは、ピアノロールの高さで鳴ります。'
    :'SOUND でつくった音色に名前を付けて保存し、BEAT コースのトラックで鳴らせます。「読み込む」で今のトラックに戻せます。';
  if(!pickMode&&!isBeat()){
    const inp=h('input',{class:'libname',value:'MY SOUND '+(P.lib.length+1),maxlength:'20'}) as HTMLInputElement;
    body.append(h('div',{class:'libsave'},inp,h('button',{class:'tbtn play',onclick:()=>{
      const name=(inp.value||'MY SOUND').trim().slice(0,20), p=pick(S);
      P.lib.unshift({id:newId(),name,p}); save(); toast(`「${name}」をライブラリに保存しました`); emit({type:'libsave',name,p:{...p},count:P.lib.length}); renderLib();
    }},'★ 今の音色を保存')));
  }
  const list=h('div',{class:'liblist'});
  if(pickMode) list.append(h('div',{class:'librow'+(libOpts.cur==null?' cur':''),'data-name':'BUILT-IN'},h('span',{class:'lp'}),h('b',{},'BUILT-IN（内蔵の音）'),h('span',{}),
    h('button',{class:'ib',onclick:()=>{ libOpts.pick(null); closeLib(); }},'選ぶ')));
  libAll(P.lib).forEach(it=>{
    const name=it.preset?h('b',{},it.name):h('input',{class:'libname sm',value:it.name,maxlength:'20',onchange:(e: any)=>{ it.name=(e.target.value||it.name).slice(0,20); save(); }});
    const acts=pickMode?[h('button',{class:'ib',onclick:()=>{ libOpts.pick(it.id); closeLib(); }},'選ぶ')]
      :[!isBeat()?h('button',{class:'ib',onclick:()=>{ const t=tracks[SEL]; Object.assign(t.p,DEF,it.p); t.rig.apply(t.p); selectTrack(SEL); saveProj(); toast(`「${it.name}」を読み込みました`); closeLib(); }},'読み込む'):null,
        !it.preset?h('button',{class:'ib del',title:'削除',onclick:()=>{ P.lib=P.lib.filter(x=>x!==it); save(); renderLib(); beat.paint(); }},'×'):null];
    list.append(h('div',{class:'librow'+(libOpts.cur===it.id?' cur':'')+(it.preset?' pre':''),'data-name':it.name},
      h('button',{class:'lp',title:'試聴',onclick:()=>previewLib(it.p)},'▶'), name,
      h('span',{class:'libinfo'},`${it.p.noise>.5&&it.p.oscLvl<.3?'NOISE':it.p.wave.toUpperCase()}${it.p.pdAmt>0?' / DROP':''}`), h('span',{class:'libacts'},...acts)));
  });
  body.append(list);
}
$('#glossClose').onclick=()=>$('#glossary').classList.remove('show');
$('#glossary').addEventListener('click',e=>{ if(e.target.id==='glossary')$('#glossary').classList.remove('show'); });

$('#recipeBtn').onclick=()=>{
  const txt=JSON.stringify(isBeat()?beat.json():projectJSON(),null,2);
  try{ navigator.clipboard.writeText(txt).then(()=>toast('RECIPE COPIED — プロジェクト全体の設定をコピーしました'),()=>toast('コピーできませんでした')); }catch(e){ toast('コピーできませんでした'); }
};
/* iPhone はマナーモードだと Web Audio が鳴らないため、
   再生カテゴリに切り替える（audioSession API ＋ 無音オーディオのループ再生）。 */
let silentEl: HTMLAudioElement|null=null;
function unlockIOSAudio(){
  try{ const na: any=navigator; if(na.audioSession)na.audioSession.type='playback'; }catch(e){}
  try{ if(!silentEl){ const url=URL.createObjectURL(toWav(ctx.createBuffer(1,Math.floor(ctx.sampleRate*.5),ctx.sampleRate)));
      silentEl=new Audio(url); silentEl.loop=true; silentEl.setAttribute('playsinline',''); }
    silentEl.play().catch(()=>{}); }catch(e){}
}
document.body.dataset.mtab='guide';
$$('#mtabs button').forEach(b=>b.onclick=()=>setMTab(b.dataset.tab));
const startWith=(c: 'sound'|'beat')=>{ unlockIOSAudio(); ctx.resume(); $('#start').classList.remove('show'); setCourse(c);
  if(c==='sound')demo({wave:'sine',freq:880,a:.005,d:.6,s:0,r:.6,_dur:.7}); };
$('#go').onclick=()=>startWith('sound');
$('#goBeat').onclick=()=>startWith('beat');

addEventListener('resize',redrawAll);
/* timeline bindings */
(function(){
  const r=$('#ruler'); for(let b=0;b<TL;b++){ r.append(h('span',{class:b%4===0?'bar':'',style:`left:${b/TL*100}%`},String(b+1))); }
})();
$('#tPlay').onclick=()=>playing?tStop():tPlay();
$('#bpmDn').onclick=()=>{ PROJ.bpm=Math.max(60,PROJ.bpm-5); $('#bpmV').textContent=PROJ.bpm; saveProj(); };
$('#bpmUp').onclick=()=>{ PROJ.bpm=Math.min(200,PROJ.bpm+5); $('#bpmV').textContent=PROJ.bpm; saveProj(); };
$('#sampleBtn').onclick=loadSample;
$('#restoreBtn').onclick=()=>{ if(P.backup){ loadProject(P.backup); P.backup=null; save(); } $('#restoreBtn').hidden=true; toast('元のプロジェクトに戻しました'); };
$('#clearBtn').onclick=()=>{ P.backup=projectJSON(); tracks.forEach(t=>t.clips=[]); selClip=null; tStop(); renderTL(); saveProj(); $('#restoreBtn').hidden=false; toast('全クリップを消去しました（↺ で戻せます）'); };
const masterKnob=knob({label:'MASTER',term:'master',get:()=>PROJ.master,set:v=>{ PROJ.master=v; updateMix(); saveProj(); },def:0,min:-24,max:12,fmt:v=>v.toFixed(1)+' dB',color:'var(--ink)'});
$('#k-master').append(masterKnob);
$('#normBtn').onclick=()=>{ PROJ.normalize=!PROJ.normalize; setNormBtn(); saveProj(); };
$('#renderBtn').onclick=()=>{ if(ctx.state!=='running')ctx.resume(); renderMix(); };
$('#listenBtn').onclick=()=>{ if(!lastRender)return; if(ctx.state!=='running')ctx.resume(); const src=ctx.createBufferSource(); src.buffer=lastRender.buf; src.connect(analyser); src.start(); };
const wavName=()=>{ const d=new Date(), z=(n: number)=>String(n).padStart(2,'0'); return `otolab-${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.wav`; };
$('#dlBtn').onclick=()=>{ if(!lastRender)return;
  try{ const url=URL.createObjectURL(toWav(lastRender.buf)); const a=h('a',{href:url,download:wavName()}); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),15000); }catch(e){}
  emit({type:'download'}); toast('WAV を書き出しました'); };
$('#restoreBtn').hidden=!P.backup;

if(P.proj)loadProject(P.proj); else { updateMix(); selectTrack(0); }
document.body.dataset.course=P.course||'sound';
goCh(chI());
requestAnimationFrame(loop);
