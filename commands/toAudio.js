import { join } from 'node:path';
import { withTemp } from '../core/process.js';
import { maxInputBytes } from '../core/config.js';
import { selectMedia,MediaError,soundUnavailable } from '../core/mediaTarget.js';
import { downloadToFile } from '../services/mediaDownload.js';
import { extractAudio } from '../services/stickerEngine.js';

export async function toAudioCommand(sock,m){
    try{
        const target=selectMedia(m);
        if(target.kind==='sticker') throw soundUnavailable();
        if(!['video','audio'].includes(target.kind)) throw new MediaError('Responde a un video o audio con #toa.');
        await withTemp(async dir=>{
            const input=join(dir,'source');
            await downloadToFile(target,input,{limit:maxInputBytes});
            const output=await extractAudio(input,dir);
            await sock.sendMessage(m.key.remoteJid,{audio:{url:output},mimetype:'audio/mpeg',ptt:false},{quoted:m});
        });
    }catch(e){
        console.warn('Audio no procesado:',e instanceof MediaError?'validación':'conversión');
        await sock.sendMessage(m.key.remoteJid,{text:e instanceof MediaError?e.message:'No se pudo extraer el audio.'},{quoted:m});
    }
}
