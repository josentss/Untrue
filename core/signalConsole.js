// libsignal 6 writes SessionEntry (including private keys) directly to console.
 // Intercept only its own calls, preserving other application and dependency output.
const signalFrame = /[\\/]node_modules[\\/]libsignal[\\/]/;
const methods = ['log','info','debug','warn','error','dir','trace'];
export function signalCategory(text) {
    if (/closing.*session|closed session/i.test(text)) return 'session_rotation';
    if (/decrypt|bad mac|counter|sessionerror/i.test(text)) return 'decrypt';
    if (/prekey|pre.key/i.test(text)) return 'prekey';
    return 'other';
}
export function installSignalConsoleGuard({ target = console, stack = () => new Error().stack || '', interval = 60000 } = {}) {
    const originals = new Map();
    const counts = new Map();
    for (const method of methods) {
        if (typeof target[method] !== 'function') continue;
        const original = target[method];
        originals.set(method, original);
        target[method] = function(...args) {
            if (!signalFrame.test(stack())) return original.apply(this,args);
            const category = signalCategory(typeof args[0] === 'string' ? args[0] : '');
            const key = method + ':' + category;
            counts.set(key,(counts.get(key)||0)+1);
            // Do not forward or stringify any arguments, even for unexpected messages.
        };
    }
    function flush() {
        if (!counts.size) return;
        const countsByEvent = Object.fromEntries(counts);
        counts.clear();
        (originals.get('warn') || originals.get('log')).call(target, JSON.stringify({level:'warn',component:'libsignal',message:'Resumen de eventos Signal (sin material criptográfico)',counts:countsByEvent}));
    }
    const timer = setInterval(flush, interval); timer.unref();
    return { flush, restore() { clearInterval(timer); for (const [name,fn] of originals) target[name]=fn; } };
}
