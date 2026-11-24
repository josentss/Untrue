import { withSocialDownload } from '../services/socialDownloader.js';
import { publicError,DownloadError } from '../core/downloadPolicy.js';
import { socialUrl } from '../core/socialPolicy.js';
import { quotedText } from '../core/urls.js';
export function socialQuery(m,args,platform,allowPosition=false){
    let [value,...rest]=args||[],position;
    if(allowPosition&&/^\d+$/.test(value||'')){position=Number(value);value=rest.shift();}
    if(!value){
        for(const url of quotedText(m).match(/https:\/\/[^\s]+/g)||[]){
            try{socialUrl(platform,url);value=url;break;}catch{}
        }
    }
    if(!value)throw new DownloadError('input','Responde a un enlace público o incluye el enlace con el comando.');
    socialUrl(platform,value);
    return {query:value,position};
}
export async function socialCommand(sock,m,args,{platform,kind,command,allowPosition=false}){
    const jid=m.key.remoteJid;
    try{
        const {query,position}=socialQuery(m,args,platform,allowPosition);
        await sock.sendMessage(jid,{text:'Descargando contenido…'},{quoted:m});
        await withSocialDownload(platform,query,{kind,position},async(item,index,total)=>{
            const content={[item.kind]:{url:item.path},mimetype:item.mime};
            if(item.kind==='audio')content.ptt=false;
            else if(total>1)content.caption=(index+1)+'/'+total;
            await sock.sendMessage(jid,content,{quoted:m});
        });
    }catch(error){
        const e=publicError(error);
        console.warn('Red social descarga fallida '+JSON.stringify({platform,kind,reason:e.code}));
        await sock.sendMessage(jid,{text:e.message},{quoted:m});
    }
}
