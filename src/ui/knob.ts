import { $, h } from './dom';
import { clamp } from '../util';

export interface KnobOptions {
  label: string; term?: string; min: number; max: number; log?: boolean;
  fmt: (v: number) => string; color: string; small?: boolean;
  get: () => number; set: (v: number) => void; def: number;
}
export type KnobEl = HTMLElement & { sync(): void };

const TRACK = 2 * Math.PI * 24, ARC = TRACK * .75;

export function createKnob(o: KnobOptions): KnobEl {
  const {label,term,min,max,log,fmt,color,small}=o;
  const {get,set,def}=o;
  const toN=(v: number)=>clamp(log?Math.log(v/min)/Math.log(max/min):(v-min)/(max-min),0,1);
  const fromN=(n: number)=>log?min*Math.pow(max/min,n):min+(max-min)*n;
  let n=toN(get());
  const capFill=color==='var(--grey)'?'#fbfbf8':color==='var(--ink)'?'#151515':color;
  const indCol=color==='var(--grey)'||color==='var(--yellow)'?'#151515':'#fff';
  const svg=h('span',{html:`<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" fill="none" stroke="#c8c7bf" stroke-width="${small?5:3}" stroke-linecap="round" stroke-dasharray="${ARC} ${TRACK}" transform="rotate(135 30 30)"/><circle class="arc" cx="30" cy="30" r="24" fill="none" stroke="${color}" stroke-width="${small?5:3}" stroke-linecap="round" stroke-dasharray="0 ${TRACK}" transform="rotate(135 30 30)"/><circle cx="30" cy="30" r="17" fill="${capFill}" stroke="#151515" stroke-opacity=".12"/><g class="ind"><line x1="30" y1="24" x2="30" y2="15" stroke="${indCol}" stroke-width="${small?5:3}" stroke-linecap="round"/></g></svg>`});
  const val=h('div',{class:'kval'}), lab=h('div',{class:'klabel','data-term':term||null},label);
  const el=small?h('div',{class:'knob sm',tabindex:0,role:'slider','aria-label':label},svg,h('div',{},lab,val))
                :h('div',{class:'knob',tabindex:0,role:'slider','aria-label':label},svg,lab,val);
  const arc=$('.arc',el), ind=$('.ind',el);
  function paint(){ arc.setAttribute('stroke-dasharray',`${ARC*n} ${TRACK}`); ind.setAttribute('transform',`rotate(${-135+270*n} 30 30)`); const t=fmt(get()); val.textContent=t; el.setAttribute('aria-valuetext',t); }
  function setN(nn: number){ n=clamp(nn,0,1); set(fromN(n)); paint(); }
  let sy=0,sn=0;
  el.addEventListener('pointerdown',e=>{ e.stopPropagation(); try{el.setPointerCapture(e.pointerId);}catch(_){} sy=e.clientY; sn=n; el.focus(); e.preventDefault(); });
  el.addEventListener('pointermove',e=>{ if(!(e.buttons&1))return; setN(sn+(sy-e.clientY)/(e.shiftKey?900:180)); });
  el.addEventListener('wheel',e=>{ e.preventDefault(); setN(n-Math.sign(e.deltaY)*(e.shiftKey?.005:.025)); },{passive:false});
  el.addEventListener('dblclick',()=>{ n=toN(def); set(def); paint(); });
  el.addEventListener('keydown',e=>{ const st=e.shiftKey?.005:.025; if(e.key==='ArrowUp'||e.key==='ArrowRight'){setN(n+st);e.preventDefault();} if(e.key==='ArrowDown'||e.key==='ArrowLeft'){setN(n-st);e.preventDefault();} });
  el.sync=()=>{ n=toN(get()); paint(); };
  paint();
  return el;
}
