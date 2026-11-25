// High-detail profiles; never resize below 192 or use 6–8 FPS to fit.
export function videoProfiles(duration,fpsSource){
    const source=Math.max(1,Math.min(30,Math.floor(fpsSource)));
    const profiles=duration>10
        ? [[30,72,512],[30,65,384],[24,62,320],[18,58,256],[15,55,224],[12,50,192]]
        : duration>5
        ? [[30,76,512],[30,68,384],[24,64,320],[18,58,256],[15,55,224],[12,50,192]]
        : [[30,85,512],[30,72,384],[24,65,320],[18,55,256],[15,55,224],[12,50,192]];
    return profiles.map(([rate,q,size])=>[Math.min(source,rate),q,size]);
}
export const SAMPLE_EDGE=64,SAMPLE_BYTES=SAMPLE_EDGE*SAMPLE_EDGE*4;
// Reduce a decoded 512px composited frame into 64px RGBA using bounded
// spatial averaging. Compare on a neutral background to handle transparency.
export function frameSample(rgba){
    if(rgba.length!==512*512*4)throw Error('Invalid decoded frame');
    const out=Buffer.alloc(SAMPLE_BYTES);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
        let r=0,g=0,b=0,a=0;
        for(let dy=0;dy<8;dy+=2)for(let dx=0;dx<8;dx+=2){
            const i=((y*8+dy)*512+x*8+dx)*4;
            r+=rgba[i];g+=rgba[i+1];b+=rgba[i+2];a+=rgba[i+3];
        }
        const j=(y*64+x)*4;
        out[j]=Math.round(r/16);out[j+1]=Math.round(g/16);out[j+2]=Math.round(b/16);out[j+3]=Math.round(a/16);
    }
    return out;
}
export function sampleError(actual,reference){
    if(actual.length!==SAMPLE_BYTES||reference.length!==SAMPLE_BYTES)throw Error('Invalid frame sample');
    let total=0,severe=0;const tiles=new Float64Array(64);
    for(let p=0;p<4096;p++){
        const i=p*4,a=actual[i+3]/255,b=reference[i+3]/255;
        let err=0;
        for(let c=0;c<3;c++)err+=Math.abs(actual[i+c]*a+127*(1-a)-reference[i+c]*b-127*(1-b));
        err=Math.max(err/3,Math.abs(actual[i+3]-reference[i+3])/2);
        total+=err;
        if(err>70)severe++;
        tiles[Math.floor(p/512)*8+Math.floor((p%64)/8)]+=err;
    }
    const badTiles=Array.from(tiles).filter(e=>e/64>55).length;
    return {mean:total/4096,severe:severe/4096,badTiles};
}
export function acceptableSample(actual,reference){
    const e=sampleError(actual,reference);
    return e.mean<=25&&e.severe<=0.12&&e.badTiles<=3;
}
export function hdrConversion(video){
    const transfer=video?.color_transfer;
    if(!['smpte2084','arib-std-b67'].includes(transfer))return '';
    // Explicit input/output tags avoid relying on swscale's defaults for PQ/HLG.
    if(video.color_primaries!=='bt2020'||!['bt2020nc','bt2020c'].includes(video.color_space))throw Error('Unsupported HDR color metadata');
    const range=video.color_range==='pc'?'full':'limited';
    return 'zscale=pin=bt2020:min='+video.color_space+':tin='+transfer+':rin='+range+':t=linear:m=gbr:p=bt2020:npl=100,format=gbrpf32le,zscale=pin=bt2020:tin=linear:min=gbr:p=bt709,tonemap=tonemap=mobius:desat=2,zscale=pin=bt709:tin=linear:min=gbr:t=bt709:m=bt709:r=limited,format=yuv420p,';
}
function invalid(){throw Error('Invalid animated WebP structure');}
function chunks(data,start,end){
    const list=[];
    while(start<end){
        if(end-start<8)invalid();
        const type=data.toString('ascii',start,start+4),size=data.readUInt32LE(start+4),offset=start+8,next=offset+size+(size&1);
        if(next>end)invalid();
        list.push({type,offset,size,end:offset+size});start=next;
    }
    if(start!==end)invalid();return list;
}
export function validateWebpTimeline(data,{independent=false}={}){
    if(!Buffer.isBuffer(data)||data.length<12||data.length>500*1024||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP'||data.readUInt32LE(4)+8!==data.length)invalid();
    const top=chunks(data,12,data.length);
    const extended=top[0],animation=top.filter(c=>c.type==='ANIM');
    if(extended?.type!=='VP8X'||extended.size!==10||!(data[extended.offset]&2)||data.readUIntLE(extended.offset+4,3)!==511||data.readUIntLE(extended.offset+7,3)!==511||animation.length!==1||animation[0].size!==6)invalid();
    const frames=top.filter(c=>c.type==='ANMF');
    if(frames.length<2||frames.length>450||top.indexOf(animation[0])>top.indexOf(frames[0]))invalid();
    let durationMs=0;
    for(const [index,frame] of frames.entries()){
        if(frame.size<24)invalid();
        const o=frame.offset,x=data.readUIntLE(o,3)*2,y=data.readUIntLE(o+3,3)*2,w=data.readUIntLE(o+6,3)+1,h=data.readUIntLE(o+9,3)+1,d=data.readUIntLE(o+12,3);
        if(x+w>512||y+h>512||d<10||data[o+15]&0xfc||(!index&&(x||y||w!==512||h!==512)))invalid();
        if(independent&&(x||y||w!==512||h!==512||!(data[o+15]&2)))invalid();
        const inner=chunks(data,o+16,frame.end);
        if(inner.filter(c=>c.type==='VP8 '||c.type==='VP8L').length!==1||inner.filter(c=>c.type==='ALPH').length>1)invalid();
        durationMs+=d;
    }
    if(durationMs>15000)invalid();
    return {frames:frames.length,durationMs};
}
