const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
export function unwrap(content) {
    let current = content;
    for (let i = 0; current && i < 8; i++) {
        const wrapper = wrappers.find(key => current[key]?.message);
        if (!wrapper) break;
        // Do not bypass a sender's view-once preference.
        if (wrapper.startsWith('viewOnce')) return undefined;
        current = current[wrapper].message;
    }
    return current;
}
export function normalizedMessage(m) {
    const message = unwrap(m?.message);
    if (!message) return null;
    const copy = { ...message };
    for (const type of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage']) {
        const value = copy[type];
        if (value?.contextInfo?.quotedMessage) copy[type] = {
            ...value, contextInfo: { ...value.contextInfo, quotedMessage: unwrap(value.contextInfo.quotedMessage) }
        };
    }
    // Legacy converters expect quoted media under extendedTextMessage.
    const media = copy.imageMessage || copy.videoMessage || copy.documentMessage;
    if (!copy.extendedTextMessage && media?.contextInfo?.quotedMessage) {
        copy.extendedTextMessage = { text: media.caption, contextInfo: media.contextInfo };
    }
    return { ...m, message: copy };
}
export function commandOf(m) {
    const c = m?.message;
    const jid = m?.key?.remoteJid;
    if (!jid || m.key.fromMe || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
    const text = c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption || c?.videoMessage?.caption || c?.documentMessage?.caption;
    if (typeof text !== 'string' || !text.trim().startsWith('#')) return null;
    const [name, ...args] = text.trim().split(/\s+/);
    if (!/^#[a-z0-9_-]{1,32}$/i.test(name)) return null;
    return { name: name.slice(1).toLowerCase(), args };
}
export function messageKey(key) {
    return key?.id && key?.remoteJid ? [key.remoteJid, key.id].join(':') : null;
}
export class RecentKeys {
    constructor(max = 5000, ttl = 600000) { this.max = max; this.ttl = ttl; this.entries = new Map(); }
    seen(key, now = Date.now()) {
        if (!key) return true;
        if ((this.entries.get(key) || 0) > now) return true;
        this.entries.delete(key); this.entries.set(key, now + this.ttl);
        while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value);
        return false;
    }
}
