import sharp from 'sharp';
import WebP from 'node-webpmux';
import { join } from 'node:path';
import { stat,writeFile } from 'node:fs/promises';
import { run } from '../core/process.js';
import { ffmpeg,ffprobe } from '../core/config.js';
import { MediaError } from '../core/mediaTarget.js';
import { stationaryWebp } from '../core/stationaryWebp.js';

export const LIMITS=Object.freeze({size:512,staticBytes:100*1024,animatedBytes:500*1024,durationMs:15000,frames:450,pixels:48*1024*1024,animationPixels:120*1024*1024});
const transparent={r:0,g:0,b:0,alpha:0};
const mediaFormats='mov,matroska,webm,avi,mpeg,mpegts,mp3,wav,ogg,flac,aac';
const inputArgs=['-protocol_whitelist','file,pipe','-format_whitelist',mediaFormats];
const sharpOptions={limitInputPixels:LIMITS.pixels,failOn:'error'};
const animatedOptions={...sharpOptions,animated:true};
const baseArgs=['-hide_banner','-loglevel','error','-nostdin','-y','-filter_threads','1','-threads','2'];
const fitOptions= crop => ({fit:crop?'cover':'contain',background:transparent,position:'centre'});
const deadline=()=>Date.now()+120000;
function remaining(end) {
    const ms=end-Date.now();
    if(ms<=0) throw new MediaError('Tiempo de conversión agotado.');
    return Math.min(ms,45000);
}
export function stickerExif(date=new Date()) {
    const footer=new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
    const json=Buffer.from(JSON.stringify({'sticker-pack-id':'untrue-bot','sticker-pack-name':'UntrueBot','sticker-pack-publisher':footer,author:footer,emojis:['✨']}));
    const header=Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x41,0x57,7,0,0,0,0,0,22,0,0,0]);
    header.writeUInt32LE(json.length,14);
    return Buffer.concat([header,json]);
}
async function metadata(input) {
    // Read metadata without loading all pages; the default input pixel limit applies to one frame.
    return sharp(input,sharpOptions).metadata();
}
function animationInfo(meta,{candidate=false}={}) {
    const pages=meta.pages||1;
    if (pages>LIMITS.frames) throw new MediaError('La animación contiene demasiados fotogramas.');
    const delays=pages>1?Array.from({length:pages},(_,i)=>Math.max(10,Number(meta.delay?.[i])||100)):[];
    const durationMs=delays.reduce((a,b)=>a+b,0);
    if(!candidate&&durationMs>LIMITS.durationMs) throw new MediaError('Máximo 15 segundos de animación.');
    return {pages,delays,durationMs,animated:pages>1};
}
async function addExif(input,output) {
    const mux=new WebP.Image();
    await mux.load(input);
    mux.exif=stickerExif();
    await mux.save(output);
}
async function checkSticker(path,animated) {
    const meta=await metadata(path);
    const info=animationInfo(meta);
    if(meta.format!=='webp'||meta.width!==512||(meta.pageHeight||meta.height)!==512||info.animated!==animated) throw new MediaError('El resultado no es un sticker WebP válido.');
    const size=(await stat(path)).size;
    return size>0&&size<=(animated?LIMITS.animatedBytes:LIMITS.staticBytes) ? {path,animated,durationMs:info.durationMs,frames:info.pages,fps:info.animated?Math.round(info.pages*100000/info.durationMs)/100:0,bytes:size} : null;
}
export async function inspectMedia(path) {
    const {stdout}=await run(ffprobe,['-v','error',...inputArgs,'-show_format','-show_streams','-of','json',path],{timeout:15000,maxOutput:512*1024});
    return JSON.parse(stdout);
}
function videoDuration(info) {
    const video=info.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
    if(!video) throw new MediaError('El archivo no contiene video.');
    if(video.width*video.height>LIMITS.pixels) throw new MediaError('Resolución demasiado grande.');
    const duration=Number(video.duration||info.format?.duration);
    if(!Number.isFinite(duration)||duration<=0||duration>LIMITS.durationMs/1000) throw new MediaError('Máximo 15 segundos de video.');
    return duration;
}
function sourceFps(info) {
    const video=info.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
    for(const rate of [video?.avg_frame_rate,video?.r_frame_rate]){
        const [n,d=1]=String(rate||'').split('/').map(Number);
        const fps=n/d;
        if(Number.isFinite(fps)&&fps>0) return Math.min(30,fps);
    }
    return 24;
}
function videoFilter(size,fps,crop,alpha) {
    return 'fps='+fps+(alpha?',format=rgba':'')+',scale='+size+':'+size+':force_original_aspect_ratio='+(crop?'increase':'decrease')+
        (crop?',crop='+size+':'+size:',pad='+size+':'+size+':(ow-iw)/2:(oh-ih)/2:color=black@0')+
        ',scale=512:512:flags=bilinear,setsar=1,format='+(alpha?'yuva420p':'yuv420p');
}
export async function createSticker(input,dir,{kind,crop=true}={}) {
    const end=deadline();
    const encoded=join(dir,'encoded.webp'),output=join(dir,'sticker.webp');
    let animated=false;
    if(kind==='image'||kind==='sticker') {
        const meta=await metadata(input);
        if(!['jpeg','png','webp','gif','heif','tiff','avif'].includes(meta.format)) throw new MediaError('Formato de imagen no compatible.');
        const info=animationInfo(meta); animated=info.animated;
        const framePixels=meta.width*(meta.pageHeight||meta.height);
        // Re-sticker an already compliant WebP without recompression or decoding hundreds of frames.
        if(meta.format==='webp'&&meta.width===512&&(meta.pageHeight||meta.height)===512&&framePixels*info.pages<=LIMITS.animationPixels&&(await stat(input)).size<=(animated?LIMITS.animatedBytes:LIMITS.staticBytes)){
            await addExif(input,output);
            const result=await checkSticker(output,animated);
            if(result) return result;
        }
        if(framePixels*info.pages>LIMITS.pixels||info.pages*512*512>LIMITS.animationPixels) throw new MediaError('Animación demasiado grande.');
        if(animated&&!['webp','gif'].includes(meta.format)) throw new MediaError('Solo GIF y WebP admiten animaciones de imagen.');
        const profiles=animated?[[78,512],[58,512],[40,512],[28,512],[15,512]]:[[88,512],[75,512],[58,512],[40,512],[25,512],[15,512]];
        for(const [quality,size] of profiles) {
            remaining(end);
            // Animated sharp resize works on each page; never rotate or resize the tall stacked image manually.
            let image=sharp(input,animated?animatedOptions:sharpOptions);
            if(!animated) image=image.rotate();
            image=image.resize(size,size,fitOptions(crop));
            await image.webp({quality,alphaQuality:80,effort:4,...(animated?{loop:0,delay:info.delays}:{})}).toFile(encoded);
            await addExif(encoded,output);
            const result=await checkSticker(output,animated);
            if(result) return result;
        }
    } else if(kind==='video') {
        const info=await inspectMedia(input);
        const duration=videoDuration(info);
        animated=true;
        const fpsSource=sourceFps(info);
        const video=info.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
        const alpha=!crop||/^(?:rgba|bgra|argb|abgr|yuva|gbrap|ya|pal8)/.test(video.pix_fmt||'');
        // Choose a stronger initial compression for long clips; preserve motion
        // whenever possible, then reduce spatial detail and finally FPS.
        const profiles=duration>10
            ? [[30,35,384],[24,28,320],[20,18,224],[15,12,160],[12,8,112],[10,5,80],[8,0,64],[6,0,48]]
            : [[30,duration>5?35:65,512],[30,duration>5?18:35,320],[24,18,256],[18,12,192],[15,8,144],[12,5,96],[10,0,64],[8,0,48],[6,0,48]];
        const attempted=new Set();
        let smallest=Infinity, lastFailure='size';
        for(const [cap,quality,size] of profiles){
            // Integer rates keep exact 15-second sources within the duration limit.
            const fps=Math.min(Math.max(1,Math.floor(fpsSource)),cap);
            const key=[fps,quality,size].join(':');
            if(attempted.has(key)) continue;
            attempted.add(key);
            let timeout;
            try { timeout=remaining(end); }
            catch { lastFailure='timeout'; break; }
            try {
                await run(ffmpeg,[...baseArgs,...inputArgs,'-i',input,'-map','0:'+video.index,'-t',String(duration),'-an','-vf',videoFilter(size,fps,crop,alpha),'-c:v','libwebp_anim','-quality',String(quality),'-compression_level','3','-loop','0','-threads','2',encoded],{timeout});
                const bytes=(await stat(encoded)).size;
                smallest=Math.min(smallest,bytes);
                const meta=await metadata(encoded);
                animated=(meta.pages||1)>1;
                if(!animated&&duration>=0.02&&bytes*2+1024<=LIMITS.animatedBytes){
                    // libwebp collapses a still video to a static image. Preserve its timeline (and any audio) with two identical frames.
                    const total=Math.round(duration*1000);
                    // Normalize even a one-frame animated container into a truly static frame.
                    const frame=await sharp(encoded,sharpOptions).webp({quality:Math.max(1,quality),alphaQuality:80}).toBuffer();
                    const animation=stationaryWebp(frame,{width:512,height:512,durationMs:total,exif:stickerExif()});
                    if(animation.length>LIMITS.animatedBytes){lastFailure='size';continue;}
                    await writeFile(output,animation);
                    console.info('Sticker video estacionario '+JSON.stringify({durationMs:total,bytes:animation.length}));
                    const result=await checkSticker(output,true);
                    if(result) return result;
                    lastFailure='size';continue;
                }
                const visual=animationInfo(meta,{candidate:true});
                // A failed candidate must never prevent trying a smaller profile.
                const validDuration=animated&&visual.durationMs<=LIMITS.durationMs&&Math.abs(visual.durationMs-duration*1000)<=Math.max(100,2000/fps);
                console.info('Sticker perfil '+JSON.stringify({fps,quality,detail:size,bytes,durationMs:visual.durationMs,frames:visual.pages}));
                if(!validDuration){lastFailure='duration';continue;}
                if(bytes>LIMITS.animatedBytes){lastFailure='size';continue;}
                await addExif(encoded,output);
                const result=await checkSticker(output,true);
                if(result){ console.info('Sticker perfil seleccionado '+JSON.stringify({fps:result.fps,quality,detail:size,bytes:result.bytes})); return result; }
                lastFailure='size';
            } catch(error) {
                // Only bounded categories, never stderr, local paths or user data.
                lastFailure=error instanceof MediaError?'validation':'encoder';
                console.warn('Sticker perfil fallido '+JSON.stringify({fps,quality,detail:size,reason:lastFailure}));
            }
        }
        console.warn('Sticker compresión agotada '+JSON.stringify({reason:lastFailure,attempts:attempted.size,smallestBytes:Number.isFinite(smallest)?smallest:null}));
        throw new MediaError(lastFailure==='timeout'?'Se agotó el tiempo de compresión del sticker. Intenta con un video de menor resolución.':lastFailure==='size'?'El video tiene demasiado detalle para el límite de 500 KB del sticker. Prueba con un video más sencillo.':'No se pudo convertir el video en una animación compatible. Intenta con otro video.');
    } else throw new MediaError('Solo imágenes, GIF, videos o stickers WebP.');
    throw new MediaError('No se pudo comprimir el sticker dentro del límite de WhatsApp.');
}
export async function convertWebp(input,dir,{audioPath}={}) {
    const meta=await metadata(input);
    if(meta.format!=='webp') throw new MediaError('El sticker no contiene WebP compatible.');
    const info=animationInfo(meta);
    if(!info.animated&&!audioPath){
        const path=join(dir,'sticker.png');
        await sharp(input,sharpOptions).png().toFile(path);
        return {path,kind:'image',mime:'image/png'};
    }
    if(audioPath){
        const sound=await inspectMedia(audioPath);
        const seconds=Number(sound.format?.duration);
        if(!sound.streams?.some(s=>s.codec_name==='opus')||!Number.isFinite(seconds)||seconds<=0||seconds>LIMITS.durationMs/1000+0.1) throw new MediaError('Audio de sticker no compatible.');
        if(!info.animated){
            const frame=join(dir,'still.png'),path=join(dir,'sticker.mp4');
            await sharp(input,sharpOptions).flatten({background:'#000000'}).png().toFile(frame);
            await run(ffmpeg,[...baseArgs,'-loop','1','-i',frame,...inputArgs,'-i',audioPath,'-t',String(seconds),'-map','0:v:0','-map','1:a:0','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p','-c:v','libx264','-crf','18','-preset','veryfast','-c:a','aac','-b:a','128k','-movflags','+faststart',path],{timeout:30000});
            return {path,kind:'video',mime:'video/mp4'};
        }
    }
    // Decode bounded batches instead of retaining a whole high-FPS animation in RAM.
    const height=meta.pageHeight||meta.height, width=meta.width;
    if(!Number.isSafeInteger(width*height)||width*height*info.pages>LIMITS.animationPixels) throw new MediaError('Animación demasiado grande.');
    const frameSize=width*height*4;
    const batch=Math.max(1,Math.min(16,Math.floor(16*1024*1024/frameSize)));
    const entries=[];
    const end=deadline();
    for(let start=0;start<info.pages;start+=batch){
        remaining(end);
        const count=Math.min(batch,info.pages-start);
        const {data,info:raw}=await sharp(input,{...sharpOptions,page:start,pages:count}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        if(raw.width!==width||raw.height!==height*count||raw.channels!==4||data.length!==frameSize*count) throw new MediaError('Fotogramas inválidos.');
        for(let j=0;j<count;j++){
            remaining(end);
            const i=start+j;
            const name='frame-'+String(i).padStart(3,'0')+'.png';
            await sharp(data.subarray(j*frameSize,(j+1)*frameSize),{raw:{width,height,channels:4}}).flatten({background:'#000000'}).png({compressionLevel:1}).toFile(join(dir,name));
            entries.push("file '"+name+"'",'option framerate 1000','duration '+(info.delays[i]/1000).toFixed(3));
            if(i===info.pages-1) entries.push("file '"+name+"'",'option framerate 1000');
        }
    }
    const manifest=join(dir,'frames.txt'),path=join(dir,'sticker.mp4');
    await writeFile(manifest,entries.join('\n')+'\n');
    await run(ffmpeg,[...baseArgs,'-protocol_whitelist','file,pipe','-f','concat','-safe','0','-i',manifest,...(audioPath?[...inputArgs,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','128k']:['-an']),'-t',String(info.durationMs/1000),'-vf','fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p','-c:v','libx264','-crf','18','-preset','veryfast','-threads','2','-movflags','+faststart',path],{timeout:remaining(end)});
    return {path,kind:'video',mime:'video/mp4'};
}
export async function extractAudio(input,dir){
    const info=await inspectMedia(input);
    if(!info.streams?.some(s=>s.codec_type==='audio')) throw new MediaError('El archivo no contiene audio.');
    const seconds=Number(info.format?.duration);
    if(!Number.isFinite(seconds)||seconds<=0||seconds>600) throw new MediaError('Máximo 10 minutos de audio.');
    const path=join(dir,'audio.mp3');
    await run(ffmpeg,[...baseArgs,...inputArgs,'-i',input,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','128k','-threads','2',path],{timeout:60000});
    return path;
}
