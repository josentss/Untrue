const levels = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 };
export function protocolCategory(message) {
    if (/decrypt|signal|session error|no matching sessions|2000 messages/i.test(message)) return 'signal_session';
    if (/retry|resend/i.test(message)) return 'message_retry';
    if (/sync|history|app.state/i.test(message)) return 'sync';
    if (/pre.key|key.bundle/i.test(message)) return 'key_exchange';
    if (/connect|login|socket|pairing/i.test(message)) return 'connection';
    return 'protocol';
}
// Only emit allowlisted categories, never payloads, raw JIDs, QR data or keys.
export function createProtocolLogger(target, { level = 'warn', interval = 60000, now = Date.now } = {}) {
    const selected = Object.hasOwn(levels, level) ? level : 'warn';
    const buckets = new Map();
    const api = { level: selected, child: () => api };
    for (const name of ['trace','debug','info','warn','error','fatal']) {
        api[name] = (...args) => {
            if (levels[name] < levels[selected]) return;
            const message = args.find(x => typeof x === 'string') || '';
            const category = protocolCategory(message);
            const key = name + ':' + category;
            const time = now();
            const previous = buckets.get(key);
            if (previous && time - previous.at < interval) { previous.suppressed++; return; }
            target[name]({ component:'baileys', category, ...(previous?.suppressed ? { suppressed:previous.suppressed } : {}) }, 'Evento de protocolo');
            buckets.set(key, { at:time, suppressed:0 });
        };
    }
    api.flush = () => {
        for (const [key, value] of buckets) {
            if (value.suppressed) target.info({ component:'baileys', event:key, suppressed:value.suppressed }, 'Resumen de eventos repetidos');
        }
        buckets.clear();
    };
    return api;
}
