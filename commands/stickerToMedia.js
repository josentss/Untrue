import { join } from 'node:path';
import { withTemp } from '../core/process.js';
import { maxInputBytes } from '../core/config.js';
import { selectMedia,MediaError } from '../core/mediaTarget.js';
import { downloadToFile } from '../services/mediaDownload.js';
import { downloadableAudio } from '../core/stickerAudioCache.js';
import { convertWebp,inspectMedia } from '../services/stickerEngine.js';

export async function stickerToMediaCommand(sock,m){
    let stage='validation';
    try {
        const target=selectMedia(m);
        if(target.kind!=='sticker') throw new MediaError('Responde a un sticker con #sm.');
        console.info('Sticker recuperación '+JSON.stringify({audioSource:target.audioSource,animated:Boolean(target.media.isAnimated)}));
        await withTemp(async dir=>{
            const input=join(dir,'source.webp');
            stage='download';
            await downloadToFile(target,input,{limit:Math.min(maxInputBytes,8*1024*1024)});
            let audioPath;
            if(target.audio){
                stage='audio';
                if(!downloadableAudio(target.audio)) throw new MediaError('La referencia del sonido del sticker está incompleta. Vuelve a enviar el sticker y responde con #sm.');
                audioPath=join(dir,'sound.ogg');
                await downloadToFile({media:target.audio,type:'audio'},audioPath,{limit:1024*1024});
            }
            stage='conversion';
            const result=await convertWebp(input,dir,{audioPath});
            if(audioPath){
                const probe=await inspectMedia(result.path);
                if(!probe.streams?.some(s=>s.codec_type==='audio')) throw new MediaError('No se pudo conservar el sonido del sticker.');
            }
            stage='send';
            await sock.sendMessage(m.key.remoteJid,{[result.kind]:{url:result.path},mimetype:result.mime},{quoted:m});
            console.info('Sticker recuperación completada '+JSON.stringify({kind:result.kind,audio:Boolean(audioPath),audioSource:target.audioSource}));
        });
    } catch(e) {
        console.warn('Conversión de sticker no completada '+JSON.stringify({stage,reason:e instanceof MediaError?'validation':'operation'}));
        await sock.sendMessage(m.key.remoteJid,{text:e instanceof MediaError?e.message:(stage==='audio'?'No se pudo descargar el sonido del sticker. Vuelve a enviarlo y responde con #sm.':'No se pudo convertir el sticker.')},{quoted:m});
    }
}
