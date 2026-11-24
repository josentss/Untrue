export function platformUrl(value, domains) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Enlace inválido');
    let u;
    try { u = new URL(value); } catch { throw new Error('Enlace inválido'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !domains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) throw new Error('Enlace inválido');
    return u.href;
}
export function quotedText(m) {
    const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    return q?.conversation || q?.extendedTextMessage?.text || '';
}
export function inputUrl(m, args, domains) {
    const value = args[0] || quotedText(m).match(/https:\/\/[^\s]+/)?.[0];
    return platformUrl(value, domains);
}
