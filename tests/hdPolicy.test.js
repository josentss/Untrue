import test from 'node:test';
import assert from 'node:assert/strict';
import {hdMode,hdTarget,statusAudience,statusRequest,validVideoDimensions,videoLimits} from '../core/hdPolicy.js';
const owner='123456789@s.whatsapp.net',recipient='987654321@s.whatsapp.net';
const env={ENABLE_STATUS_POSTING:'true',BOT_OWNER_JID:owner,STATUS_AUDIENCE_JIDS:recipient};
const msg={key:{remoteJid:owner,id:'x',fromMe:false},message:{imageMessage:{caption:'#estado publicar',mimetype:'image/jpeg'}}};
test('HD validates mode, direct image, quoted document and rejects view-once',()=>{
    assert.equal(hdMode([]),'native');assert.equal(hdMode(['archivo']),'original');assert.throws(()=>hdMode(['x']));
    assert.equal(hdTarget(msg).kind,'image');
    assert.equal(hdTarget({...msg,message:{extendedTextMessage:{contextInfo:{stanzaId:'q',quotedMessage:{documentMessage:{mimetype:'video/mp4'}}}}}}).kind,'video');
    assert.throws(()=>hdTarget({...msg,message:{extendedTextMessage:{contextInfo:{stanzaId:'q'}}}}));
    assert.throws(()=>hdTarget({...msg,message:{viewOnceMessage:{message:msg.message}}}));
});
test('statuses are opt-in and only explicit direct owner requests with fixed audience',()=>{
    assert.deepEqual(statusRequest(msg,['publicar'],env).audience,[recipient]);
    assert.throws(()=>statusRequest(msg,['publicar'],{}));
    assert.throws(()=>statusRequest(msg,[],env));
    assert.throws(()=>statusRequest({...msg,key:{...msg.key,remoteJid:recipient}},['publicar'],env));
    assert.throws(()=>statusRequest({...msg,key:{...msg.key,remoteJid:'123@g.us',participant:owner}},['publicar'],env));
    assert.throws(()=>statusRequest({...msg,message:{imageMessage:{...msg.message.imageMessage,viewOnce:true}}},['publicar'],env));
    assert.throws(()=>statusRequest({...msg,message:{extendedTextMessage:{contextInfo:{quotedMessage:msg.message}}}},['publicar'],env));
    for(const audience of ['',recipient+','+recipient,'123@g.us','status@broadcast','123@lid',recipient+','])assert.throws(()=>statusAudience({...env,STATUS_AUDIENCE_JIDS:audience}));
});
test('landscape and portrait caps, no invalid geometry',()=>{
    for(const [w,h] of [[1920,1080],[1080,1920],[640,480]])assert.equal(validVideoDimensions(w,h,videoLimits()),true);
    for(const [w,h] of [[1920,1920],[1921,1080],[0,0],[641,480]])assert.equal(validVideoDimensions(w,h,videoLimits()),false);
    assert.equal(validVideoDimensions(1280,720,videoLimits(true)),true);
});
