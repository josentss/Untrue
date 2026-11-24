import { messageKeys,userJid } from './identity.js';

// Store only downloadable sound references, not messages or media files.
// Scope fallback to the exact quoted sticker in the current conversation.
function hashOf(sticker){
    const hash=sticker?.fileSha256;
    return hash instanceof Uint8Array&&hash.length===32?Buffer.from(hash).toString('hex'):null;
}
export function downloadableAudio(audio){
    return Boolean(audio?.mediaKey instanceof Uint8Array&&audio.mediaKey.length===32&&(
        (typeof audio.directPath==='string'&&audio.directPath.startsWith('/')&&!audio.directPath.startsWith('//'))||
        (typeof audio.url==='string'&&audio.url.startsWith('https://'))
    ));
}
export class StickerAudioCache {
    constructor({max=512,ttl=3600000,now=Date.now}={}){
        this.max=max;this.ttl=ttl;this.now=now;this.entries=new Map();
    }
    remember(message){
        // Deliberately do not retain ephemeral/view-once wrappers.
        const sticker=message?.message?.stickerMessage;
        const hash=hashOf(sticker),audio=sticker?.audioMessage;
        if(!hash||!downloadableAudio(audio)) return;
        const jid=message.key?.remoteJid;
        if(!jid||!(userJid(jid)||/^\d+(?:-\d+)?@g\.us$/.test(jid))) return;
        const keys=messageKeys(message.key);
        const time=this.now();
        for(const [key,entry] of this.entries) if(entry.expires<=time) this.entries.delete(key);
        // Copy the reference; never cache entire messages or files.
        const reference={...audio,mediaKey:Buffer.from(audio.mediaKey)};
        for(const key of keys){
            this.entries.delete(key);
            this.entries.set(key,{hash,audio:reference,expires:time+this.ttl});
        }
        while(this.entries.size>this.max) this.entries.delete(this.entries.keys().next().value);
    }
    recover(message,context,sticker){
        if(!context?.stanzaId||typeof context.stanzaId!=='string') return undefined;
        const hash=hashOf(sticker);
        if(!hash) return undefined;
        // Never trust contextInfo.remoteJid as a destination for lookup.
        const key={...message.key,id:context.stanzaId};
        const keys=messageKeys(key);
        if(context.remoteJid){
            const quotedJid=userJid(context.remoteJid)||context.remoteJid;
            if(!keys.some(k=>k===quotedJid+':'+context.stanzaId)) return undefined;
        }
        for(const k of keys){
            const entry=this.entries.get(k);
            if(!entry) continue;
            if(entry.expires<=this.now()){this.entries.delete(k);continue;}
            if(entry.hash===hash) return {...entry.audio,mediaKey:Buffer.from(entry.audio.mediaKey)};
        }
        return undefined;
    }
}
export const stickerAudioCache=new StickerAudioCache();
