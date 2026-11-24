import sharp from 'sharp';
import WebP from 'node-webpmux';
import { join } from 'node:path';
import { stat,writeFile } from 'node:fs/promises';
import { run } from '../core/process.js';
import { ffmpeg,ffprobe } from '../core/config.js';
import { MediaError } from '../core/mediaTarget.js';

export const LIMITS=Object.freeze({size:512,staticBytes:100*1024,animatedBytes:500*1024,durationMs:10000,frames:180,pixels:48*1024*1024});
const transparent={r:0,g:0,b:0,alpha:0};
const mediaFormats='mov,matroska,webm,avi,mpeg,mpegts,mp3,wav,ogg,flac,aac';
const inputArgs=['-protocol_whitelist','file,pipe','-format_whitelist',mediaFormats];
const sharpOptions={limitInputPixels:LIMITS.pixels,failOn:'error'};
const animatedOptions={...sharpOptions,animated:true};
const baseArgs=['-hide_banner','-loglevel','error','-nostdin','-y','-filter_threads','1','-threads','2'];
const fitOptions= crop => ({fit:crop?'cover':'contain',background:transparent,position:'centre'});
const deadline=()=>Date.now()+90000;
function remaining(end) {
    const ms=end-Date.now();
    if(ms<=0) throw new MediaError('Tiempo de conversión agotado.');
    return Math.min(ms,45000);
}
function safeName(name) {
    return Array.from(String(name||'Usuario').replace(/[\p{C}]/gu,'').trim()).slice(0,60).join('')||'Usuario';
}
export function stickerExif(name,date=new Date()) {
    const footer='@'+safeName(name)+' | '+date.toLocaleDateString('es-ES');
    const json=Buffer.from(JSON.stringify({'sticker-pack-id':'untrue-bot','sticker-pack-name':'UntrueBot','sticker-pack-publisher':footer,author:footer,emojis:['✨']}));
    const header=Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x41,0x57,7,0,0,0,0,0,22,0,0,0]);
    header.writeUInt32LE(json.length,14);
    return Buffer.concat([header,json]);
}
async function metadata(input) {
    return sharp(input,animatedOptions).metadata();
}
function animationInfo(meta) {
    const pages=meta.pages||1;
    if (pages>LIMITS.frames) throw new MediaError('La animación contiene demasiados fotogramas.');
    const delays=pages>1?Array.from({length:pages},(_,i)=>Math.max(10,Number(meta.delay?.[i])||100)):[];
    const durationMs=delays.reduce((a,b)=>a+b,0);
    if(durationMs>LIMITS.durationMs) throw new MediaError('Máximo 10 segundos de animación.');
    return {pages,delays,durationMs,animated:pages>1};
}
async function addExif(input,output,name) {
    const mux=new WebP.Image();
    await mux.load(input);
    mux.exif=stickerExif(name);
    await mux.save(output);
}
async function checkSticker(path,animated) {
    const meta=await metadata(path);
    const info=animationInfo(meta);
    if(meta.format!=='webp'||meta.width!==512||(meta.pageHeight||meta.height)!==512||info.animated!==animated) throw new MediaError('El resultado no es un sticker WebP válido.');
    const size=(await stat(path)).size;
    return size>0&&size<=(animated?LIMITS.animatedBytes:LIMITS.staticBytes);
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
    if(!Number.isFinite(duration)||duration<=0||duration>10) throw new MediaError('Máximo 10 segundos de video.');
    return duration;
}
function videoFilter(size,fps,crop) {
    return 'format=rgba,scale='+size+':'+size+':force_original_aspect_ratio='+(crop?'increase':'decrease')+
        (crop?',crop='+size+':'+size:',pad='+size+':'+size+':(ow-iw)/2:(oh-ih)/2:color=black@0')+
        ',pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,fps='+fps;
}
export async function createSticker(input,dir,{kind,name,crop=true}={}) {
    const end=deadline();
    const encoded=join(dir,'encoded.webp'),output=join(dir,'sticker.webp');
    let animated=false;
    if(kind==='image'||kind==='sticker') {
        const meta=await metadata(input);
        if(!['jpeg','png','webp','gif','heif','tiff','avif'].includes(meta.format)) throw new MediaError('Formato de imagen no compatible.');
        const info=animationInfo(meta); animated=info.animated;
        if(animated&&!['webp','gif'].includes(meta.format)) throw new MediaError('Solo GIF y WebP admiten animaciones de imagen.');
        const profiles=animated?[[78,512],[58,512],[40,512],[28,512],[15,512]]:[[88,512],[75,512],[58,512],[40,512],[25,512],[15,512]];
        for(const [quality,size] of profiles) {
            remaining(end);
            // Animated sharp resize works on each page; never rotate or resize the tall stacked image manually.
            let image=sharp(input,animated?animatedOptions:sharpOptions);
            if(!animated) image=image.rotate();
            image=image.resize(size,size,fitOptions(crop));
            if(size!==512) {
                // Keep 512 canvas; sharp applies extend per page for animated images.
                const pad=(512-size)/2;
                image=image.extend({top:pad,bottom:pad,left:pad,right:pad,background:transparent});
            }
            await image.webp({quality,alphaQuality:80,effort:4,...(animated?{loop:0,delay:info.delays}:{})}).toFile(encoded);
            await addExif(encoded,output,name);
            if(await checkSticker(output,animated)) return {path:output,animated,durationMs:animationInfo(await metadata(output)).durationMs};
        }
    } else if(kind==='video') {
        const info=await inspectMedia(input);
        const duration=videoDuration(info);
        animated=true;
        const profiles=[[15,70,512],[12,50,512],[10,35,512],[8,25,512],[6,15,512]];
        for(const [fps,quality,size] of profiles){
            await run(ffmpeg,[...baseArgs,...inputArgs,'-i',input,'-map','0:v:0','-t',String(Math.min(duration,9.95)),'-an','-vf',videoFilter(size,fps,crop),'-c:v','libwebp_anim','-quality',String(quality),'-compression_level','4','-loop','0','-threads','2',encoded],{timeout:remaining(end)});
            const meta=await metadata(encoded);
            // Extremely short videos may encode to a single frame; classify from actual output.
            animated=(meta.pages||1)>1;
            await addExif(encoded,output,name);
            if(await checkSticker(output,animated)) return {path:output,animated,durationMs:animationInfo(await metadata(output)).durationMs};
        }
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
        if(!sound.streams?.some(s=>s.codec_name==='opus')||!Number.isFinite(seconds)||seconds<=0||seconds>10.1) throw new MediaError('Audio de sticker no compatible.');
        if(!info.animated){
            const frame=join(dir,'still.png'),path=join(dir,'sticker.mp4');
            await sharp(input,sharpOptions).flatten({background:'#000000'}).png().toFile(frame);
            await run(ffmpeg,[...baseArgs,'-loop','1','-i',frame,...inputArgs,'-i',audioPath,'-t',String(seconds),'-map','0:v:0','-map','1:a:0','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p','-c:v','libx264','-crf','18','-preset','veryfast','-c:a','aac','-b:a','128k','-movflags','+faststart',path],{timeout:30000});
            return {path,kind:'video',mime:'video/mp4'};
        }
    }
    // Decode all frames with libvips/WebP, preserving alpha and per-frame timing.
    // Limit decoded pixels before allocation and never quantize through GIF.
    if(info.pages*meta.width*(meta.pageHeight||meta.height)>LIMITS.pixels) throw new MediaError('Animación demasiado grande.');
    const {data,info:raw}=await sharp(input,animatedOptions).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const height=raw.height/info.pages;
    if(!Number.isInteger(height)||raw.channels!==4||raw.width*height*info.pages>LIMITS.pixels) throw new MediaError('Animación demasiado grande.');
    const frameSize=raw.width*height*4;
    const entries=[];
    const end=deadline();
    for(let i=0;i<info.pages;i++){
        remaining(end);
        const name='frame-'+String(i).padStart(3,'0')+'.png';
        await sharp(data.subarray(i*frameSize,(i+1)*frameSize),{raw:{width:raw.width,height,channels:4}}).flatten({background:'#000000'}).png().toFile(join(dir,name));
        entries.push("file '"+name+"'",'duration '+(info.delays[i]/1000).toFixed(3));
        if(i===info.pages-1) entries.push("file '"+name+"'");
    }
    const manifest=join(dir,'frames.txt'),path=join(dir,'sticker.mp4');
    await writeFile(manifest,entries.join('\n')+'\n');
    await run(ffmpeg,[...baseArgs,'-f','concat','-safe','1','-i',manifest,...(audioPath?[...inputArgs,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','128k']:['-an']),'-t',String(info.durationMs/1000),'-vf','fps=25,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p','-c:v','libx264','-crf','18','-preset','veryfast','-threads','2','-movflags','+faststart',path],{timeout:remaining(end)});
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
