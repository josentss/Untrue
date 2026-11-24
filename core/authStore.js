import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Compatible with the file names and JSON codec of Baileys multi-file auth.
// Single process only. Never interpret corrupt credentials as an absent session.
export async function openAuthStore(folder, { codec, initCreds, decodeAppStateKey }) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    let tail = Promise.resolve();
    function serial(fn) {
        const pending = tail.then(fn);
        tail = pending.catch(() => {});
        return pending;
    }
    const pathFor = name => join(folder, name.replace(/\//g, '__').replace(/:/g, '-'));
    async function read(name) {
        let raw;
        try { raw = await readFile(pathFor(name), 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') return null; throw e; }
        try { return JSON.parse(raw, codec.reviver); }
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
                    return serial(async () => {
                        const entries = await Promise.all(ids.map(async id => {
                            let value = await read(type + '-' + id + '.json');
                            if (type === 'app-state-sync-key' && value) value = decodeAppStateKey(value);
                            return [id, value];
                        }));
                        return Object.fromEntries(entries);
                    });
                },
                set(data) {
                    const entries = Object.entries(data).flatMap(([type, values]) => Object.entries(values).map(([id, value]) => ({
                        name: type + '-' + id + '.json',
                        json: value == null ? null : JSON.stringify(value, codec.replacer)
                    })));
                    return serial(async () => {
                        for (const {name,json} of entries) {
                            if (json === null) await remove(name);
                            else await write(name,json);
                        }
                    });
                }
            }
        },
        saveCreds() {
            const json = JSON.stringify(creds, codec.replacer);
            return serial(() => write('creds.json', json));
        },
        flush: () => tail
    };
}
