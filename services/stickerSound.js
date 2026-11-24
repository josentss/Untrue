import { prepareWAMessageMedia } from 'baileys';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { run } from '../core/process.js';
import { ffmpeg } from '../core/config.js';
import { inspectMedia } from './stickerEngine.js';
import { MediaError } from '../core/mediaTarget.js';
const logger=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(k=>[k,()=>{}]));
logger.child=()=>logger;
logger.level='silent';
export async function prepareStickerAudio(input,dir,durationMs){
    const info=await inspectMedia(input);
    if(!info.streams?.some(s=>s.codec_type==='audio')) return null;
    const seconds=Math.min(5, durationMs/1000, Number(info.format?.duration)||5);
    if(seconds<=0) return null;
    const path=join(dir,'sticker-audio.ogg');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpeg,mpegts,mp3,wav,ogg,flac,aac','-i',input,'-map','0:a:0','-vn','-t',String(seconds),'-ac','1','-ar','48000','-c:a','libopus','-b:a','48k','-threads','2',path],{timeout:20000});
    const probe=await inspectMedia(path);
    if(!probe.streams?.some(s=>s.codec_name==='opus')||(await stat(path)).size>128*1024) throw new MediaError('No se pudo preparar el audio del sticker.');
    return {path,seconds:Math.max(1,Math.ceil(Number(probe.format.duration)||seconds))};
}
export async function uploadStickerAudio(sock,clip){
    const prepared=await prepareWAMessageMedia({audio:{url:clip.path},mimetype:'audio/ogg; codecs=opus',seconds:clip.seconds,ptt:false},{upload:sock.waUploadToServer,logger,mediaUploadTimeoutMs:20000});
    const audio=prepared.audioMessage;
    if(!audio?.mediaKey||!audio?.directPath) throw new MediaError('No se pudo subir el audio del sticker.');
    return audio;
}
