import { prepareWAMessageMedia } from 'baileys';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { run } from '../core/process.js';
import { ffmpeg } from '../core/config.js';
import { inspectMedia,LIMITS } from './stickerEngine.js';
import { MediaError } from '../core/mediaTarget.js';
const logger=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(k=>[k,()=>{}]));
logger.child=()=>logger;
logger.level='silent';
export async function prepareStickerAudio(input,dir,durationMs){
    const info=await inspectMedia(input);
    const track=info.streams?.find(s=>s.codec_type==='audio');
    if(!track) return null;
    const visualSeconds=Math.min(LIMITS.durationMs,Number(durationMs))/1000;
    const trackSeconds=Number(track.duration);
    const formatSeconds=Number(info.format?.duration);
    const available=Number.isFinite(trackSeconds)&&trackSeconds>0?trackSeconds:Number.isFinite(formatSeconds)&&formatSeconds>0?formatSeconds:visualSeconds;
    const seconds=Math.min(visualSeconds,available);
    if(!Number.isFinite(seconds)||seconds<=0) return null;
    const path=join(dir,'sticker-audio.ogg');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpeg,mpegts,mp3,wav,ogg,flac,aac','-i',input,'-map','0:a:0','-vn','-t',String(seconds),'-ac','1','-ar','48000','-c:a','libopus','-b:a','48k','-vbr','off','-threads','2',path],{timeout:20000});
    const probe=await inspectMedia(path);
    if(!probe.streams?.some(s=>s.codec_name==='opus')||(await stat(path)).size>128*1024) throw new MediaError('No se pudo preparar el audio del sticker.');
    const duration=Number(probe.format.duration);
    if(!Number.isFinite(duration)||duration<=0||duration>seconds+0.1) throw new MediaError('Duración de audio inválida.');
    const effective=Math.min(seconds,Math.max(0,duration-0.0065));
    return {path,seconds:Math.max(1,Math.ceil(effective-0.001)),durationMs:Math.round(effective*1000)};
}
export async function uploadStickerAudio(sock,clip){
    const prepared=await prepareWAMessageMedia({audio:{url:clip.path},mimetype:'audio/ogg; codecs=opus',seconds:clip.seconds,ptt:false},{upload:sock.waUploadToServer,logger,mediaUploadTimeoutMs:20000});
    const audio=prepared.audioMessage;
    if(!audio?.mediaKey||!audio?.directPath) throw new MediaError('No se pudo subir el audio del sticker.');
    return audio;
}
