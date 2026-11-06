import { clamp } from '../util';

/** AudioBuffer を 16bit PCM の WAV に変換する */
export function toWav(buf: AudioBuffer): Blob {
  const ch=buf.numberOfChannels, sr=buf.sampleRate, n=buf.length, ab=new ArrayBuffer(44+n*ch*2), dv=new DataView(ab);
  const ws=(o: number, str: string)=>{ for(let i=0;i<str.length;i++)dv.setUint8(o+i,str.charCodeAt(i)); };
  ws(0,'RIFF'); dv.setUint32(4,36+n*ch*2,true); ws(8,'WAVE'); ws(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
  dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*2,true); dv.setUint16(32,ch*2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,n*ch*2,true);
  const data=[...Array(ch)].map((_,i)=>buf.getChannelData(i)); let o=44;
  for(let i=0;i<n;i++)for(let k=0;k<ch;k++){ const v=clamp(data[k][i],-1,1); dv.setInt16(o,v<0?v*32768:v*32767,true); o+=2; }
  return new Blob([ab],{type:'audio/wav'});
}
