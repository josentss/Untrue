import { join } from 'node:path';
import { withTemp } from '../core/process.js';
import { maxInputBytes } from '../core/config.js';
import { selectMedia,MediaError } from '../core/mediaTarget.js';
import { downloadToFile } from '../services/mediaDownload.js';
import { convertWebp } from '../services/stickerEngine.js';

export async function stickerToMediaCommand(sock,m){
    try {
        const target=selectMedia(m);
        if(target.kind!=='sticker') throw new MediaError('Responde a un sticker con #sm.');
        await withTemp(async dir=>{
            const input=join(dir,'source.webp');
            await downloadToFile(target,input,{limit:Math.min(maxInputBytes,8*1024*1024)});
            let audioPath;
            if(target.audio){
                audioPath=join(dir,'sound.ogg');
                await downloadToFile({media:target.audio,type:'audio'},audioPath,{limit:1024*1024});
            }
            const result=await convertWebp(input,dir,{audioPath});
            await sock.sendMessage(m.key.remoteJid,{[result.kind]:{url:result.path},mimetype:result.mime},{quoted:m});
        });
    } catch(e) {
        console.warn('Conversión de sticker no completada:',e instanceof MediaError?'validación':'conversión');
        await sock.sendMessage(m.key.remoteJid,{text:e instanceof MediaError?e.message:'No se pudo convertir el sticker.'},{quoted:m});
    }
}
