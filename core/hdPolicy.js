import {userJid,isOwner} from './identity.js';
import {unwrap} from './messages.js';
export class HDMediaError extends Error {}
export const HD_LIMITS=Object.freeze({
    imagePixels:32*1024*1024,imageEdge:4096,imageBytes:16*1024*1024,
    videoEdge:1920,videoShortEdge:1080,videoSeconds:180,videoBytes:64*1024*1024,
    statusEdge:1280,statusShortEdge:720,statusSeconds:30,statusBytes:16*1024*1024
});
export function hdMode(args=[]){
    if(!args.length)return 'native';
    if(args.length===1&&args[0].toLowerCase()==='archivo')return 'original';
    throw new HDMediaError('Usa #hd o #hd archivo sobre una imagen o video.');
}
export function hdTarget(m){
    const content=unwrap(m?.message);
    if(!content)throw new HDMediaError('No se admite contenido de visualización única.');
    const ctx=content.extendedTextMessage?.contextInfo||content.imageMessage?.contextInfo||content.videoMessage?.contextInfo||content.documentMessage?.contextInfo;
    if(ctx?.remoteJid&&ctx.remoteJid!==m.key?.remoteJid)throw new HDMediaError('Usa contenido del mismo chat.');
    if(ctx?.stanzaId&&!ctx.quotedMessage)throw new HDMediaError('El contenido citado no está disponible.');
    const target=ctx?.quotedMessage?unwrap(ctx.quotedMessage):content;
    if(!target)throw new HDMediaError('No se admite contenido de visualización única.');
    for(const type of ['image','video','document']){
        const media=target[type+'Message'];
        if(!media)continue;
        const mime=String(media.mimetype||'').split(';')[0].toLowerCase();
        const kind=type==='document'?mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':null:type;
        if(kind&&!media.viewOnce&&!media.isViewOnce)return {type,kind,media};
    }
    throw new HDMediaError('Responde a una imagen o video compatible con #hd.');
}
export function statusAudience(env=process.env){
    if(env.ENABLE_STATUS_POSTING!=='true')throw new HDMediaError('La publicación de estados está desactivada.');
    const raw=String(env.STATUS_AUDIENCE_JIDS||'').split(',').map(v=>v.trim());
    const list=raw.map(v=>userJid(v));
    // Require canonical individual phone JIDs; no group, broadcast, LID or device suffix.
    if(!list.length||list.length>20||list.some((v,i)=>!v||v!==raw[i]||!v.endsWith('@s.whatsapp.net'))||new Set(list).size!==list.length)throw new HDMediaError('Configura una lista explícita de 1 a 20 destinatarios individuales.');
    return list;
}
export function statusRequest(m,args=[],env=process.env){
    if(env.ENABLE_STATUS_POSTING!=='true'||!isOwner(m?.key,env.BOT_OWNER_JID)||!userJid(m?.key?.remoteJid))throw new HDMediaError('La publicación de estados no está habilitada para este chat.');
    const audience=statusAudience(env);
    if(args.length!==1||args[0].toLowerCase()!=='publicar')throw new HDMediaError('Envía una imagen o video con el texto #estado publicar. Solo se publicará en la audiencia configurada.');
    const content=unwrap(m.message);
    const type=content?.imageMessage?'image':content?.videoMessage?'video':null;
    const media=type&&content[type+'Message'];
    if(!media||media.viewOnce||media.isViewOnce||media.contextInfo?.quotedMessage||media.contextInfo?.stanzaId)throw new HDMediaError('Adjunta directamente una imagen o video; no se admiten estados citados ni visualización única.');
    return {audience,target:{type,kind:type,media}};
}
export function videoLimits(status=false){
    return status?{long:HD_LIMITS.statusEdge,short:HD_LIMITS.statusShortEdge,seconds:HD_LIMITS.statusSeconds,bytes:HD_LIMITS.statusBytes,fps:30}:{long:HD_LIMITS.videoEdge,short:HD_LIMITS.videoShortEdge,seconds:HD_LIMITS.videoSeconds,bytes:HD_LIMITS.videoBytes,fps:60};
}
export function validVideoDimensions(width,height,limits){
    return Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&Math.max(width,height)<=limits.long&&Math.min(width,height)<=limits.short&&width%2===0&&height%2===0;
}
