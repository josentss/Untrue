import test from 'node:test';
import assert from 'node:assert/strict';
import {StickerAudioCache} from '../core/stickerAudioCache.js';
import {selectMedia} from '../core/mediaTarget.js';
const group='120363000000000000@g.us';
const hash=Buffer.alloc(32,1),audio={mediaKey:Buffer.alloc(32,2),directPath:'/audio',seconds:15};
const sticker={fileSha256:hash,isAnimated:true,audioMessage:audio};
const received={key:{remoteJid:group,id:'s1'},message:{stickerMessage:sticker}};
function quote({jid=group,id='s1',fileSha256=hash,remoteJid,withAudio=false}={}){
    return {key:{remoteJid:jid,id:'cmd'},message:{extendedTextMessage:{text:'#sm',contextInfo:{stanzaId:id,remoteJid,quotedMessage:{stickerMessage:{fileSha256,isAnimated:true,...(withAudio?{audioMessage:audio}:{})}}}}}};
}
test('recovers omitted audio only for the exact sticker in the same chat',()=>{
    const cache=new StickerAudioCache();
    cache.remember(received);
    const selected=selectMedia(quote(),{audioCache:cache});
    assert.equal(selected.audioSource,'cache');assert.deepEqual(selected.audio,audio);
    assert.equal(selectMedia(quote({withAudio:true}),{audioCache:cache}).audioSource,'quoted_or_direct');
    for(const q of [quote({jid:'123@s.whatsapp.net'}),quote({id:'other'}),quote({fileSha256:Buffer.alloc(32,3)}),quote({remoteJid:'999@g.us'})]) assert.equal(selectMedia(q,{audioCache:cache}).audio,undefined);
});
test('bounded expiry, no ephemeral retention, no fabricated audio on silent stickers',()=>{
    let now=0;const cache=new StickerAudioCache({ttl:100,max:1,now:()=>now});
    cache.remember({...received,message:{ephemeralMessage:{message:received.message}}});
    assert.equal(selectMedia(quote(),{audioCache:cache}).audio,undefined);
    cache.remember(received);now=101;
    assert.equal(selectMedia(quote(),{audioCache:cache}).audio,undefined);
    cache.remember(received);cache.remember({...received,key:{remoteJid:group,id:'s2'}});
    assert.equal(selectMedia(quote(),{audioCache:cache}).audio,undefined);
    assert.equal(selectMedia(quote({id:'s2'}),{audioCache:cache}).audioSource,'cache');
});
test('private PN/LID aliases are taken from message key only',()=>{
    const cache=new StickerAudioCache();
    cache.remember({...received,key:{remoteJid:'123@lid',remoteJidAlt:'456@s.whatsapp.net',id:'s1'}});
    assert.equal(selectMedia(quote({jid:'456@s.whatsapp.net'}),{audioCache:cache}).audioSource,'cache');
    assert.equal(selectMedia(quote({jid:'789@s.whatsapp.net',remoteJid:'456@s.whatsapp.net'}),{audioCache:cache}).audio,undefined);
});
