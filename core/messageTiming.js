export function eventAge(timestamp, now = Date.now()) {
    const seconds = typeof timestamp === 'number' ? timestamp : typeof timestamp?.toNumber === 'function' ? timestamp.toNumber() : Number(timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const ms = now - seconds * 1000;
    return ms >= -2000 ? Math.max(0, ms) : null;
}
export function historyPolicy(creds, types) {
    // Initial pairing needs the mappings carried by history. On an already synced
    // account, avoid the RECENT bootstrap wait, but keep bootstrap, mapping and
    // other non-full history events supported by Baileys.
    const established = Boolean(creds.registered && creds.accountSyncCounter > 0);
    return ({syncType}) => syncType !== types.FULL && (!established || syncType !== types.RECENT);
}
