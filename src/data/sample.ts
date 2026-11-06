import type { Project } from '../types';

/** お手本プロジェクト（オリジナルの起動音） */
export const SAMPLE: any = {bpm:100,master:0,normalize:false,tracks:[
  {name:'RISER',vol:-6,pan:-.25,p:{vol:0,oscLvl:0,noise:.75,ftype:'highpass',cutoff:900,res:1,a:1.15,d:.1,s:1,r:.12,revMix:.4,revTime:3},clips:[{start:0,len:2,note:60}]},
  {name:'BOOM',vol:0,pan:0,p:{vol:0,wave:'sine',a:.003,d:1.3,s:0,r:1.3,revMix:.3,revTime:4},clips:[{start:2,len:1,note:40}]},
  {name:'PAD',vol:-9,pan:0,p:{vol:0,wave:'sawtooth',cutoff:1600,res:1.5,a:.9,d:1.5,s:.6,r:3,lfoTarget:'filter',lfoRate:.2,lfoDepth:.35,revMix:.7,revTime:6},
    clips:[{start:2,len:5,note:52},{start:2,len:5,note:59},{start:2,len:5,note:64},{start:2,len:5,note:68}]},
  {name:'SHIMMER',vol:-5,pan:.4,p:{vol:0,wave:'triangle',a:.003,d:.5,s:0,r:.6,revMix:.55,revTime:5,dlyMix:.35,dlyTime:.3,dlyFb:.45},
    clips:[{start:2.25,len:.25,note:76},{start:2.75,len:.25,note:83},{start:3.25,len:.25,note:88},{start:4,len:.5,note:92}]}]};
