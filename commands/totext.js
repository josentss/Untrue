import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {withTemp} from '../core/process.js';
import {maxInputBytes} from '../core/config.js';
import {selectMedia,MediaError} from '../core/mediaTarget.js';
import {downloadToFile} from '../services/mediaDownload.js';
import {ocrImage,speechAudio,transcribe} from '../services/textUtility.js';
import {UtilityError,languages,MAX_TEXT,textChunks} from '../core/utilityPolicy.js';
export async function totextCommand(sock,m,args=[]){
    const jid=m.key.remoteJid;
    try{
        const target=selectMedia(m),image=target.kind==='image',language=(args[0]||'auto').toLowerCase();
        if(!['image','audio','video'].includes(target.kind))throw new UtilityError('Responde a una imagen, audio o video con #tot.');
        if(args.length>1||(image&&args.length)||(!image&&language!=='auto'&&!Object.hasOwn(languages,language)))throw new UtilityError('Usa #tot para OCR o transcripción automática; #tot es para indicar el idioma del audio.');
        if(!image&&!process.env.ASSEMBLYAI_KEY)throw new UtilityError('La transcripción no está configurada.');
        return await withTemp(async dir=>{
            const input=join(dir,'source');
            await downloadToFile(target,input,{limit:Math.min(maxInputBytes,(image?20:50)*1024*1024)});
            const text=image?await ocrImage(input,dir):await transcribe(await speechAudio(input,dir),{language});
            if(!text){await sock.sendMessage(jid,{text:'No se detectó texto.'},{quoted:m});return false;}
            if(Array.from(text).length>MAX_TEXT){
                const path=join(dir,'texto.txt');await writeFile(path,text,{mode:0o600});
                await sock.sendMessage(jid,{document:{url:path},mimetype:'text/plain',fileName:'texto.txt'},{quoted:m});return;
            }
            for(const [i,part] of textChunks(text).entries())await sock.sendMessage(jid,{text:(i?'':'*Texto extraído*\n\n')+part},{quoted:m});
        });
    }catch(e){console.warn('Texto utilidad fallida',{reason:e instanceof UtilityError||e instanceof MediaError?'validation':'processing'});await sock.sendMessage(jid,{text:e instanceof UtilityError||e instanceof MediaError?e.message:'No se pudo extraer el texto. Intenta con un archivo más corto o claro.'},{quoted:m});return false;}
}
