import test from 'node:test';
import assert from 'node:assert/strict';
import {socialUrl,mediaUrl,instagramItems,twitterItems,selectItems} from '../core/socialPolicy.js';
import {downloadSocialFile,safeResponse} from '../services/socialHttp.js';
import {withTemp} from '../core/process.js';
import {join} from 'node:path';
import {access,readFile} from 'node:fs/promises';
test('public links and short links for all five platforms',()=>{
    assert.equal(socialUrl('tiktok','https://www.tiktok.com/@test/photo/123').photo,true);
    assert.equal(socialUrl('tiktok','https://vm.tiktok.com/abc/').short,true);
    assert.equal(socialUrl('instagram','https://instagram.com/reels/ABC/?igsh=abc').url,'https://www.instagram.com/reel/ABC/');
    assert.equal(socialUrl('facebook','https://m.facebook.com/watch?v=123&ref=foo').url,'https://www.facebook.com/watch/?v=123');
    assert.equal(socialUrl('facebook','https://fb.watch/abc/').short,true);
    assert.equal(socialUrl('twitter','https://twitter.com/test/status/123/photo/1').id,'123');
    assert.equal(socialUrl('pinterest','https://pin.it/AbC').short,true);
    assert.equal(socialUrl('pinterest','https://www.pinterest.es/pin/title--123/').id,'123');
    for(const [p,u] of [['tiktok','https://tiktok.com.evil.test/@test/video/123'],['instagram','https://instagram.com/stories/test/1'],['facebook','https://facebook.com/l.php?u=https://evil.test'],['twitter','https://user@x.com/test/status/123'],['pinterest','https://www.pinterest.com/test/board/']])assert.throws(()=>socialUrl(p,u));
    for(const u of ['https://127.0.0.1/a','https://pbs.twimg.com.evil.test/a','https://user@pbs.twimg.com/a','http://pbs.twimg.com/a'])assert.throws(()=>mediaUrl('twitter',u));
});
test('ordered mixed carousels, deduplication and selection',()=>{
    const a='https://x.cdninstagram.com/a.jpg',b='https://x.fbcdn.net/b.mp4';
    const list=instagramItems({status:true,BK9:[{url:a},{url:b,type:'video'},{url:a}]});
    assert.deepEqual(list,[{url:a,kind:'image'},{url:b,kind:'video'}]);
    assert.deepEqual(selectItems(list,2),[list[1]]);
    assert.throws(()=>selectItems(list,3));assert.throws(()=>selectItems(list,undefined,1));
    const photo={type:'photo',url:'https://pbs.twimg.com/media/a.jpg'},video={type:'video',url:'https://video.twimg.com/a.mp4'};
    assert.deepEqual(twitterItems({code:200,tweet:{media:{all:[video,photo]}}}),[{kind:'video',url:video.url},{kind:'image',url:photo.url}]);
    assert.deepEqual(twitterItems({code:200,tweet:{author:{protected:true},media:{all:[photo]}}}),[]);
});
test('every redirect validated and byte limit removes incomplete file',async()=>{
    const validate=v=>mediaUrl('twitter',v);
    let calls=0;
    await assert.rejects(safeResponse('https://pbs.twimg.com/a',validate,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/a'}});}}));
    assert.equal(calls,1);
    await withTemp(async dir=>{
        const p=join(dir,'data');
        await assert.rejects(downloadSocialFile('https://pbs.twimg.com/a',p,validate,{limit:2,fetcher:async()=>new Response(new Uint8Array([1,2,3]))}),{code:'size'});
        await assert.rejects(access(p));
        assert.equal(await downloadSocialFile('https://pbs.twimg.com/a',p,validate,{limit:4,fetcher:async()=>new Response(new Uint8Array([1,2,3]))}),3);
        assert.deepEqual(await readFile(p),Buffer.from([1,2,3]));
    });
});
