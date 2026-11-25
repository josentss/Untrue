// Profiles intentionally avoid the former 0-quality / 48-pixel fallback.
export function videoProfiles(duration,fpsSource){
    const profiles=duration>10
        ? [[30,55,384],[30,40,320],[24,42,256],[18,40,224],[15,40,192],[12,35,144],[10,35,128],[8,35,112],[6,30,96],[6,30,80]]
        : duration>5
        ? [[30,58,512],[30,45,384],[24,45,320],[20,42,256],[15,40,192],[12,35,144],[10,35,112],[8,30,96],[6,30,80]]
        : [[30,78,512],[30,60,384],[24,55,320],[20,48,256],[15,45,192],[12,40,144],[10,35,112],[8,30,96],[6,30,80]];
    if(duration>10&&fpsSource<=15)profiles.unshift([15,58,320]);
    return profiles;
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
export function validateWebpTimeline(data){
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
        const inner=chunks(data,o+16,frame.end);
        if(inner.filter(c=>c.type==='VP8 '||c.type==='VP8L').length!==1||inner.filter(c=>c.type==='ALPH').length>1)invalid();
        durationMs+=d;
    }
    if(durationMs>15000)invalid();
    return {frames:frames.length,durationMs};
}
