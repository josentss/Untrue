import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedMessage, commandOf, RecentKeys } from '../core/messages.js';
import { JobQueue } from '../core/queue.js';
import { run, withTemp } from '../core/process.js';
import { access } from 'node:fs/promises';

test('normaliza mensajes efímeros y comandos con espacios', () => {
    const m = normalizedMessage({ key: { remoteJid: 'test@lid', id: '1' }, message: { ephemeralMessage: { message: { conversation: ' #YTA   una canción' } } } });
    assert.deepEqual(commandOf(m), { name: 'yta', args: ['una','canción'] });
});
test('no procesa estados, propios ni view-once', () => {
    assert.equal(commandOf({ key: { remoteJid: 'status@broadcast' }, message: { conversation: '#s' } }), null);
    assert.equal(commandOf({ key: { remoteJid: 'x@lid', fromMe: true }, message: { conversation: '#s' } }), null);
    assert.equal(normalizedMessage({ message: { viewOnceMessage: { message: { imageMessage: {} } } } }), null);
});
test('deduplicación con caducidad', () => {
    const cache = new RecentKeys(2, 10);
    assert.equal(cache.seen('a', 100), false); assert.equal(cache.seen('a', 105), true); assert.equal(cache.seen('a', 111), false);
});
test('cola limitada', async () => {
    const queue = new JobQueue(1, 1);
    let release;
    const first = queue.run(() => new Promise(r => { release = r; }));
    const second = queue.run(() => 2);
    await assert.rejects(queue.run(() => 3), /ocupado/);
    await Promise.resolve(); release(1);
    assert.deepEqual(await Promise.all([first, second]), [1,2]);
});
test('argumentos literales sin shell y limpieza temporal', async () => {
    const result = await run(process.execPath, ['-e', 'console.log(process.argv[1])', '$(echo unsafe)']);
    assert.equal(result.stdout.trim(), '$(echo unsafe)');
    let dir;
    await assert.rejects(withTemp(async path => { dir = path; throw Error('expected'); }), /expected/);
    await assert.rejects(access(dir));
});

import { platformUrl } from '../core/urls.js';
test('validación estricta de dominios',()=>{
    assert.equal(platformUrl('https://youtu.be/abc',['youtu.be']),'https://youtu.be/abc');
    for (const url of ['https://youtu.be.evil.test/a','https://evil.test/?youtube.com','https://user@youtu.be/a','file:///tmp/a','https://youtu.be:123/a']) assert.throws(()=>platformUrl(url,['youtu.be','youtube.com']));
});
