import { withMusicDownload } from '../services/musicDownloader.js';
import { publicError } from '../core/downloadPolicy.js';
import { quotedText } from '../core/urls.js';
export function musicQuery(m,args){
    return (args||[]).join(' ').trim()||quotedText(m).match(/https:\/\/[^\s]+/)?.[0]||'';
}
export async function musicCommand(sock,m,args,{platform,kind,command}){
    const jid=m.key.remoteJid,query=musicQuery(m,args);
    if(!query){await sock.sendMessage(jid,{text:'Uso: #'+command+' [enlace o búsqueda]'},{quoted:m});return;}
    try{
        // Validate before notifying the user that a download started.
        const {mediaInput}=await import('../core/downloadPolicy.js');mediaInput(platform,query);
        await sock.sendMessage(jid,{text:kind==='audio'?'Descargando audio…':'Descargando video…'},{quoted:m});
        await withMusicDownload(platform,kind,query,async({filePath,info,bytes,height})=>{
            const caption=info.title+'\n'+info.author+' · '+info.durationFormatted+' · '+(bytes/1048576).toFixed(2)+' MB'+(kind==='video'?' · '+height+'p':' · MP3');
            const safeName=info.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)||'media';
            const started=Date.now();
            if(kind==='video')await sock.sendMessage(jid,{video:{url:filePath},mimetype:'video/mp4',caption,fileName:safeName+'.mp4'},{quoted:m});
            else{
                await sock.sendMessage(jid,{audio:{url:filePath},mimetype:'audio/mpeg',ptt:false,fileName:safeName+'.mp3'},{quoted:m});
                await sock.sendMessage(jid,{text:caption},{quoted:m});
            }
            console.info('Descarga enviada '+JSON.stringify({platform,kind,sendMs:Date.now()-started}));
        });
    }catch(error){
        const e=publicError(error);
        console.warn('Descarga fallida '+JSON.stringify({platform,kind,reason:e.code}));
        await sock.sendMessage(jid,{text:e.message},{quoted:m});
    }
}
