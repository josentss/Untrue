import test from 'node:test';
import assert from 'node:assert/strict';
import {stickerChatType,shouldAttachStickerSound} from '../core/stickerDestination.js';
const options={enabled:true,animated:true,kind:'video',hasAudio:false};
test('sound stickers support PN, LID and both group JID formats',()=>{
    for(const jid of ['123@s.whatsapp.net','123:2@s.whatsapp.net','456@lid','456:2@lid','120363000000000000@g.us','123-456@g.us']){
        assert.equal(shouldAttachStickerSound({...options,jid}),true,jid);
    }
    assert.equal(stickerChatType('123-456@g.us'),'group');
    assert.equal(stickerChatType('456@lid'),'private');
});
test('sound stickers remain disabled for unsupported destinations and nonanimated media',()=>{
    for(const jid of ['status@broadcast','123@broadcast','123@newsletter','bad@g.us',undefined]){
        assert.equal(shouldAttachStickerSound({...options,jid}),false);
    }
    const jid='120363000000000000@g.us';
    assert.equal(shouldAttachStickerSound({...options,jid,enabled:false}),false);
    assert.equal(shouldAttachStickerSound({...options,jid,animated:false}),false);
    assert.equal(shouldAttachStickerSound({...options,jid,kind:'image'}),false);
    assert.equal(shouldAttachStickerSound({...options,jid,kind:'sticker',hasAudio:true}),true);
    assert.equal(shouldAttachStickerSound({...options,jid,kind:'sticker'}),false);
});
