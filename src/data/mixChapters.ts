import type { Chapter } from '../types';
import { P16 } from './beatChapters';

/* ================= MIX コース（ミックスで仕上げる） =================
   ストリップ番号は BEAT と同じ：0 KICK / 1 CLAP / 2 C.HAT / 3 O.HAT / 4 BASS / 5 ACID / 6 CHORD */
export interface Strip {
  vol: number; pan: number; hpf: number; low: number; mid: number; high: number; sc: number; mute: boolean; solo: boolean;
  /** コンプレッサー（cRat = 1 で効かない） */ cThr: number; cRat: number; cAtk: number; cRel: number; cMk: number;
  /** センド（共有リバーブ・ディレイへ送る量） */ rev: number; dly: number;
}
export const flatStrip = (vol = 0): Strip => ({ vol, pan: 0, hpf: 20, low: 0, mid: 0, high: 0, sc: 0, mute: false, solo: false,
  cThr: 0, cRat: 1, cAtk: .01, cRel: .15, cMk: 0, rev: 0, dly: 0 });
/** マスター：バスコンプ（bRat = 1 で効かない）、リミッター、リターン */
export interface Master { bThr: number; bRat: number; limOn: boolean; ceil: number; drive: number; revRet: number; revHpf: number; dlyRet: number }
export const DEF_MASTER: Master = { bThr: -12, bRat: 1, limOn: false, ceil: -1, drive: 0, revRet: .8, revHpf: 20, dlyRet: .7 };

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
const final3 = (e: any) => center(e, 0) && center(e, 4) && S(e, 2).hpf >= 300 && S(e, 3).hpf >= 300 && S(e, 6).hpf >= 150;
const final4 = (e: any) => S(e, 4).sc >= .3 && e.strips.some((s: Strip) => s.cRat >= 2) && e.strips.some((s: Strip) => s.rev > 0 || s.dly > 0);

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
 {tag:'COMP',title:'コンプレッサー — 粒をそろえる',mods:['det'],
  intro:'コンプレッサーは「大きすぎる所だけを自動で小さくする」道具です。THRESHOLD（しきい値）を超えた分を、RATIO（比率）の割合で縮めます。どれだけ縮めたかは GR（ゲインリダクション）メーターでわかります。縮めて小さくなった分は MAKEUP で戻します。トラックを選ぶと、下の STRIP DETAIL で操作できます。',
  terms:['compressor','threshold','ratio','gainreduction','makeup'],
  steps:[
   {id:'m5-1',focus:'det',t:'MIXER で CLAP の名前をクリックして選び、STRIP DETAIL の COMP で THRESH を下げて再生しよう。GR メーターが −3 dB 以上動けば、コンプが効いています。',c:e=>mix(e)&&e.gr[1]<=-3},
   {id:'m5-2',focus:'det',t:'CLAP の RATIO を 4:1 以上にして、GR が −3 〜 −12 dB くらいに収まるように THRESH を調整して再生しよう。クラップの強さのばらつきがそろいます。',c:e=>mix(e)&&S(e,1).cRat>=4&&e.gr[1]<=-3&&e.gr[1]>=-12},
   {id:'m5-3',focus:'det',t:'CLAP の ATTACK を 20 ms 以上にして再生しよう。コンプが効き始めるまでの時間を遅らせると、「パシッ」という頭の部分が残って、メリハリが出ます。',c:e=>mix(e)&&S(e,1).cAtk>=.02&&e.gr[1]<=-2},
   {id:'m5-4',focus:'det',t:'CLAP の MAKEUP を +2 dB 以上にして、縮んで小さくなった分を戻して再生しよう。',c:e=>mix(e)&&S(e,1).cMk>=2&&e.gr[1]<=-2},
   {id:'m5-5',focus:'det',t:'BASS を選んで、RATIO 3:1 以上・GR −2 dB 以上になるようにコンプをかけて再生しよう。ベースの音量が安定して、曲の土台がどっしりします。',c:e=>mix(e)&&S(e,4).cRat>=3&&e.gr[4]<=-2},
  ]},
 {tag:'SEND',title:'センドとリターン — 奥行きをつくる',mods:['det','spec'],
  intro:'リバーブやディレイを、トラックごとに別々に用意するのではなく、1つの共有の響き（リターン）に、各トラックから必要な量だけ「送る（センド）」のがミックスの定番です。たくさん送った音は奥に、送らない音は手前に聞こえます。ただし、キックやベースのような低い音に響きを足すと、にごるので送りません。',
  terms:['send','returnbus','reverb','delay'],
  steps:[
   {id:'m6-1',focus:'det',t:'CHORD を選び、STRIP DETAIL の REV（リバーブへのセンド）を 30% 以上にして再生しよう。コードがすっと奥に下がり、空間が広がります。',c:e=>mix(e)&&S(e,6).rev>=.3},
   {id:'m6-2',focus:'det',t:'ACID を選び、DLY（ディレイへのセンド）を 25% 以上にして再生しよう。アシッドのこだまが、裏のリズムで追いかけてきます。',c:e=>mix(e)&&S(e,5).dly>=.25},
   {id:'m6-3',focus:'spec',t:'KICK と BASS の REV は 0% のまま、MASTER の RETURN にある REV LOW CUT を 300 Hz 以上にして再生しよう。響きから低音を抜くと、にごらずに広がりだけが残ります。',c:e=>mix(e)&&S(e,0).rev===0&&S(e,4).rev===0&&e.master.revHpf>=300&&S(e,6).rev>0},
   {id:'m6-4',focus:'det',t:'奥行きの差をつけよう：CLAP の REV を 10 〜 25%（少しだけ）、CHORD の REV はそれより多くして再生しよう。手前のクラップと、奥のコード。前後の立体感が出ます。',c:e=>mix(e)&&S(e,1).rev>=.1&&S(e,1).rev<=.25&&S(e,6).rev>S(e,1).rev},
  ]},
 {tag:'MASTER',title:'マスター — まとめて仕上げる',mods:['spec'],
  intro:'最後に、全部が混ざった音（マスター）を仕上げます。BUS COMP で全体を軽く縮めると、バラバラだった音が1つにまとまります（グルー）。LIMITER は「天井（CEILING）より上には絶対に出さない」強いコンプで、音割れを防ぎながら DRIVE で全体の音量を押し上げます。聴いたときの大きさは LUFS（ラウドネス）で表します。',
  terms:['buscomp','limiter','ceiling','loudness'],
  steps:[
   {id:'m7-1',focus:'spec',t:'BUS COMP の RATIO を 2:1 前後（1.5 以上）にして、BUS GR が −0.5 〜 −5 dB くらい動くように THRESH を調整して再生しよう。全体がぎゅっとまとまります。',c:e=>mix(e)&&e.master.bRat>=1.5&&e.busGr<=-.5&&e.busGr>=-5},
   {id:'m7-2',focus:'spec',t:'LIMITER を ON にして、CEILING を −1 dB にして再生しよう。どんなに大きくしても、PEAK は −1 dB 付近で止まります。',c:e=>mix(e)&&e.master.limOn&&e.master.ceil<=-1&&e.peak<=-.7&&e.peak>-30},
   {id:'m7-3',focus:'spec',t:'DRIVE を上げて、LUFS を −11 〜 −7 にして再生しよう。クラブで鳴らすテクノくらいの音圧です。LIM GR が大きくなりすぎると、音がつぶれて平らになるので注意。',c:e=>mix(e)&&e.master.limOn&&e.lufs>=-11&&e.lufs<=-7},
   {id:'m7-4',focus:'spec',t:'今度は DRIVE を下げて、LUFS を −15 〜 −13 にして再生しよう。音楽配信サービスは −14 LUFS くらいに音量をそろえて再生するので、それより大きくしても、配信ではそのぶん下げられます。',c:e=>mix(e)&&e.lufs>=-15&&e.lufs<=-13},
   {id:'m7-5',focus:'spec',t:'⇩ WAV を押して書き出そう。書き出したファイル全体の PEAK と LUFS が表示されます。',c:e=>e.type==='wav'},
  ]},
 {tag:'FINAL',title:'卒業課題 — 崩れたミックスを直す',mods:['mix','det','spec'],
  intro:'MIX コースの総仕上げ。素材を「お手本（崩れたミックス）」にして、これまでの道具をぜんぶ使ってミックスを直し、WAV で書き出しましょう。下の4つの条件がそろった状態で書き出せば卒業です。そのあとは「自分の BEAT の曲」に切り替えて、あなたの曲も仕上げてみてください。',
  terms:['mixer'],
  steps:[
   {id:'m8-1',focus:'spec',t:'音割れなし：書き出した WAV の PEAK を −0.5 dB 以下にしよう（LIMITER を使うと確実）。',c:e=>e.type==='wav'&&e.src==='demo'&&e.wavPeak<=-.5},
   {id:'m8-2',focus:'spec',t:'音圧：書き出した WAV の LUFS を −12 〜 −8 にしよう。',c:e=>e.type==='wav'&&e.src==='demo'&&e.wavLufs>=-12&&e.wavLufs<=-8},
   {id:'m8-3',focus:'mix',t:'住み分け：KICK と BASS は真ん中、C.HAT と O.HAT の LOW CUT は 300 Hz 以上、CHORD の LOW CUT は 150 Hz 以上にしよう。',c:e=>e.src==='demo'&&final3(e)},
   {id:'m8-4',focus:'det',t:'動きと空間：BASS の SC を 30% 以上、どれかのトラックにコンプ（RATIO 2:1 以上）、どれかのトラックに REV か DLY のセンドを使おう。',c:e=>e.src==='demo'&&final4(e)},
   {id:'m8-5',focus:'spec',t:'4つの条件をすべて満たした状態で ⇩ WAV を書き出そう。おめでとう、これで MIX コース卒業です！',c:e=>e.type==='wav'&&e.src==='demo'&&e.wavPeak<=-.5&&e.wavLufs>=-12&&e.wavLufs<=-8&&final3(e)&&final4(e)},
  ]},
];
