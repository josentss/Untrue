import test from 'node:test';
import assert from 'node:assert/strict';
import {apiDirectItems,postError,createPostGate,retryAfterMs,fallbackPost} from '../core/instagramPostPolicy.js';
const url='https://www.instagram.com/p/ABC/';
const image='https://x.cdninstagram.com/a.jpg',video='https://x.fbcdn.net/b.mp4';
const post={url,media_type:'carousel_container',carousel_media_count:2,carousel_media:[{is_video:false,image_url:image},{is_video:true,video_url:video}]};
test('exact shortcode, complete ordered carousel and no video poster substitution',()=>{
    assert.deepEqual(apiDirectItems({post},url),[{kind:'image',url:image},{kind:'video',url:video}]);
    for(const p of [{...post,url:'https://instagram.com/p/DEF/'},{...post,carousel_media_count:3},{...post,carousel_media:[post.carousel_media[0],{is_video:true,image_url:image}]}])assert.throws(()=>apiDirectItems({post:p},url));
    assert.throws(()=>apiDirectItems({post:{...post,is_private:true}},url),{code:'restricted'});
});
test('429 is classified by HTTP context, with retry-after and no provider switch',()=>{
    const err=postError({diagnostic:'UNTRUE_INSTAGRAM_HTTP_429 retry_after_ms=1800000'});
    assert.equal(err.code,'remote_limit');assert.equal(err.retryAfterMs,1800000);assert.equal(fallbackPost(err),false);
    assert.notEqual(postError({diagnostic:'failed to extract id 429'}).code,'remote_limit');
    let now=0;const gate=createPostGate({now:()=>now});gate.observe(err);
    assert.throws(()=>gate.check(),{code:'remote_limit'});now=1800001;gate.check();
    assert.equal(retryAfterMs('120'),120000);assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:30 GMT',0),30000);
});
