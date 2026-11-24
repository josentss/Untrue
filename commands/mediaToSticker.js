import { join } from 'node:path';
import { withTemp } from '../core/process.js';
import { maxInputBytes } from '../core/config.js';
import { selectMedia,MediaError } from '../core/mediaTarget.js';
import { downloadToFile } from '../services/mediaDownload.js';
import { createSticker } from '../services/stickerEngine.js';
import { stickerChatType,shouldAttachStickerSound } from '../core/stickerDestination.js';
import { soundStickersEnabled } from '../core/soundStickerCodec.js';
import { prepareStickerAudio,uploadStickerAudio } from '../services/stickerSound.js';

export async function mediaToStickerCommand(sock,m){
    try {
        const target=selectMedia(m);
        if(!['image','video','sticker'].includes(target.kind)) throw new MediaError('Responde a una imagen, GIF, video o sticker con #s.');
        if(target.kind==='video'&&Number(target.media.seconds)>10) throw new MediaError('Máximo 10 segundos de video.');
        await withTemp(async dir=>{
            const input=join(dir,'source');
            const start=Date.now();
            await downloadToFile(target,input,{limit:Math.min(maxInputBytes,40*1024*1024)});
            const downloadMs=Date.now()-start;
            const conversionStart=Date.now();
            const result=await createSticker(input,dir,{kind:target.kind});
            const conversionMs=Date.now()-conversionStart;
            let audioMs=0,audioDurationMs=0;
            const content={sticker:{url:result.path},isAnimated:result.animated,width:512,height:512};
            if(shouldAttachStickerSound({enabled:soundStickersEnabled(),jid:m.key.remoteJid,animated:result.animated,kind:target.kind,hasAudio:Boolean(target.audio)})){
                const audioStart=Date.now();
                let audioInput=input;
                if(target.audio){
                    audioInput=join(dir,'source-audio');
                    await downloadToFile({media:target.audio,type:'audio'},audioInput,{limit:1024*1024});
                }
                const clip=await prepareStickerAudio(audioInput,dir,result.durationMs);
                if(clip){ content.audioMessage=await uploadStickerAudio(sock,clip); audioDurationMs=clip.durationMs; }
                audioMs=Date.now()-audioStart;
            }
            const sendStart=Date.now();
            await sock.sendMessage(m.key.remoteJid,content,{quoted:m});
            console.info('Sticker métricas '+JSON.stringify({chat:stickerChatType(m.key.remoteJid),downloadMs,conversionMs,audioMs,sendMs:Date.now()-sendStart,durationMs:result.durationMs,audioDurationMs,fps:result.fps,frames:result.frames,bytes:result.bytes}));
            if(content.audioMessage) console.info('Sticker sonoro enviado: '+stickerChatType(m.key.remoteJid));
        });
    } catch(e) {
        console.warn('Sticker no procesado:',e instanceof MediaError?'validación':'conversión');
        await sock.sendMessage(m.key.remoteJid,{text:e instanceof MediaError?e.message:'No se pudo crear el sticker. Comprueba el formato o utiliza un archivo más corto.'},{quoted:m});
    }
}
