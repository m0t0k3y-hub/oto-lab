import type { Chapter } from '../types';

/* ================= BEAT コース（シーケンサー＆テクノ） =================
   トラック番号：0 KICK / 1 CLAP / 2 C.HAT / 3 O.HAT
   パターンは「トラック × 16ステップ」のベロシティ（0 = 鳴らさない）。 */
export type Pat = number[][];
export interface BeatDemo { bpm: number; bars: number; swing?: number; seq: Pat[] }

/** 置くマス（0始まり）から 16 ステップの配列をつくる */
export const P16 = (on: number[] = [], v = 1): number[] => { const a = new Array(16).fill(0); on.forEach(i => a[i] = v); return a; };
export const ALL16 = [...Array(16).keys()];
export const FOUR = [0, 4, 8, 12];          // 1・5・9・13（表）
export const OFF = [2, 6, 10, 14];          // 3・7・11・15（裏）
export const EIGHTH = [0, 2, 4, 6, 8, 10, 12, 14];

/** B00 のお手本：ミニマル系・軽め（BPM 124、スウィング 54%） */
const HAT_V = [.9, .4, .6, .4];
export const SAMPLE_BEAT: { bpm: number; swing: number; pat: Pat } = {
  bpm: 124, swing: .54,
  pat: [P16(FOUR), P16([12], .8), ALL16.map(i => HAT_V[i % 4]), P16(OFF, .7)],
};
const pat = (k: number[] = [], c: number[] = [], ch: number[] = [], oh: number[] = []): Pat => [P16(k), P16(c), P16(ch), P16(oh)];
const D = (seq: Pat[], bars = 2, bpm = 124, swing = 0): { beat: BeatDemo } => ({ beat: { bpm, bars, swing, seq } });
const SAMPLE_D = (bpm = 124, bars = 2) => D([SAMPLE_BEAT.pat], bars, bpm, SAMPLE_BEAT.swing);

/* ---- クリア判定のヘルパー ---- */
const eq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const has = (a: number[], b: number[]) => b.every(x => a.includes(x));
const seq = (e: any) => e.type === 'seq';
const four = (e: any) => eq(e.P[0], FOUR);
const SAMPLE_ON = SAMPLE_BEAT.pat.map(r => r.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0));
const sameAsSample = (P: number[][]) => P.every((r, i) => eq(r, SAMPLE_ON[i]));
const total = (P: number[][]) => P.reduce((a, r) => a + r.length, 0);

const FILL_B = [P16([0, 4, 8, 12, 13]), P16([12, 14, 15], .8), SAMPLE_BEAT.pat[2], P16(OFF, .7)];

export const BCH: Chapter[] = [
 {tag:'DAW',title:'DAWってなに？',mods:['seq'],
  intro:'DAW（ダウ）は、パソコンの中にある音楽スタジオ。そのなかで「いつ、どの音を鳴らすか」を覚えておいて、自動で演奏してくれるのがシーケンサーです。まずは完成したテクノのループを聴いてみましょう。',
  terms:['daw','sequencer','loop','playhead'],
  steps:[
   {id:'b0-1',focus:'seq',t:'SEQUENCER の ▶ PLAY（または Space）を押して、お手本のループを再生しよう。',c:e=>seq(e)},
   {id:'b0-2',focus:'seq',t:'黒い枠（再生ヘッド）が左から右へ進み、右端まで行くと左に戻るのを見ながら、2周以上聴こう。同じところをくり返すのが「ループ」です。',c:e=>seq(e)&&e.loops>=2},
   {id:'b0-3',focus:'seq',t:'KICK の M（ミュート）を押して再生しよう。キックが消えると、急に頼りない音になります。',c:e=>seq(e)&&e.mute[0]},
   {id:'b0-4',focus:'seq',t:'ミュートを戻して、光っているマスをどれか1つクリックして消してから再生しよう。シーケンサーは「マスに置いた音を、その時間に鳴らす」だけの道具です。',c:e=>seq(e)&&!e.mute[0]&&total(e.P)>0&&!SAMPLE_ON.every((r,i)=>has(e.P[i],r))},
   {id:'b0-5',focus:'seq',t:'CLEAR を押して全部消そう。次の章から、このループを自分で組み立てていきます（「お手本ループ」でいつでも戻せます）。',c:e=>total(e.P)===0},
  ]},
 {tag:'KICK',title:'キック — 四つ打ち',mods:['seq'],
  intro:'テクノの心臓はキック（バスドラム）の「ドン」。16マスで1小節、4マスで1拍です。1拍に1回キックを鳴らすのが「四つ打ち」で、テクノもハウスもここから始まります。点線のマスは「ここに置こう」の目印です。',
  terms:['kick','step','bar','fourfloor'],
  steps:[
   {id:'b1-1',focus:'seq',ghost:{0:[0]},t:'KICK の1マス目をクリックして置き、再生しよう。1小節に1回だけ「ドン」と鳴ります。',c:e=>seq(e)&&e.P[0].includes(0)},
   {id:'b1-2',focus:'seq',ghost:{0:FOUR},demo:D([pat(FOUR)]),t:'点線のマス（1・5・9・13）を全部埋めて再生しよう。これが四つ打ちです。',c:e=>seq(e)&&four(e)},
   {id:'b1-3',focus:'seq',t:'2マス目や11マス目など、点線以外にもキックを足して再生しよう。「ドドン」と前のめりになるのを聞き比べて。',c:e=>seq(e)&&has(e.P[0],FOUR)&&e.P[0].length>4},
   {id:'b1-4',focus:'seq',demo:D([pat([0,4,8,10])]),t:'耳コピ：点線は出ません。お手本を聴いて、同じキックを打ち込んで再生しよう（ヒント：4つのうち最後の1つだけ早い）。',c:e=>seq(e)&&eq(e.P[0],[0,4,8,10])},
  ]},
 {tag:'HAT',title:'ハイハット — 裏打ち',mods:['seq'],
  intro:'四つ打ちのすき間に入る「ツ」がハイハット。拍と拍のちょうど真ん中（裏、オフビート）に開いたハイハットを置くと、「ドン・ツ・ドン・ツ」というテクノの基本のゆれが生まれます。',
  terms:['hihat','openclose','offbeat'],
  steps:[
   {id:'b2-1',focus:'seq',ghost:{0:FOUR,3:OFF},demo:D([pat(FOUR,[],[],OFF)]),t:'KICK を四つ打ちにして、O.HAT（開いたハイハット）を3・7・11・15マス目に置いて再生しよう。',c:e=>seq(e)&&four(e)&&eq(e.P[3],OFF)},
   {id:'b2-2',focus:'seq',ghost:{3:FOUR},demo:D([pat(FOUR,[],[],FOUR)]),t:'O.HAT を1・5・9・13（キックと同じ「表」）に移して再生しよう。ノリが平らになるのを聞き比べて。',c:e=>seq(e)&&eq(e.P[3],FOUR)},
   {id:'b2-3',focus:'seq',ghost:{2:EIGHTH,3:OFF},demo:D([pat(FOUR,[],EIGHTH,OFF)]),t:'O.HAT を裏に戻し、C.HAT（閉じたハイハット）を1マスおき（1・3・5…15）に8つ置いて再生しよう。これを「8分音符で刻む」といいます。',c:e=>seq(e)&&eq(e.P[3],OFF)&&eq(e.P[2],EIGHTH)},
  ]},
 {tag:'CLAP',title:'クラップ — 2拍目と4拍目',mods:['seq'],
  intro:'1・3拍目にキックがあるなら、2・4拍目には手拍子。これを「バックビート」といって、ロックでもポップスでも同じです。テクノではクラップで鳴らします。これでドラムの4点セットがそろいます。',
  terms:['clap','backbeat','sixteenth'],
  steps:[
   {id:'b3-1',focus:'seq',ghost:{1:[4,12]},demo:D([pat(FOUR,[4,12])]),t:'CLAP を5・13マス目に置いて、キックと一緒に再生しよう。',c:e=>seq(e)&&eq(e.P[1],[4,12])&&e.P[0].length>0},
   {id:'b3-2',focus:'seq',ghost:{2:ALL16},demo:D([pat(FOUR,[4,12],ALL16)]),t:'C.HAT を16マス全部埋めて再生しよう。シャカシャカと細かく刻む「16分音符」です。',c:e=>seq(e)&&e.P[2].length===16},
   {id:'b3-3',focus:'seq',t:'KICK（四つ打ち）・CLAP・C.HAT・O.HAT の4つを全部使って再生しよう。基本のテクノビートの完成です。',c:e=>seq(e)&&four(e)&&e.P.every(r=>r.length>0)},
   {id:'b3-4',focus:'seq',demo:SAMPLE_D(),t:'耳コピ：B00 のお手本ループを聴いて、同じ並びを作って再生しよう（強弱とスウィングはまだ気にしなくてOK。クラップは1回だけ）。',c:e=>seq(e)&&sameAsSample(e.P)},
  ]},
 {tag:'TEMPO',title:'テンポと拍',mods:['seq'],
  intro:'BPM は1分間に何拍あるか。並びはそのままでも、BPM を変えると曲の性格が変わります。テクノはだいたい 125〜135 くらい。1マスは16分音符なので、BPM が上がるほど1マスの時間が短くなります。BPM ノブは上下にドラッグで回せます。',
  terms:['bpm','beat','tempo','taptempo'],
  steps:[
   {id:'b4-1',focus:'seq',demo:SAMPLE_D(95),t:'BPM を 100 以下にして再生しよう。ゆったりした、ヒップホップ寄りの速さ。',c:e=>seq(e)&&e.bpm<=100&&total(e.P)>0},
   {id:'b4-2',focus:'seq',demo:SAMPLE_D(145),t:'BPM を 140 以上にして再生しよう。前のめりの、ハードテクノ寄りの速さ。',c:e=>seq(e)&&e.bpm>=140&&total(e.P)>0},
   {id:'b4-3',focus:'seq',demo:SAMPLE_D(126),t:'BPM を 122〜128 にして再生しよう。ミニマルテクノの気持ちいい速さです。',c:e=>seq(e)&&e.bpm>=122&&e.bpm<=128&&total(e.P)>0},
   {id:'b4-4',focus:'seq',demo:SAMPLE_D(126,8),t:'タップテンポ：「お手本を聞く」を押して、キックに合わせて TAP を4回以上たたき、お手本の BPM を当てよう（±3 まで）。',c:e=>e.type==='tap'&&Math.abs(e.bpm-126)<=3},
  ]},
 {tag:'GROOVE',title:'グルーヴ — 強弱とスウィング',mods:['seq'],
  intro:'同じ強さで鳴らし続けると、機械っぽく聞こえます。人間がたたくと自然に強弱がつき、少しだけ跳ねる。ベロシティ（強さ）とスウィング（跳ね）で「ノリ」、つまりグルーヴを作りましょう。光っているマスを上下にドラッグすると強さが変わります。',
  terms:['velocity','accent','swing','groove'],
  steps:[
   {id:'b5-1',focus:'seq',demo:D([[P16(FOUR),P16(),ALL16.map(i=>i%4?.35:1),P16()]]),t:'C.HAT を16マス埋めたまま、1・5・9・13 以外のマスのベロシティを 50% 以下に下げて再生しよう。「強・弱・弱・弱」になるだけで、一気にノリが出ます。',
    c:e=>seq(e)&&e.P[2].length===16&&e.V[2].every((v,i)=>i%4?v<=.5:v>=.8)},
   {id:'b5-2',focus:'seq',demo:D([[P16(FOUR),P16(),ALL16.map(i=>HAT_V[i%4]),P16()]]),t:'3・7・11・15（裏）の C.HAT を 55〜80% にして、「強・弱・中・弱」にして再生しよう。',
    c:e=>seq(e)&&e.P[2].length===16&&e.V[2].every((v,i)=>i%4===0?v>=.8:i%2===0?(v>.5&&v<=.8):v<=.5)},
   {id:'b5-3',focus:'seq',demo:D([SAMPLE_BEAT.pat],2,124,.72),t:'SWING を 70% 以上にして再生しよう。偶数マスが遅れて、「タッタ・タッタ」と大きく跳ねます。',c:e=>seq(e)&&e.swing>=.7&&total(e.P)>0},
   {id:'b5-4',focus:'seq',demo:D([SAMPLE_BEAT.pat],2,124,.57),t:'SWING を 52〜62% に戻して再生しよう。テクノでは「気づくか気づかないか」くらいの跳ねがちょうどいい。A/B ボタンでスウィングなしと聞き比べてみて。',c:e=>seq(e)&&e.hiSwing&&e.swing>=.52&&e.swing<=.62&&total(e.P)>0},
  ]},
 {tag:'PATTERN',title:'パターンとフィル',mods:['seq'],
  intro:'テクノのコツは「ほとんど同じ」をくり返して、ときどき少しだけ変えること。1小節のまとまりをパターンと呼び、コピーして変化をつけ、つなげて曲の部品にします。最後に WAV で書き出せば、ループ素材の完成です。',
  terms:['pattern','fill','chain','render','wav'],
  steps:[
   {id:'b6-1',focus:'seq',t:'PATTERN A を選んで COPY → PATTERN B を選んで PASTE しよう。',c:e=>total(e.A)>0&&e.A.every((r,i)=>eq(r,e.B[i]))},
   {id:'b6-2',focus:'seq',demo:D([FILL_B],2),t:'PATTERN B の最後の4マス（13〜16）だけを変えて「フィル」を作り、B を再生しよう。クラップやキックを連打するのが定番です。',
    c:e=>seq(e)&&e.cur===1&&e.mode==='pat'&&e.A.some((r,i)=>!eq(r,e.B[i]))&&e.A.every((r,i)=>eq(r.filter(x=>x<12),e.B[i].filter(x=>x<12)))},
   {id:'b6-3',focus:'seq',demo:D([SAMPLE_BEAT.pat,SAMPLE_BEAT.pat,SAMPLE_BEAT.pat,FILL_B],4,124,SAMPLE_BEAT.swing),t:'CHAIN の4つの枠を A → A → A → B にして、MODE を CHAIN に切り替えて再生しよう。4小節目でフィルが入り、また1小節目に戻ります。',
    c:e=>seq(e)&&e.mode==='chain'&&eq(e.chain,[0,0,0,1])},
   {id:'b6-4',focus:'seq',t:'⇩ WAV を押して書き出そう。CHAIN なら並べたとおり、PATTERN なら今のパターンを4小節ぶん書き出します。動画やほかの DAW で、ループ素材としてそのまま使えます。',c:e=>e.type==='wav'},
   {id:'b6-5',focus:'seq',demo:SAMPLE_D(124,4),t:'卒業課題：B00 のお手本に負けない、自分だけのミニマルループを作って書き出そう。条件は「4トラックすべてを使う」「強弱かスウィングを入れる」「A と B をつなげた CHAIN」の3つ。',
    c:e=>e.type==='wav'&&e.mode==='chain'&&e.used.every(Boolean)&&(e.swing>.52||e.velVar)&&e.chain.includes(0)&&e.chain.includes(1)&&e.A.some((r,i)=>!eq(r,e.B[i]))},
  ]},
 {soon:2,tag:'PIANO ROLL',title:'ピアノロール — ベースライン',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'ACID',title:'アシッドライン',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'CHORD',title:'スケールとコード',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'AUTOMATION',title:'オートメーション',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'ARRANGE',title:'アレンジ — 抜き差し',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'FINAL',title:'卒業制作',mods:[],intro:'',terms:[],steps:[]},
];
