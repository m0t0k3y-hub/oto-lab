import type { Recipe, PlayParams } from '../types';
import { dbToGain } from '../util';

export interface Voice {
  osc: OscillatorNode; nz: AudioBufferSourceNode; og: GainNode; ng: GainNode; f: BiquadFilterNode;
  g: GainNode; trem: GainNode; vg: GainNode; p: PlayParams; freq: number;
  id?: string; user?: boolean;
  release(rel: number, when?: number): void;
  kill(): void;
}
export interface Rig {
  input: GainNode;
  apply(p: Recipe, doIR?: boolean): void;
  voice(freq: number, p: PlayParams, when?: number): Voice;
}

/* 音のエンジン。
   makeRig() は AudioContext / OfflineAudioContext のどちらでも動くので、
   リアルタイム再生と WAV 書き出しで同じ音が鳴る。 */
export function makeNoiseBuffer(ac: BaseAudioContext): AudioBuffer{ const len=ac.sampleRate*2, b=ac.createBuffer(1,len,ac.sampleRate), d=b.getChannelData(0); for(let i=0;i<len;i++)d[i]=Math.random()*2-1; return b; }
export function makeIR(ac: BaseAudioContext, sec: number): AudioBuffer{
  const sr=ac.sampleRate, len=Math.max(1,Math.floor(sr*sec)), pre=Math.floor(sr*.012);
  const b=ac.createBuffer(2,len+pre,sr);
  for(let ch=0;ch<2;ch++){ const d=b.getChannelData(ch); let lp=0;
    for(let i=0;i<len;i++){ const damp=.2+.75*(i/len); lp+=((Math.random()*2-1)-lp)*(1-damp); d[i+pre]=lp*Math.exp(-6.9*(i/sr)/sec); } }
  return b;
}
export const envAt=(p: Recipe, dt: number): number=>{const pk=.32; if(dt<p.a)return pk*Math.max(dt,0)/p.a; return pk*(p.s+(1-p.s)*Math.exp(-(dt-p.a)/Math.max(p.d/3,.002)));};
export const tremBase=(p: Recipe): number=>p.lfoTarget==='amp'?1-p.lfoDepth/2:1;
export function makeRig(ac: BaseAudioContext, out: AudioNode): Rig {
  const R: any = {};
  R.noiseBuf=makeNoiseBuffer(ac);
  R.input=ac.createGain();
  R.lfo=ac.createOscillator(); R.lfo.start();
  R.lfoPitch=ac.createGain(); R.lfoAmp=ac.createGain(); R.lfoFilt=ac.createGain();
  [R.lfoPitch,R.lfoAmp,R.lfoFilt].forEach(g=>{g.gain.value=0;R.lfo.connect(g);});
  R.dry=ac.createGain(); R.conv=ac.createConvolver(); R.revWet=ac.createGain(); R.revWet.gain.value=0;
  R.delay=ac.createDelay(2); R.fb=ac.createGain(); R.dlyWet=ac.createGain(); R.dlyWet.gain.value=0;
  R.input.connect(R.dry); R.dry.connect(out);
  R.revWet.connect(out); R.dlyWet.connect(out); R.delay.connect(R.fb); R.fb.connect(R.delay);
  R.irSec=0;
  /* リバーブ（畳み込み）は非常に重いので、MIX が 0 のあいだは配線を外して計算させない。
     ディレイも同様。切るときは残響が消えるのを少し待ってから外す（リアルタイム時のみ）。 */
  const offline=typeof OfflineAudioContext!=='undefined'&&ac instanceof OfflineAudioContext;
  const later=(fn: ()=>void)=>{ if(offline)fn(); else setTimeout(fn,400); };
  const tryDis=(a: AudioNode,b: AudioNode)=>{ try{a.disconnect(b);}catch(e){} };
  R.revOn=false; R.dlyOn=false;
  const setRev=(on: boolean)=>{ if(on===R.revOn)return; R.revOn=on;
    if(on){ R.input.connect(R.conv); R.dlyWet.connect(R.conv); R.conv.connect(R.revWet); }
    else later(()=>{ if(R.revOn)return; tryDis(R.input,R.conv); tryDis(R.dlyWet,R.conv); tryDis(R.conv,R.revWet); }); };
  const setDly=(on: boolean)=>{ if(on===R.dlyOn)return; R.dlyOn=on;
    if(on){ R.input.connect(R.delay); R.delay.connect(R.dlyWet); }
    else later(()=>{ if(R.dlyOn)return; tryDis(R.input,R.delay); tryDis(R.delay,R.dlyWet); }); };
  R.apply=(p: Recipe, doIR=true)=>{
    const t=ac.currentTime, sm=(prm: AudioParam, v: number)=>prm.setTargetAtTime(v,t,.015);
    R.lfo.type=p.lfoWave; sm(R.lfo.frequency,p.lfoRate);
    sm(R.lfoPitch.gain,p.lfoTarget==='pitch'?p.lfoDepth*p.lfoDepth*1200:0);
    sm(R.lfoFilt.gain,p.lfoTarget==='filter'?p.lfoDepth*4800:0);
    sm(R.lfoAmp.gain,p.lfoTarget==='amp'?p.lfoDepth/2:0);
    sm(R.dry.gain,1-p.revMix*.5); sm(R.revWet.gain,p.revMix*1.1);
    sm(R.delay.delayTime,p.dlyTime); sm(R.fb.gain,p.dlyFb); sm(R.dlyWet.gain,p.dlyMix);
    const revOn=p.revMix>.001;
    if(revOn&&doIR&&Math.abs(p.revTime-R.irSec)>.005){ R.irSec=p.revTime; R.conv.buffer=makeIR(ac,p.revTime); }
    setRev(revOn&&!!R.conv.buffer); setDly(p.dlyMix>.001);
  };
  R.voice=(freq: number, p: PlayParams, when?: number): Voice=>{
    const t=Math.max(when??0,ac.currentTime+.005);
    const osc=ac.createOscillator(); osc.type=p.wave; osc.frequency.setValueAtTime(freq,t);
    if(p.pdAmt>0){ osc.frequency.setValueAtTime(freq*Math.pow(2,p.pdAmt/12),t); osc.frequency.exponentialRampToValueAtTime(freq,t+Math.max(p.pdTime||.08,.005)); }
    const og=ac.createGain(); og.gain.value=p.oscLvl;
    const nz=ac.createBufferSource(); nz.buffer=R.noiseBuf; nz.loop=true;
    const ng=ac.createGain(); ng.gain.value=p.noise*.8;
    const f=ac.createBiquadFilter(); f.type=p.ftype; f.frequency.setValueAtTime(p.cutoff,t); f.Q.setValueAtTime(p.res,t);
    const g=ac.createGain(), trem=ac.createGain(), vg=ac.createGain();
    trem.gain.value=tremBase(p); vg.gain.value=dbToGain(p.vol);
    const peak=.32;
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(peak,t+p.a);
    g.gain.setTargetAtTime(peak*p.s,t+p.a,Math.max(p.d/3,.002));
    if(p._sweep){ f.frequency.setValueAtTime(p._sweep[0],t); f.frequency.exponentialRampToValueAtTime(p._sweep[1],t+(p._dur||1)); }
    osc.connect(og); og.connect(f); nz.connect(ng); ng.connect(f);
    f.connect(g); g.connect(trem); trem.connect(vg); vg.connect(R.input);
    R.lfoPitch.connect(osc.detune); R.lfoFilt.connect(f.detune); R.lfoAmp.connect(trem.gain);
    osc.start(t); nz.start(t,Math.random()*1.5);
    const v: any={osc,nz,og,ng,f,g,trem,vg,p,freq};
    const t0=t;
    v.release=(rel: number, when?: number)=>{
      const now=ac.currentTime, t=Math.max(when??now,now), gg=g.gain;
      if(gg.cancelAndHoldAtTime)gg.cancelAndHoldAtTime(t); else {const cur=when==null?gg.value:envAt(p,t-t0); gg.cancelScheduledValues(t); gg.setValueAtTime(cur,t);}
      const r=Math.max(rel,.005); gg.setTargetAtTime(0,t,r/4);
      const end=t+r*1.8+.05; osc.stop(end); nz.stop(end);
      osc.onended=()=>{try{vg.disconnect(); R.lfoPitch.disconnect(osc.detune); R.lfoFilt.disconnect(f.detune); R.lfoAmp.disconnect(trem.gain);}catch(e){}};
    };
    v.kill=()=>{ const t=ac.currentTime, gg=g.gain;
      try{ if(gg.cancelAndHoldAtTime)gg.cancelAndHoldAtTime(t); else gg.cancelScheduledValues(t); gg.setTargetAtTime(0,t,.01); osc.stop(t+.06); nz.stop(t+.06); }catch(e){} };
    return v;
  };
  return R;
}
