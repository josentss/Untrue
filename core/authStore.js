import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Compatible with the file names and JSON codec of Baileys multi-file auth.
// Single process only. Never interpret corrupt credentials as an absent session.
export async function openAuthStore(folder, { codec, initCreds, decodeAppStateKey }) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    // Serialize only operations touching the same file, not independent keys.
    const locks = new Map();
    const pending = new Set();
    let active = 0;
    const waiting = [];
    async function limited(fn) {
        if (active >= 8) await new Promise(resolve => waiting.push(resolve));
        else active++;
        try { return await fn(); }
        finally {
            const next = waiting.shift();
            if (next) next();
            else active--;
        }
    }
    function serial(name, fn) {
        const key = pathFor(name);
        const task = (locks.get(key) || Promise.resolve()).then(() => limited(fn));
        const barrier = task.catch(() => {});
        locks.set(key, barrier);
        pending.add(barrier);
        void barrier.then(() => {
            pending.delete(barrier);
            if (locks.get(key) === barrier) locks.delete(key);
        });
        return task;
    }
    const pathFor = name => join(folder, name.replace(/\//g, '__').replace(/:/g, '-'));
    async function read(name) {
        let raw;
        try { raw = await readFile(pathFor(name), 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') return null; throw e; }
        try { const parsed = JSON.parse(raw, codec.reviver); if (parsed === null) throw Error('null'); return parsed; }
        catch { throw Object.assign(new Error('Archivo de autenticación inválido'), { code: 'AUTH_CORRUPT' }); }
    }
    async function write(name, json) {
        const path = pathFor(name);
        const tmp = path + '.' + randomUUID() + '.tmp';
        try {
            await writeFile(tmp, json, { mode: 0o600, flag: 'wx', flush: true });
            await rename(tmp, path);
        } finally { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    }
    async function remove(name) {
        await unlink(pathFor(name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
    const loaded = await read('creds.json');
    if (loaded !== null && (!loaded || typeof loaded !== 'object' || !loaded.noiseKey || !loaded.signedIdentityKey)) {
        throw Object.assign(new Error('Credenciales incompletas'), { code: 'AUTH_CORRUPT' });
    }
    const creds = loaded ?? initCreds();
    return {
        state: {
            creds,
            keys: {
                get(type, ids) {
                    return Promise.all(ids.map(async id => {
                        const name = type + '-' + id + '.json';
                        let value = await serial(name, () => read(name));
                        if (type === 'app-state-sync-key' && value) value = decodeAppStateKey(value);
                        return [id, value];
                    })).then(Object.fromEntries);
                },
                set(data) {
                    const entries = Object.entries(data).flatMap(([type, values]) => Object.entries(values).map(([id, value]) => ({
                        name: type + '-' + id + '.json',
                        json: value == null ? null : JSON.stringify(value, codec.replacer)
                    })));
                    const writes = entries.map(({name,json}) => serial(name, () => json === null ? remove(name) : write(name,json)));
                    return Promise.allSettled(writes).then(results => {
                        const failure = results.find(r => r.status === 'rejected');
                        if (failure) throw failure.reason;
                    });
                }
            }
        },
        saveCreds() {
            const json = JSON.stringify(creds, codec.replacer);
            return serial('creds.json', () => write('creds.json', json));
        },
        async flush() { while (pending.size) await Promise.all([...pending]); }
    };
}
