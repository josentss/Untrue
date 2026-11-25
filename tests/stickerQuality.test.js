import test from 'node:test';
import assert from 'node:assert/strict';
import {videoProfiles,validateWebpTimeline,acceptableSample,frameSample,SAMPLE_BYTES,hdrConversion} from '../core/stickerQuality.js';
import {stationaryWebp} from '../core/stationaryWebp.js';
// RIFF sample with a synthetic VP8 chunk: structural tests only, not a decoder test.
const frame=Buffer.from('524946461000000057454250565038200400000000000000','hex');
test('all video profiles avoid extreme loss of quality',()=>{
    for(const seconds of [1,5,8,15])for(const fps of [10,30])for(const [rate,q,detail] of videoProfiles(seconds,fps)){
        assert.ok(rate>=Math.min(12,fps)&&rate<=fps);assert.ok(q>=50);assert.ok(detail>=192&&detail<=512);
    }
});
test('animated container bounds and timeline are enforced',()=>{
    const buf=stationaryWebp(frame,{width:512,height:512,durationMs:1000});
    assert.deepEqual(validateWebpTimeline(buf,{independent:true}),{frames:2,durationMs:1000});
    const blend=Buffer.from(buf);blend[blend.indexOf('ANMF')+8+15]=0;
    assert.throws(()=>validateWebpTimeline(blend,{independent:true}));
    const broken=Buffer.from(buf);broken.writeUIntLE(512,broken.indexOf('ANMF')+8,3);
    assert.throws(()=>validateWebpTimeline(broken));
    assert.throws(()=>validateWebpTimeline(buf.subarray(0,-1)));
});

test('frame comparison catches a broad corrupt block and preserved transparent pixels',()=>{
    const rgba=Buffer.alloc(512*512*4,255);
    const good=frameSample(rgba);
    assert.equal(good.length,SAMPLE_BYTES);assert.equal(acceptableSample(good,good),true);
    const corrupt=Buffer.from(good);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++)corrupt.fill(0,(y*64+x)*4,(y*64+x)*4+3);
    assert.equal(acceptableSample(corrupt,good),false);
    const subtle=Buffer.from(good);for(let i=0;i<subtle.length;i+=4)subtle[i]=245;
    assert.equal(acceptableSample(subtle,good),true);
});
test('HDR transform only for tagged PQ or HLG',()=>{
    assert.equal(hdrConversion({color_transfer:'bt709'}),'');
    assert.match(hdrConversion({color_transfer:'smpte2084',color_primaries:'bt2020',color_space:'bt2020nc'}),/tonemap=tonemap=mobius/);
    assert.throws(()=>hdrConversion({color_transfer:'smpte2084'}));
});
