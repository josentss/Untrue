import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAuthStore } from '../core/authStore.js';
import { senderIdentity, isOwner, messageKeys } from '../core/identity.js';
import { createProtocolLogger } from '../core/protocolLogger.js';
const codec = {
    replacer:(_,v)=>v?.type==='Buffer'?{type:'Buffer',data:Buffer.from(v.data).toString('base64')}:v,
    reviver:(_,v)=>v?.type==='Buffer'?Buffer.from(v.data,'base64'):v
};
const options={codec,initCreds:()=>({noiseKey:{private:Buffer.from('key')},signedIdentityKey:{public:Buffer.from('key')}}),decodeAppStateKey:v=>({...v,decoded:true})};
test('legacy credentials, LID keys, restart, and delete',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'untrue-auth-test-'));
    try {
        const old=options.initCreds();
        await writeFile(join(dir,'creds.json'),JSON.stringify(old,codec.replacer));
        const a=await openAuthStore(dir,options);
        assert.deepEqual(a.state.creds,old);
        await a.state.keys.set({'lid-mapping':{'123:1':'456'},'device-list':{'123':['1']},tctoken:{'123':{token:Buffer.from('token')}},'identity-key':{'123':Buffer.from('identity')},'app-state-sync-key':{'a':{keyData:'value'}}});
        a.state.creds.registered=true; await a.saveCreds();
        const b=await openAuthStore(dir,options);
        assert.equal(b.state.creds.registered,true);
        assert.deepEqual(await b.state.keys.get('lid-mapping',['123:1']),{'123:1':'456'});
        assert.deepEqual((await b.state.keys.get('tctoken',['123']))['123'].token,Buffer.from('token'));
        assert.deepEqual((await b.state.keys.get('device-list',['123']))['123'],['1']);
        assert.deepEqual((await b.state.keys.get('identity-key',['123']))['123'],Buffer.from('identity'));
        assert.equal((await b.state.keys.get('app-state-sync-key',['a'])).a.decoded,true);
        await b.state.keys.set({'lid-mapping':{'123:1':null}});
        assert.equal((await b.state.keys.get('lid-mapping',['123:1']))['123:1'],null);
    } finally { await rm(dir,{recursive:true,force:true}); }
});
test('corrupt credentials never replaced',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'untrue-auth-test-'));
    try { const path=join(dir,'creds.json'); await writeFile(path,'broken'); await assert.rejects(openAuthStore(dir,options),{code:'AUTH_CORRUPT'}); assert.equal(await readFile(path,'utf8'),'broken'); await writeFile(path,'null'); await assert.rejects(openAuthStore(dir,options),{code:'AUTH_CORRUPT'}); }
    finally { await rm(dir,{recursive:true,force:true}); }
});
test('owner check uses actual sender not group chat, and accepts alternative JID',()=>{
    const key={remoteJid:'111@g.us',participant:'123@lid',participantAlt:'456:2@s.whatsapp.net',remoteJidAlt:'999@lid'};
    assert.equal(senderIdentity(key),'123@lid');
    assert.equal(isOwner(key,'456@s.whatsapp.net'),true);
    assert.equal(isOwner(key,'999@lid'),false);
    assert.equal(isOwner({...key,fromMe:true},'123@lid'),false);
    assert.equal(isOwner(key,undefined),false);
    assert.deepEqual(messageKeys({id:'m',remoteJid:'123:2@lid',remoteJidAlt:'456@s.whatsapp.net'}),['123@lid:m','456@s.whatsapp.net:m']);
});
test('protocol logging drops secret payloads and aggregates repeats',()=>{
    const out=[]; let now=0;
    const target=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(l=>[l,(...args)=>out.push(args)]));
    const log=createProtocolLogger(target,{now:()=>now});
    log.info({secret:'test-secret'},'login');
    log.warn({key:'test-secret'},'failed to decrypt message');
    log.warn({key:'test-secret'},'failed to decrypt message');
    assert.equal(out.length,1);
    now=61000; log.warn({key:'test-secret'},'failed to decrypt message');
    assert.equal(out[1][0].suppressed,1);
    assert.equal(JSON.stringify(out).includes('test-secret'),false);
});

import { eventAge, historyPolicy } from '../core/messageTiming.js';
import { installSignalConsoleGuard } from '../core/signalConsole.js';
test('concurrent writes retain ordering per key and persist across reopen', async()=>{
    const dir=await mkdtemp(join(tmpdir(),'untrue-auth-concurrency-'));
    try {
        const a=await openAuthStore(dir,options);
        const many=Object.fromEntries(Array.from({length:32},(_,i)=>['k'+i,Buffer.from('one')]));
        const first=a.state.keys.set({session:many});
        const second=a.state.keys.set({session:{k31:Buffer.from('two'),k0:null}});
        const read=a.state.keys.get('session',['k31','k0']);
        await Promise.all([first,second]);
        assert.deepEqual(await read,{k31:Buffer.from('two'),k0:null});
        await a.flush();
        const b=await openAuthStore(dir,options);
        assert.deepEqual(await b.state.keys.get('session',['k31','k0','k1']),{k31:Buffer.from('two'),k0:null,k1:Buffer.from('one')});
    } finally { await rm(dir,{recursive:true,force:true}); }
});
test('history policy retains initial identity synchronization',()=>{
    const types={FULL:1,RECENT:2,INITIAL_BOOTSTRAP:3,NON_BLOCKING_DATA:4};
    const fresh=historyPolicy({registered:true,accountSyncCounter:0},types);
    const established=historyPolicy({registered:true,accountSyncCounter:1},types);
    assert.equal(fresh({syncType:2}),true);
    assert.equal(established({syncType:2}),false);
    assert.equal(established({syncType:3}),true);
    assert.equal(established({syncType:4}),true);
    assert.equal(fresh({syncType:1}),false);
});
test('timestamps measure delivery delay without message content',()=>{
    assert.equal(eventAge(100,112000),12000);
    assert.equal(eventAge({toNumber:()=>100},102000),2000);
    assert.equal(eventAge(undefined,1000),null);
    assert.equal(eventAge(200,1000),null);
});
test('only libsignal console calls are sanitized and counted',()=>{
    const output=[]; let stack='at /app/node_modules/libsignal/src/session_record.js:1';
    const target=Object.fromEntries(['log','info','debug','warn','error','dir','trace'].map(name=>[name,(...args)=>output.push(args)]));
    const guard=installSignalConsoleGuard({target,stack:()=>stack});
    try {
        target.info('Closing session:',{privateKey:'fake-secret'});
        target.error('unknown', {rootKey:'fake-secret'});
        stack='at /app/bot.js:1'; target.error('normal app error');
        guard.flush();
        assert.equal(output.length,2);
        assert.equal(output[0][0],'normal app error');
        assert.equal(JSON.stringify(output).includes('fake-secret'),false);
        assert.equal(JSON.parse(output[1][0]).counts['info:session_rotation'],1);
    } finally {guard.restore();}
});
