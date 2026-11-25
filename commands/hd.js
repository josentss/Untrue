import {join} from 'node:path';
import {withTemp} from '../core/process.js';
import {maxInputBytes} from '../core/config.js';
import {hdMode,hdTarget,HDMediaError,statusRequest,HD_LIMITS} from '../core/hdPolicy.js';
import {MediaError} from '../core/mediaTarget.js';
import {downloadToFile} from '../services/mediaDownload.js';
import {prepareHD,mediaContent} from '../services/hdMedia.js';
const errorText=e=>e instanceof HDMediaError||e instanceof MediaError?e.message:'No se pudo preparar el archivo multimedia.';
export async function hdCommand(sock,m,args=[]){
    try{
        const mode=hdMode(args),target=hdTarget(m);
        await withTemp(async dir=>{
            const input=join(dir,'source');
            await downloadToFile(target,input,{limit:maxInputBytes});
            const file=await prepareHD(input,target.kind,dir,{mode,limit:maxInputBytes});
            await sock.sendMessage(m.key.remoteJid,mediaContent(file),{quoted:m});
        });
    }catch(e){console.warn('HD: operación fallida',{reason:e instanceof HDMediaError||e instanceof MediaError?'validation':'processing'});await sock.sendMessage(m.key.remoteJid,{text:errorText(e)},{quoted:m});return false;}
}
// No status reading, forwarding, auto-view, retry or implicit audience.
export async function statusCommand(sock,m,args=[]){
    let attempted=false;
    try{
        const {audience,target}=statusRequest(m,args);
        await withTemp(async dir=>{
            const input=join(dir,'source'),limit=Math.min(maxInputBytes,HD_LIMITS.statusBytes);
            await downloadToFile(target,input,{limit});
            const file=await prepareHD(input,target.kind,dir,{status:true,limit});
            attempted=true;
            await sock.sendMessage('status@broadcast',mediaContent(file),{statusJidList:audience});
        });
        await sock.sendMessage(m.key.remoteJid,{text:'Estado enviado a la audiencia configurada.'},{quoted:m});
    }catch(e){
        console.warn('Estado: operación no confirmada',{reason:attempted?'send':'validation_or_processing'});
        await sock.sendMessage(m.key.remoteJid,{text:attempted?'No se pudo confirmar el estado. Revisa WhatsApp antes de volver a publicarlo.':errorText(e)},{quoted:m});return false;
    }
}
