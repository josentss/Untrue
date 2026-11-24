// Preserve transport JIDs; use alternate identities only for trusted message-key metadata.
export function userJid(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(value);
    return match ? match[1] + '@' + match[2] : null;
}
export function senderJids(key = {}) {
    if (key.fromMe) return [];
    const group = typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@g.us');
    const values = group ? [key.participant, key.participantAlt] : [key.remoteJid, key.remoteJidAlt];
    return [...new Set(values.map(userJid).filter(Boolean))];
}
export function senderIdentity(key) {
    const ids = senderJids(key);
    return ids.find(id => id.endsWith('@lid')) || ids[0] || null;
}
export function isOwner(key, owner) {
    const id = userJid(owner);
    return Boolean(id && senderJids(key).includes(id));
}
export function messageKeys(key) {
    if (!key?.id || !key.remoteJid) return [];
    const direct = userJid(key.remoteJid);
    const jids = direct ? [direct,userJid(key.remoteJidAlt)].filter(Boolean) : [key.remoteJid];
    return [...new Set(jids)].map(jid => jid + ':' + key.id);
}
