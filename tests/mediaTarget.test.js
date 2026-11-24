import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMedia} from '../core/mediaTarget.js';
test('direct and quoted images/videos/documents',()=>{
    assert.equal(selectMedia({message:{imageMessage:{caption:'#s'}}}).kind,'image');
    assert.equal(selectMedia({message:{extendedTextMessage:{contextInfo:{quotedMessage:{ephemeralMessage:{message:{documentMessage:{mimetype:'image/gif'}}}}}}}}).kind,'image');
    assert.equal(selectMedia({message:{documentMessage:{mimetype:'video/mp4'}}}).kind,'video');
});
test('rejects known unsupported formats and view-once',()=>{
    for(const message of [{viewOnceMessage:{message:{imageMessage:{}}}},{lottieStickerMessage:{message:{stickerMessage:{}}}},{stickerMessage:{isLottie:true}},{audioStickerMessage:{}}]) assert.throws(()=>selectMedia({message}));
    assert.throws(()=>selectMedia({message:{extendedTextMessage:{contextInfo:{quotedMessage:{viewOnceMessage:{message:{videoMessage:{}}}}}}}}));
    assert.deepEqual(selectMedia({message:{stickerMessage:{audioMessage:{seconds:1}}}}).audio,{seconds:1});
});
