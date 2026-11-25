import { musicCommand,musicQuery } from './musicDownload.js';
import { getYoutubeInfo } from '../services/musicDownloader.js';
import { publicError } from '../core/downloadPolicy.js';
export const youtubeCommand=(sock,m,args)=>musicCommand(sock,m,args,{platform:'youtube',kind:'video',command:'ytv'});
export async function youtubeInfoCommand(sock,m,args){
    const jid=m.key.remoteJid,query=musicQuery(m,args);
    if(!query){await sock.sendMessage(jid,{text:'Uso: #ytinfo [enlace o búsqueda]'},{quoted:m});return false;}
    try{
        const info=await getYoutubeInfo(query);
        await sock.sendMessage(jid,{text:info.title+'\n'+info.author+' · '+info.durationFormatted+'\n'+info.url+(info.description?'\n\n'+info.description:'')},{quoted:m});
    }catch(error){
        const e=publicError(error);console.warn('Información YouTube fallida '+JSON.stringify({reason:e.code}));
        await sock.sendMessage(jid,{text:e.message},{quoted:m});return false;
    }
}
export default youtubeCommand;
