import type { Chapter } from '../types';

/* ================= BEAT コース（シーケンサー＆テクノ） =================
   トラック番号：0 KICK / 1 CLAP / 2 C.HAT / 3 O.HAT
   パターンは「トラック × 16ステップ」のベロシティ（0 = 鳴らさない）。 */
export type Pat = number[][];
export interface BeatDemo { bpm: number; bars: number; swing?: number; seq: any[]; acid?: any }

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
const D = (seq: any[], bars = 2, bpm = 124, swing = 0, acid?: any): { beat: BeatDemo } => ({ beat: { bpm, bars, swing, seq, acid } });
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

/* ---- 第2段階：ノートのお手本とヘルパー ---- */
const ACID_P = { cut: .28, res: .78, env: .62, dec: .3 };
const BASS_OFF = OFF.map(s => ({ s, n: 33, len: 1 }));
const BASS_EAR = [{ s: 2, n: 33, len: 1 }, { s: 6, n: 33, len: 1 }, { s: 10, n: 36, len: 1 }, { s: 14, n: 31, len: 1 }];
const ACID_SEQ = [45, 45, 57, 45, 48, 45, 55, 45, 45, 52, 45, 57, 45, 48, 43, 45];
const ACID_PLAIN = ACID_SEQ.map((n, s) => ({ s, n: s % 4 === 2 ? 57 : 45, len: 1 }));
const ACID_LINE = ACID_SEQ.map((n, s) => ({ s, n, len: 1, acc: [2, 6, 11].includes(s), sl: [3, 9].includes(s) }));
const CHORD_AM = OFF.flatMap(s => [57, 60, 64].map(n => ({ s, n, len: 2 })));
const CHORD_F = OFF.flatMap(s => [53, 57, 60].map(n => ({ s, n, len: 2 })));
const RAMP = (a: number, b: number) => ALL16.map(i => +(a + (b - a) * i / 15).toFixed(2));
const ARR_C = { d: [P16(FOUR), P16(), P16(EIGHTH, .6), P16(OFF, .7)] };
const ARR_A = { d: SAMPLE_BEAT.pat, n: [BASS_OFF, ACID_LINE, []], au: { acid: RAMP(.15, .7) } };
const ARR_D = { d: [P16(), P16(), P16(), P16(OFF, .5)], n: [[], [], CHORD_AM] };
const starts = (ns: any[]) => [...new Set(ns.map(n => n.s))].sort((a, b) => a - b);
const groups = (ns: any[]) => starts(ns).map(s => ns.filter(n => n.s === s));
const starts3 = (ns: any[]) => groups(ns).filter(g => g.length >= 3).map(g => g[0].s);
const low = (ns: any[]) => ns.length ? Math.min(...ns.map(n => n.n)) : 0;
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const rising = (a: number[] | null) => !!a && avg(a.slice(12)) - avg(a.slice(0, 4)) >= .35;
const kl = (e: any, pi: number) => e.D[pi][0].length === 0;
const songPats = (e: any): number[] => e.song.map((b: any) => b.p);
const brkThenKick = (e: any) => { const p = songPats(e); return p.some((x, i) => kl(e, x) && p.slice(i + 1).some(y => !kl(e, y))); };
const songNotes = (e: any) => { const p = songPats(e); return p.some(x => e.notes[x][0].length > 0 || e.notes[x][1].length > 0) && p.some(x => e.notes[x][2].length > 0); };
const songBrk = (e: any) => { const p = songPats(e); return p.some(x => kl(e, x)) && p.some(x => !kl(e, x)); };
const songAuto = (e: any) => songPats(e).some(x => !!(e.auto[x].acid || e.auto[x].master));

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
    c:e=>e.type==='wav'&&e.mode==='chain'&&e.used.slice(0,4).every(Boolean)&&(e.swing>.52||e.velVar)&&e.chain.includes(0)&&e.chain.includes(1)&&e.A.some((r,i)=>!eq(r,e.B[i]))},
  ]},
 {tag:'PIANO ROLL',title:'ピアノロール — ベースライン',mods:['roll'],
  intro:'ここからは「音の高さ」も並べます。ピアノロールは縦が音の高さ（左に鍵盤の音名）、横が時間。テクノのベースは、キックとぶつからないように拍の「裏」に置くのが定番で、これをオフビートベースといいます。下の PIANO ROLL で BASS トラックを使いましょう。',
  terms:['pianoroll','bassline','octave','gate'],
  steps:[
   {id:'b7-1',focus:'roll',t:'PIANO ROLL の BASS で、どこかのマスをクリックしてノートを置き、上の ▶ PLAY で再生しよう。左の音名が、そのノートの高さです。',c:e=>seq(e)&&e.N[0].length>0},
   {id:'b7-2',focus:'roll',ghostN:{t:0,notes:OFF.map(s=>({s,n:33}))},demo:D([{d:SAMPLE_BEAT.pat,n:[BASS_OFF,[],[]]}]),t:'点線のマス（A1 の高さで 3・7・11・15）にベースを置いて、四つ打ちのキックと一緒に再生しよう。キックの「ドン」の間に「ブン」が入ります。',
    c:e=>seq(e)&&four(e)&&eq(starts(e.N[0]),OFF)&&new Set(e.N[0].map(n=>n.n)).size===1},
   {id:'b7-3',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[{s:2,n:33,len:1},{s:6,n:45,len:1},{s:10,n:33,len:1},{s:14,n:45,len:1}],[],[]]}]),t:'ベースを4つ以上にして、高さを2種類以上にして再生しよう。同じ音名の1つ上（A1 → A2、12マス上）を混ぜると、「オクターブ」で跳ねるテクノらしいベースになります。',
    c:e=>seq(e)&&e.N[0].length>=4&&new Set(e.N[0].map(n=>n.n)).size>=2},
   {id:'b7-4',focus:'roll',t:'ノートの右端をドラッグして、長さ2マス以上のノートを作って再生しよう。長いノートは「ブーン」とのびて、ベースの印象がガラッと変わります。',c:e=>seq(e)&&e.N[0].some(n=>n.len>=2)},
   {id:'b7-5',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[BASS_EAR,[],[]]}]),t:'耳コピ：お手本を聴いて、同じベースラインを作って再生しよう（ヒント：置く場所はすべて裏。高さは「ラ・ラ・ド・ソ」＝ A1・A1・C2・G1）。',
    c:e=>seq(e)&&e.N[0].length===4&&BASS_EAR.every(b=>e.N[0].some(n=>n.s===b.s&&n.n===b.n))},
  ]},
 {tag:'ACID',title:'アシッドライン',mods:['roll'],
  intro:'「ビュワビュワ」とうねるアシッドラインは、テクノを代表する音。ACID トラックは強いクセ（レゾナンス）のフィルターを、ノートごとにパッと開いて閉じる仕組みです。CUTOFF でこもり具合、RESO でクセ、ENV MOD で開き具合、DECAY で閉じる速さを決め、ACCENT と SLIDE で表情をつけます。SOUND コース 03章のフィルターと同じ考え方です。',
  terms:['acid','cutoff','resonance','envmod','slide'],
  steps:[
   {id:'b8-1',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[],ACID_PLAIN,[]]}],2,124,SAMPLE_BEAT.swing),t:'ACID トラックに切り替えて、ノートを8つ以上並べて再生しよう（同じ高さが多くても OK。A2 あたりがおすすめ）。',c:e=>seq(e)&&e.N[1].length>=8},
   {id:'b8-2',focus:'roll',t:'再生したまま、ACID の CUTOFF ノブを大きく回そう。こもった音から明るい音へ、アシッドの「うねり」はここから生まれます。',c:e=>seq(e)&&e.acidSweep&&e.N[1].length>0},
   {id:'b8-3',focus:'roll',t:'RESO（レゾナンス）を 70% 以上にして再生しよう。「ミョン」としたクセが強くなり、いかにもアシッドな音に。',c:e=>seq(e)&&e.acid.res>=.7&&e.N[1].length>0},
   {id:'b8-4',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[],ACID_LINE.map(n=>({...n,sl:false})),[]]}],2,124,SAMPLE_BEAT.swing,ACID_P),t:'ノートをクリックして選び、下の ACCENT を2つ以上のノートにつけて再生しよう。アクセントのついた音だけ大きく、フィルターも大きく開きます。',
    c:e=>seq(e)&&e.N[1].filter(n=>n.acc).length>=2},
   {id:'b8-5',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[],ACID_LINE,[]]}],2,124,SAMPLE_BEAT.swing,ACID_P),t:'すぐ右どなりにノートがあるノートを選んで SLIDE をつけ、高さを変えて再生しよう。音が切れずに「ビューン」と次の高さへすべっていきます。',
    c:e=>seq(e)&&e.N[1].some(n=>n.sl&&e.N[1].some(q=>q.s===n.s+n.len&&q.n!==n.n))},
  ]},
 {tag:'CHORD',title:'スケールとコード',mods:['roll'],
  intro:'好きな高さを適当に並べると、音が濁って聞こえることがあります。曲の「キー（中心の音）」と「スケール（使う音の並び）」を決めれば外れません。テクノでは暗くてクールなマイナースケールが定番。CHORD トラックで3つの音を重ねた和音（コード）を鳴らし、こだま（ディレイ）で響かせると、ダブテクノ風になります。',
  terms:['key','scale','chord','stab'],
  steps:[
   {id:'b9-1',focus:'roll',t:'KEY が A、MINOR になっているのを確かめて、SCALE LOCK を ON にしよう。緑のすじの行がスケールの音で、ななめ線の行には置けなくなります。左の音名のオレンジ線はキーの音（A）です。',c:e=>e.key.lock},
   {id:'b9-2',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[],[],[57,60,64].map(n=>({s:0,n,len:4}))]}]),t:'CHORD トラックに切り替え、TRIAD を ON にして、1マス目の A3 をクリックしてコードを置き、再生しよう。1回のクリックで、スケールの音から3つ（ラ・ド・ミ）が重なります。',
    c:e=>seq(e)&&groups(e.N[2]).some(g=>g.length>=3)},
   {id:'b9-3',focus:'roll',ghostN:{t:2,notes:OFF.flatMap(s=>[57,60,64].map(n=>({s,n,len:2})))},demo:D([{d:SAMPLE_BEAT.pat,n:[[],[],CHORD_AM]}]),t:'コードを裏（3・7・11・15）に4つ置いて再生しよう。短く切ったコードを「スタブ」といい、こだまが裏から裏へ広がっていきます。',
    c:e=>seq(e)&&eq(starts3(e.N[2]),OFF)},
   {id:'b9-4',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[],[],CHORD_AM]},{d:SAMPLE_BEAT.pat,n:[[],[],CHORD_F]}],4),t:'コード進行：PATTERN A を COPY して B に PASTE し、B のコードを別の高さ（たとえば F3）に置きかえて、CHAIN を A → B（→ A → B）にして再生しよう。2小節ごとに景色が変わります。',
    c:e=>seq(e)&&e.mode==='chain'&&e.chain.includes(0)&&e.chain.includes(1)&&low(e.notes[0][2])>0&&low(e.notes[1][2])>0&&low(e.notes[0][2])!==low(e.notes[1][2])},
  ]},
 {tag:'AUTOMATION',title:'オートメーション',mods:['roll'],
  intro:'テクノの盛り上げは「抜き差し」と「じわじわ」。オートメーションは、つまみの動きを記録して自動で動かしてくれる機能です。PIANO ROLL の下の AUTOMATION レーンにバーを描くと、マスごとに値が変わります。描いた内容はパターンごとに保存されます。',
  terms:['automation','build','sweep'],
  steps:[
   {id:'b10-1',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[[],ACID_LINE,[]],au:{acid:RAMP(.1,.85)}}],2,124,SAMPLE_BEAT.swing,ACID_P),t:'AUTOMATION を ACID CUTOFF にして、左は低く・右へいくほど高くなるように描き、アシッドのある状態で再生しよう。1小節のなかで、だんだん音が開いていきます。',
    c:e=>seq(e)&&e.N[1].length>0&&rising(e.auto[e.cur].acid)},
   {id:'b10-2',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[BASS_OFF,[],[]],au:{master:RAMP(.12,1)}}]),t:'今度は MASTER FILTER に切り替えて、最初は 40% 以下（こもる）、最後は 85% 以上（全開）になるように描いて再生しよう。曲全体がこもった所から開いていく、これが「ビルドアップ」です。',
    c:e=>seq(e)&&rising(e.auto[e.cur].master)&&e.auto[e.cur].master[0]<=.4&&e.auto[e.cur].master[15]>=.85},
   {id:'b10-3',focus:'roll',demo:D([{d:SAMPLE_BEAT.pat,n:[BASS_OFF,[],[]]},{d:SAMPLE_BEAT.pat,n:[BASS_OFF,[],[]]},{d:SAMPLE_BEAT.pat,n:[BASS_OFF,[],[]]},{d:FILL_B,n:[BASS_OFF,[],[]],au:{master:RAMP(.12,1)}}],4,124,SAMPLE_BEAT.swing),t:'PATTERN A の MASTER FILTER は OFF にして、PATTERN B にだけ上がっていく MASTER FILTER を描き、CHAIN を A → A → A → B にして再生しよう。4小節目だけ、こもってから開いて「戻ってくる」感じが出ます。',
    c:e=>seq(e)&&e.mode==='chain'&&e.chain.includes(0)&&e.chain.includes(1)&&!e.auto[0].master&&rising(e.auto[1].master)},
  ]},
 {tag:'ARRANGE',title:'アレンジ — 抜き差し',mods:['song'],
  intro:'曲は「パターンの並べ方」で決まります。キックとハイハットだけで始まるイントロ、キックを抜いて空気を変えるブレイク、そしてキックが戻ってくるドロップ。この「抜いて、戻す」気持ちよさがテクノの醍醐味です。パターンは A〜D の4つに増え、下の ARRANGE でブロックを並べて1曲にします。',
  terms:['arrangement','intro','breakdown','drop'],
  steps:[
   {id:'b11-1',focus:'seq',demo:D([ARR_C]),t:'PATTERN C を選び、キックとハイハットだけ（クラップ・ベース・アシッド・コードなし）のイントロ用パターンを作ろう。',
    c:e=>e.D[2][0].length>0&&(e.D[2][2].length>0||e.D[2][3].length>0)&&e.D[2][1].length===0&&e.notes[2].every(t=>t.length===0)},
   {id:'b11-2',focus:'seq',demo:D([ARR_D]),t:'PATTERN D を選び、キックなしのブレイク用パターンを作ろう。コードやアシッドだけを鳴らすと、ふわっと宙に浮いたような感じになります（COPY / PASTE も使えます）。',
    c:e=>e.D[3][0].length===0&&e.notes[3].some(t=>t.length>0)},
   {id:'b11-3',focus:'song',demo:D([ARR_C,ARR_C,ARR_A,ARR_A,ARR_D,ARR_D,ARR_A,ARR_A],8,124,SAMPLE_BEAT.swing,ACID_P),t:'ARRANGE で「＋ ブロック追加」を使い、C → A → D → A のように、ブレイク（NO KICK）のあとにキックのあるパターンが戻る並びを作ろう。MODE を SONG にして再生します。',
    c:e=>seq(e)&&e.mode==='song'&&e.songBars>=4&&brkThenKick(e)},
   {id:'b11-4',focus:'song',t:'そのまま聴いて、ブレイクからキックが戻ってくる瞬間（ドロップ）まで再生しよう。ブロックの小節数を減らすと早くたどり着けます。',c:e=>e.type==='drop'},
  ]},
 {tag:'FINAL',title:'卒業制作 — 1曲つくる',mods:['song'],
  intro:'最終章。これまでの道具をぜんぶ使って、32小節（BPM 124 で約1分）のテクノトラックをつくり、WAV で書き出しましょう。イントロで始めて、ベースやアシッドで引っぱり、ブレイクで抜いて、ドロップで戻る。4つの条件をそろえたら書き出しです。',
  terms:['loop','normalize'],
  steps:[
   {id:'b12-1',focus:'song',t:'ARRANGE の合計を 32 小節以上にしよう（ブロックの BARS を 4 や 8 にすると早い）。',c:e=>e.songBars>=32},
   {id:'b12-2',focus:'song',t:'SONG に並べたパターンのどこかで、BASS か ACID と、CHORD の両方を使おう。',c:e=>songNotes(e)},
   {id:'b12-3',focus:'song',t:'SONG に、キックなしのブレイク（NO KICK）と、キックのあるブロックの両方を入れよう。',c:e=>songBrk(e)},
   {id:'b12-4',focus:'song',t:'SONG に並べたパターンのどこかで、オートメーション（ACID CUTOFF か MASTER FILTER）を使おう。',c:e=>songAuto(e)},
   {id:'b12-5',focus:'seq',t:'MODE を SONG にして ⇩ WAV で書き出そう。上の4つがそろっていれば卒業です。おつかれさまでした！',
    c:e=>e.type==='wav'&&e.mode==='song'&&e.songBars>=32&&songNotes(e)&&songBrk(e)&&songAuto(e)},
  ]},
];
