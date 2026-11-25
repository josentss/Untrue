import {join} from 'node:path';
import {withTemp} from '../core/process.js';
import {maxInputBytes} from '../core/config.js';
import {selectMedia,MediaError} from '../core/mediaTarget.js';
import {downloadToFile} from '../services/mediaDownload.js';
import {documentExt,renderDocument} from '../services/documentConverter.js';
import {UtilityError} from '../core/utilityPolicy.js';
export async function toimgCommand(sock,m,args=[]){
    const jid=m.key.remoteJid;
    try{
        const target=selectMedia(m);
        if(target.kind!=='document')throw new UtilityError('Responde a un documento PDF, Word o Excel con #toi.');
        const ext=documentExt(target.media);
        if(args.length>1||args.length===1&&!/^[1-9]\d{0,8}$/.test(args[0]))throw new UtilityError('Usa #toi o #toi 2 para una página específica.');
        await withTemp(async dir=>{
            const input=join(dir,'source.'+ext);
            await downloadToFile(target,input,{limit:Math.min(maxInputBytes,50*1024*1024)});
            const files=await renderDocument(input,ext,dir,args,{limit:maxInputBytes});
            let sent=0;
            try{for(const f of files){await sock.sendMessage(jid,{image:{url:f.path},caption:'Página '+f.page+'/'+f.total},{quoted:m});sent++;}}
            catch{throw new UtilityError('Se enviaron '+sent+' de '+files.length+' páginas. No se pudo completar el envío.');}
        });
    }catch(e){console.warn('Documento conversión fallida',{reason:e instanceof UtilityError||e instanceof MediaError?'validation':'processing'});await sock.sendMessage(jid,{text:e instanceof UtilityError||e instanceof MediaError?e.message:'No se pudo convertir el documento. Comprueba el formato y que no esté protegido.'},{quoted:m});return false;}
}
