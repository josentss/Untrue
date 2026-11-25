import test from 'node:test';
import assert from 'node:assert/strict';
import {withCommandFeedback} from '../core/commandFeedback.js';
const m={key:{remoteJid:'123@g.us',participant:'456@s.whatsapp.net',id:'abc',fromMe:false}};
test('reaction targets original command and changes after entire result',async()=>{
    const events=[],sock={sendMessage:async(jid,c)=>{assert.equal(jid,m.key.remoteJid);assert.deepEqual(c.react.key,m.key);events.push(c.react.text);}};
    await withCommandFeedback(sock,m,async()=>{events.push('file 1','file 2');});
    assert.deepEqual(events,['⏳','file 1','file 2','✅']);
});
test('handled and thrown errors do not mark success',async()=>{
    const events=[],sock={sendMessage:async(_,c)=>events.push(c.react.text)};
    await withCommandFeedback(sock,m,async()=>false);
    await assert.rejects(withCommandFeedback(sock,m,async()=>{throw Error('failed');}));
    assert.deepEqual(events,['⏳','❌','⏳','❌']);
});
test('reaction failures never block execution',async()=>{
    const sock={sendMessage:async()=>{throw Error('offline');}};
    assert.equal(await withCommandFeedback(sock,m,async()=>42),42);
});
