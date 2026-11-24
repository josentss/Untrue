// Ordinary conversations only. Status, broadcast lists and channels remain excluded.
export function stickerChatType(jid) {
    if(typeof jid!=='string') return null;
    if(/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)) return 'private';
    if(/^\d+(?:-\d+)?@g\.us$/.test(jid)) return 'group';
    return null;
}
export function shouldAttachStickerSound({enabled,jid,animated,kind,hasAudio}){
    return Boolean(enabled&&stickerChatType(jid)&&animated&&(kind==='video'||hasAudio));
}
