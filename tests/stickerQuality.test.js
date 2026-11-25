import test from 'node:test';
import assert from 'node:assert/strict';
import {videoProfiles,validateWebpTimeline} from '../core/stickerQuality.js';
import {stationaryWebp} from '../core/stationaryWebp.js';
// RIFF sample with a synthetic VP8 chunk: structural tests only, not a decoder test.
const frame=Buffer.from('524946461000000057454250565038200400000000000000','hex');
test('all video profiles avoid extreme loss of quality',()=>{
    for(const seconds of [1,5,8,15])for(const fps of [10,30])for(const [rate,q,detail] of videoProfiles(seconds,fps)){
        assert.ok(rate>=6&&rate<=30);assert.ok(q>=30);assert.ok(detail>=80&&detail<=512);
    }
});
test('animated container bounds and timeline are enforced',()=>{
    const buf=stationaryWebp(frame,{width:512,height:512,durationMs:1000});
    assert.deepEqual(validateWebpTimeline(buf),{frames:2,durationMs:1000});
    const broken=Buffer.from(buf);broken.writeUIntLE(512,broken.indexOf('ANMF')+8,3);
    assert.throws(()=>validateWebpTimeline(broken));
    assert.throws(()=>validateWebpTimeline(buf.subarray(0,-1)));
});
