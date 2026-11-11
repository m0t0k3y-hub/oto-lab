import type { Chapter } from '../types';
import { P16 } from './beatChapters';

/* ================= MIX コース（ミックスで仕上げる） =================
   ストリップ番号は BEAT と同じ：0 KICK / 1 CLAP / 2 C.HAT / 3 O.HAT / 4 BASS / 5 ACID / 6 CHORD */
export interface Strip { vol: number; pan: number; hpf: number; low: number; mid: number; high: number; sc: number; mute: boolean; solo: boolean }
export const flatStrip = (vol = 0): Strip => ({ vol, pan: 0, hpf: 20, low: 0, mid: 0, high: 0, sc: 0, mute: false, solo: false });

/** わざと崩したミックス：ベースが大きすぎてキックが埋もれ、全部が真ん中、コードとハットに不要な低音、マスターは音割れ */
export const BAD_STRIPS: Strip[] = [0, 2, 3, 2, 5, 2, 3].map(v => flatStrip(v));

const FOUR = [0, 4, 8, 12], OFF = [2, 6, 10, 14], ALL = [...Array(16).keys()];
const HATV = [.9, .45, .65, .45];
const DRUMS = [P16(FOUR), P16([4, 12], .85), ALL.map(i => HATV[i % 4]), P16(OFF, .75)];
const FILL = [P16([0, 4, 8, 12, 14]), P16([4, 12, 13, 15], .85), ALL.map(i => HATV[i % 4]), P16(OFF, .75)];
const BASS = OFF.map(s => ({ s, n: 33, len: 1 }));
const ACID = [45, 45, 57, 45, 48, 45, 55, 45, 45, 52, 45, 57, 45, 48, 43, 45].map((n, s) => ({ s, n, len: 1, acc: [2, 6, 11].includes(s), sl: [3, 9].includes(s) }));
const CHORD = [2, 10].flatMap(s => [45, 48, 52].map(n => ({ s, n, len: 3 })));      // 低めに積んだコード（ベースとぶつかる）
const AU = { acid: null, master: null };
export const BAD_MIX = {
  bpm: 126, swing: .54, acid: { cut: .32, res: .72, env: .6, dec: .3 },
  bars: [0, 0, 0, 1].map(k => ({ d: k ? FILL : DRUMS, n: [BASS, ACID, CHORD], au: AU })),
};

/* ---- クリア判定のヘルパー ---- */
const mix = (e: any) => e.type === 'mix' && e.playing;
const S = (e: any, i: number) => e.strips[i];
const soloOnly = (e: any, i: number) => e.strips.every((s: Strip, k: number) => s.solo === (k === i));
const noSolo = (e: any) => e.strips.every((s: Strip) => !s.solo);
const center = (e: any, i: number) => Math.abs(S(e, i).pan) < .1;
const sounding = (e: any) => e.peak > -40;

export const MCH: Chapter[] = [
 {tag:'MIXER',title:'MIX ってなに？',mods:['mix'],
  intro:'ミックスは、たくさんの音を「混ぜて、聴きやすく整える」作業です。ミキサーには、トラックごとに1本ずつ「チャンネルストリップ」が並んでいて、フェーダー（音量）やパン（左右）、EQ（音色の帯域）を調整します。この章の曲は、わざとミックスを崩してあります。まずは何が起きているか、耳で確かめましょう。',
  terms:['mixer','channelstrip','fader','solo'],
  steps:[
   {id:'m0-1',focus:'mix',t:'MIXER の ▶ PLAY（または Space）で、崩れたお手本の曲を再生しよう。なんだかベースばかり大きくて、キックの「ドン」が聞こえにくいはず。',c:e=>mix(e)},
   {id:'m0-2',focus:'mix',t:'KICK の S（ソロ）を押して、キックだけを聴こう。ソロは「そのトラックだけ聴く」ボタンです。',c:e=>mix(e)&&soloOnly(e,0)},
   {id:'m0-3',focus:'mix',t:'今度は BASS だけをソロにして聴こう。キックもベースも、同じくらい低い音だとわかります。',c:e=>mix(e)&&soloOnly(e,4)},
   {id:'m0-4',focus:'mix',t:'ソロを全部解除して、BASS のフェーダーを 0 dB 以下まで下げて再生しよう。埋もれていたキックが前に出てきます。',c:e=>mix(e)&&noSolo(e)&&S(e,4).vol<=0},
  ]},
 {tag:'BALANCE',title:'バランス — 音量の基準',mods:['mix'],
  intro:'デジタルの音には 0 dB という天井があり、全部の音を足して超えると音割れ（クリップ）します。そこで「いちばん大事な音」を基準に決め、ほかをそれより小さく合わせていくのがバランスの基本。テクノの基準はキックです。天井までの余白は「ヘッドルーム」と呼びます。',
  terms:['headroom','peak','balance'],
  steps:[
   {id:'m1-1',focus:'spec',t:'MASTER の PEAK を見ながら再生しよう。赤い CLIP が点いたら音割れしています。フェーダーを全体的に下げて、PEAK を −1 dB 以下にしよう。',c:e=>mix(e)&&noSolo(e)&&e.strips.every((s: Strip)=>!s.mute)&&sounding(e)&&e.peak<=-1},
   {id:'m1-2',focus:'mix',t:'基準を決めよう：KICK のフェーダーを −8 〜 −4 dB にして再生しよう。',c:e=>mix(e)&&S(e,0).vol>=-8&&S(e,0).vol<=-4},
   {id:'m1-3',focus:'mix',t:'ほかの6つのトラックを、すべて KICK より小さいフェーダー位置にして、PEAK を −3 dB 以下（ヘッドルーム 3 dB 以上）にして再生しよう。',
    c:e=>mix(e)&&noSolo(e)&&sounding(e)&&e.peak<=-3&&e.strips.slice(1).every((s: Strip)=>s.vol<S(e,0).vol)},
   {id:'m1-4',focus:'spec',t:'A/B ボタンで「直す前（BEFORE）」と「今（AFTER）」を切り替えて聞き比べよう（2回以上押す）。音量差に惑わされず、どちらが聴きやすいか確かめて。',c:e=>mix(e)&&e.abCount>=2},
  ]},
 {tag:'PAN',title:'パン — 左右に配置する',mods:['mix'],
  intro:'全部の音が真ん中に集まると、ぶつかり合って窮屈になります。パンで左右に散らすと、それぞれが聞き取りやすくなります。ただし、キック・ベース・クラップのような「土台」は真ん中が鉄則。スマホのスピーカーのようなモノラル（左右がまとめて1つ）で聴いても崩れないかの確認も大切です。',
  terms:['pan','mono','stereo'],
  steps:[
   {id:'m2-1',focus:'mix',t:'C.HAT を左（L30 以上）、O.HAT を右（R30 以上）に振って再生しよう。ヘッドホンだと、ハイハットが左右から聞こえます。',c:e=>mix(e)&&S(e,2).pan<=-.3&&S(e,3).pan>=.3},
   {id:'m2-2',focus:'mix',t:'ACID と CHORD を、左右の反対側に（20 以上ずつ）振って再生しよう。ぶつかっていた2つが、すっと分かれます。',c:e=>mix(e)&&Math.abs(S(e,5).pan)>=.2&&Math.abs(S(e,6).pan)>=.2&&S(e,5).pan*S(e,6).pan<0},
   {id:'m2-3',focus:'mix',t:'KICK・CLAP・BASS は真ん中（C）のままにして再生しよう。土台がセンターにあると、どこで聴いても安定します。',c:e=>mix(e)&&center(e,0)&&center(e,1)&&center(e,4)&&(S(e,2).pan!==0||S(e,3).pan!==0)},
   {id:'m2-4',focus:'spec',t:'MASTER の MONO を ON にして再生しよう。左右がまとまっても、どのトラックも消えずに聞こえれば OK（確認したら OFF に戻してかまいません）。',c:e=>mix(e)&&e.mono&&e.strips.some((s: Strip)=>Math.abs(s.pan)>=.2)},
  ]},
 {tag:'EQ',title:'EQ — 帯域の住み分け',mods:['mix','spec'],
  intro:'EQ（イコライザー）は、音の「低い所・真ん中・高い所」を、それぞれ足したり削ったりする道具です。低い音が欲しいのはキックとベースだけ。ほかのトラックの不要な低音を LOW CUT で削ると、キックとベースのための場所が空きます。同じ帯域の音どうしが隠し合うことを「マスキング」といいます。SPECTRUM で目でも確かめましょう。',
  terms:['eq','lowcut','freq','masking'],
  steps:[
   {id:'m3-1',focus:'spec',t:'CHORD のストリップ名をクリックして選び、再生しながら SPECTRUM を見よう。色の付いた線が CHORD。左の低い帯域まで山が伸びています。',c:e=>mix(e)&&e.sel===6},
   {id:'m3-2',focus:'mix',t:'CHORD の LOW CUT を 200 Hz 以上にして再生しよう。低い所の山が消えて、ベースとのにごりが取れます。',c:e=>mix(e)&&S(e,6).hpf>=200},
   {id:'m3-3',focus:'mix',t:'C.HAT と O.HAT の LOW CUT を、どちらも 400 Hz 以上にして再生しよう。ハイハットに低音はいりません。',c:e=>mix(e)&&S(e,2).hpf>=400&&S(e,3).hpf>=400},
   {id:'m3-4',focus:'mix',t:'KICK の LOW を +2 dB 以上に上げ、BASS の HIGH を −3 dB 以下に下げて再生しよう。キックはより太く、ベースは耳ざわりな上の帯域がとれます。',c:e=>mix(e)&&S(e,0).low>=2&&S(e,4).high<=-3},
   {id:'m3-5',focus:'mix',t:'ACID の MID を +3 dB 以上にして再生しよう。アシッドの「ミョン」というクセが前に出てきます。',c:e=>mix(e)&&S(e,5).mid>=3},
  ]},
 {tag:'SIDECHAIN',title:'サイドチェイン — キックに道をあける',mods:['mix','spec'],
  intro:'キックが鳴った瞬間だけ、ほかの音を少し下げて道をあける。これがサイドチェイン（ダッキング）です。キックがはっきり聞こえるうえに、ほかの音が「うねる」ように動いて、テクノらしいノリが生まれます。強くかけて大きくうねらせる使い方は「ポンピング」と呼ばれます。',
  terms:['sidechain','ducking','pumping'],
  steps:[
   {id:'m4-1',focus:'mix',t:'BASS の SC（サイドチェイン）を 50% 以上にして再生しよう。キックのたびにベースがスッと引っ込みます。',c:e=>mix(e)&&S(e,4).sc>=.5},
   {id:'m4-2',focus:'spec',t:'CHORD の SC を 60% 以上、MASTER の SC RELEASE を 300 ms 以上にして再生しよう。コードが「ふわっ、ふわっ」と戻ってくる、大きなポンピングになります。',c:e=>mix(e)&&S(e,6).sc>=.6&&e.scRel>=.3},
   {id:'m4-3',focus:'spec',t:'SC RELEASE を 80 〜 180 ms に短くして再生しよう。うねりがタイトになって、キックとベースがかみ合った、テクノらしい締まったノリに。',c:e=>mix(e)&&S(e,4).sc>=.5&&e.scRel>=.08&&e.scRel<=.18},
   {id:'m4-4',focus:'mix',t:'第1段階のまとめ：PEAK −1 dB 以下・KICK と BASS は真ん中・CHORD の LOW CUT 200 Hz 以上・BASS の SC 50% 以上、をすべて満たして再生しよう。最初の崩れたミックスと A/B で聞き比べてみて。',
    c:e=>mix(e)&&noSolo(e)&&sounding(e)&&e.peak<=-1&&center(e,0)&&center(e,4)&&S(e,6).hpf>=200&&S(e,4).sc>=.5},
  ]},
 {soon:2,tag:'COMP',title:'コンプレッサー',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'SEND',title:'センドとリターン',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'MASTER',title:'マスター',mods:[],intro:'',terms:[],steps:[]},
 {soon:2,tag:'FINAL',title:'卒業課題',mods:[],intro:'',terms:[],steps:[]},
];
