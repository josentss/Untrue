import * as wa from 'baileys';
import assert from 'node:assert/strict';
import { openAuthStore } from '../core/authStore.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
for (const name of ['makeWASocket','makeCacheableSignalKeyStore','initAuthCreds','downloadMediaMessage','downloadContentFromMessage']) assert.equal(typeof wa[name],'function',name);
assert.equal(typeof wa.proto.Message.AppStateSyncKeyData.fromObject,'function');
assert.ok(wa.DisconnectReason);
const dir=await mkdtemp(join(tmpdir(),'untrue-proto-smoke-'));
try {
    const options={codec:wa.BufferJSON,initCreds:wa.initAuthCreds,decodeAppStateKey:v=>wa.proto.Message.AppStateSyncKeyData.fromObject(v)};
    const a=await openAuthStore(dir,options);
    const key=Buffer.from(a.state.creds.noiseKey.private);
    await a.saveCreds();
    await a.state.keys.set({'lid-mapping':{'123':'456'},tctoken:{'123':{token:Buffer.from('token')}}});
    const b=await openAuthStore(dir,options);
    assert.deepEqual(Buffer.from(b.state.creds.noiseKey.private),key);
    assert.equal((await b.state.keys.get('lid-mapping',['123']))['123'],'456');
    assert.deepEqual((await b.state.keys.get('tctoken',['123']))['123'].token,Buffer.from('token'));
    const bot = await import('../bot.js');
    await bot.stopBot();
    await import('../commands/commandHandler.js');
    console.log('Baileys, almacenamiento y comandos cargados');
} finally { await rm(dir,{recursive:true,force:true}); }
