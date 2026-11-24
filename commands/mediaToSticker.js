import { join } from 'node:path';
import { withTemp } from '../core/process.js';
import { maxInputBytes } from '../core/config.js';
import { selectMedia,modeOf,MediaError,soundUnavailable } from '../core/mediaTarget.js';
import { downloadToFile } from '../services/mediaDownload.js';
import { createSticker } from '../services/stickerEngine.js';

export async function mediaToStickerCommand(sock,m,args){
    try {
        const mode=modeOf(args,['recortar','audio']);
        if(mode==='audio') throw soundUnavailable();
        const target=selectMedia(m);
        if(!['image','video','sticker'].includes(target.kind)) throw new MediaError('Responde a una imagen, GIF, video o sticker con #s.');
        if(target.kind==='video'&&Number(target.media.seconds)>10) throw new MediaError('Máximo 10 segundos de video.');
        await withTemp(async dir=>{
            const input=join(dir,'source');
            await downloadToFile(target,input,{limit:Math.min(maxInputBytes,40*1024*1024)});
            const result=await createSticker(input,dir,{kind:target.kind,name:m.pushName,crop:mode==='recortar'});
            await sock.sendMessage(m.key.remoteJid,{sticker:{url:result.path},isAnimated:result.animated,width:512,height:512},{quoted:m});
        });
    } catch(e) {
        console.warn('Sticker no procesado:',e instanceof MediaError?'validación':'conversión');
        await sock.sendMessage(m.key.remoteJid,{text:e instanceof MediaError?e.message:'No se pudo crear el sticker. Comprueba el formato o utiliza un archivo más corto.'},{quoted:m});
    }
}
