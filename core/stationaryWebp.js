// Build an animated RIFF/WebP from a known static WebP frame. Used only
// when libwebp has coalesced a video into a single still image.
function chunk(type,data) {
    const head=Buffer.alloc(8);
    head.write(type,0,4,'ascii');
    head.writeUInt32LE(data.length,4);
    return Buffer.concat([head,data,Buffer.alloc(data.length&1)]);
}
export function stationaryWebp(frame,{width,height,durationMs,exif}) {
    if(!Buffer.isBuffer(frame)||frame.length<12||frame.toString('ascii',0,4)!=='RIFF'||frame.toString('ascii',8,12)!=='WEBP'||frame.readUInt32LE(4)+8!==frame.length) throw Error('Invalid static WebP');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||!Number.isInteger(durationMs)||durationMs<20||durationMs>15000) throw Error('Invalid animation parameters');
    const imageChunks=[];
    let images=0,hasAlpha=false;
    for(let offset=12;offset<frame.length;){
        if(offset+8>frame.length) throw Error('Invalid chunk header');
        const type=frame.toString('ascii',offset,offset+4),size=frame.readUInt32LE(offset+4);
        const start=offset+8,end=start+size,next=end+(size&1);
        if(next>frame.length) throw Error('Invalid chunk size');
        if(type==='ANIM'||type==='ANMF') throw Error('Expected static WebP frame');
        if(type==='ALPH'||type==='VP8 '||type==='VP8L'){
            imageChunks.push(frame.subarray(offset,next));
            if(type==='ALPH') hasAlpha=true;
            else {
                images++;
                if(type==='VP8L'){
                    if(size<5||frame[start]!==0x2f) throw Error('Invalid VP8L frame');
                    hasAlpha ||= Boolean(frame[start+4]&0x10);
                }
            }
        }
        offset=next;
    }
    if(images!==1) throw Error('Expected one image chunk');
    const extended=Buffer.alloc(10);
    extended[0]=0x02|(hasAlpha?0x10:0)|(exif?0x08:0);
    extended.writeUIntLE(width-1,4,3);
    extended.writeUIntLE(height-1,7,3);
    const image=Buffer.concat(imageChunks);
    function animationFrame(delay){
        const header=Buffer.alloc(16);
        header.writeUIntLE(width-1,6,3);
        header.writeUIntLE(height-1,9,3);
        header.writeUIntLE(delay,12,3);
        header[15]=0x02; // Full-canvas frame replaces previous contents.
        return chunk('ANMF',Buffer.concat([header,image]));
    }
    const first=Math.floor(durationMs/2);
    const body=Buffer.concat([Buffer.from('WEBP'),chunk('VP8X',extended),chunk('ANIM',Buffer.alloc(6)),animationFrame(first),animationFrame(durationMs-first),...(exif?[chunk('EXIF',exif)]:[])]);
    const riff=Buffer.alloc(8);
    riff.write('RIFF');riff.writeUInt32LE(body.length,4);
    return Buffer.concat([riff,body]);
}
