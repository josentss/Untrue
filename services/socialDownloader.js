import { join } from 'node:path';
import { stat,rename,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { load } from 'cheerio';
import { run,withTemp } from '../core/process.js';
import { ytDlp,ffmpeg,ffprobe,maxInputBytes } from '../core/config.js';
import { commonArgs,boundedRun,childEnv } from './musicDownloader.js';
import { DownloadError,publicError } from '../core/downloadPolicy.js';
import { socialUrl,mediaUrl,trustedUrl,instagramItems,twitterItems,selectItems } from '../core/socialPolicy.js';
import { safeResponse,readBounded,downloadSocialFile } from './socialHttp.js';

const MAX_ITEMS=20;
const notAvailable=()=>new DownloadError('unavailable','No se encontró contenido multimedia público.');
const metadataLimit=2*1024*1024;
const deadlineMs=180000;
function remaining(end,max=30000){
    const ms=end-Date.now();if(ms<=0)throw new DownloadError('timeout','Se agotó el tiempo de descarga.');
    return Math.min(ms,max);
}
async function jsonAt(url,domain,end,fetcher){
    const {res}=await safeResponse(url,v=>trustedUrl(v,[domain]),{fetcher,signal:AbortSignal.timeout(remaining(end,15000))});
    return JSON.parse(await readBounded(res,metadataLimit));
}
async function expand(platform,input,end,fetcher){
    if(!input.short||!['tiktok','pinterest'].includes(platform))return input;
    const {res,url}=await safeResponse(input.url,v=>socialUrl(platform,v).url,{fetcher,signal:AbortSignal.timeout(remaining(end,12000))});
    await res.body?.cancel();
    const target=socialUrl(platform,url);
    if(target.short)throw notAvailable();
    return target;
}
export function pinterestItems(html){
    const $=load(html);
    const video=$('meta[property="og:video:secure_url"]').attr('content')||$('meta[property="og:video"]').attr('content');
    const image=$('meta[property="og:image:secure_url"]').attr('content')||$('meta[property="og:image"]').attr('content');
    if(video)return [{kind:'video',url:video}];
    return image?[{kind:'image',url:image}]:[];
}
async function pinterestMedia(input,end,fetcher){
    const {res}=await safeResponse(input.url,v=>socialUrl('pinterest',v).url,{fetcher,signal:AbortSignal.timeout(remaining(end,15000))});
    return pinterestItems(await readBounded(res,4*1024*1024));
}
async function photoTikTok(input,dir,end,runner){
    const script=fileURLToPath(new URL('../scripts/tiktok-public-photos.js',import.meta.url));
    const {stdout}=await runner(process.execPath,[script,input.url],{timeout:remaining(end,20000),maxOutput:256*1024,env:childEnv(dir),processGroup:true});
    return JSON.parse(stdout.trim().split('\n').at(-1));
}
function sizeLimit(limit){return '[filesize<=?'+limit+'][filesize_approx<=?'+limit+']';}
export function socialVideoArgs(input,dir,kind,limit){
    const b=sizeLimit(limit),fit='[width<=?1280][height<=?1280]';
    const selector='bv[ext=mp4][vcodec^=avc1]'+fit+b+'+ba[ext=m4a]'+b+'/b[ext=mp4][vcodec^=avc1]'+fit+b+'/bv'+fit+b+'+ba'+b+'/b'+fit+b;
    const args=[...commonArgs(),'--no-simulate','--max-filesize',String(limit),'--match-filter','!is_live & !is_upcoming & duration <= 1800 & availability !=? private & availability !=? premium_only & availability !=? subscriber_only & availability !=? needs_auth','--print','after_move:filepath','-o',join(dir,'download.%(ext)s')];
    if(ffmpeg!=='ffmpeg')args.push('--ffmpeg-location',ffmpeg);
    if(kind==='audio')args.push('-f','ba/b','-x','--audio-format','mp3','--audio-quality','192K');
    else args.push('-f',selector,'--merge-output-format','mp4');
    return [...args,'--',input];
}
async function probe(path,runner,end){
    const {stdout}=await runner(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path],{timeout:remaining(end,15000),maxOutput:512*1024});
    return JSON.parse(stdout);
}
async function checkedSize(path,limit){
    const s=await stat(path);
    if(!s.isFile()||!s.size||s.size>limit)throw new DownloadError('size','El archivo supera el límite de tamaño o está vacío.');
    return s.size;
}
export async function normalizeSocialFile(path,kind,dir,{limit,runner=run,end=Date.now()+deadlineMs,index=0}){
    await checkedSize(path,limit);
    if(kind==='image'){
        const image=sharp(path,{limitInputPixels:32*1024*1024,failOn:'error'});
        const meta=await image.metadata();
        if(!['jpeg','png','webp','heif','avif'].includes(meta.format)||!meta.width||!meta.height||(meta.pages||1)>1)throw new DownloadError('format','Imagen no compatible.');
        const ext=meta.format==='jpeg'?'jpg':meta.format==='png'?'png':'';
        const out=join(dir,'image-'+index+'.'+(ext||'png'));
        if(ext){await image.stats();await rename(path,out);}
        else await image.rotate().png().toFile(out);
        return {kind:'image',path:out,mime:ext==='jpg'?'image/jpeg':'image/png',bytes:await checkedSize(out,limit)};
    }
    const info=await probe(path,runner,end),streams=info.streams||[];
    const video=streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),audio=streams.find(s=>s.codec_type==='audio');
    const seconds=Number(info.format?.duration);
    if(!Number.isFinite(seconds)||seconds<=0||seconds>1801)throw new DownloadError('format','Duración multimedia no compatible.');
    const out=join(dir,'media-'+index+(kind==='audio'?'.mp3':'.mp4'));
    if(kind==='audio'){
        if(!audio)throw new DownloadError('format','El contenido no tiene audio.');
        if(audio.codec_name==='mp3'&&!video&&String(info.format?.format_name).split(',').includes('mp3'))await rename(path,out);
        else await runner(ffmpeg,['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',path,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k','-fs',String(limit),out],{timeout:remaining(end,45000),processGroup:true});
    }else{
        if(!video||video.width*video.height>3840*2160)throw new DownloadError('format','Video no compatible.');
        const compatible=video.codec_name==='h264'&&video.pix_fmt==='yuv420p'&&video.width<=1280&&video.height<=1280&&(!audio||audio.codec_name==='aac');
        if(compatible&&String(info.format?.format_name).split(',').includes('mp4'))await rename(path,out);
        else await runner(ffmpeg,['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',path,'-map','0:'+video.index,'-map','0:a:0?',...(compatible?['-c:v','copy']:['-vf','scale=w=min(1280\\,iw):h=min(1280\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','20','-threads','2']),'-c:a','aac','-movflags','+faststart','-fs',String(limit),out],{timeout:remaining(end,60000),processGroup:true});
    }
    const bytes=await checkedSize(out,limit),verified=await probe(out,runner,end);
    const v=verified.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),a=verified.streams?.find(s=>s.codec_type==='audio');
    const actual=Number(verified.format?.duration);
    if(!Number.isFinite(actual)||Math.abs(actual-seconds)>Math.max(0.5,seconds*0.01)||(kind==='audio'?a?.codec_name!=='mp3'||v:!v||v.codec_name!=='h264'||(audio&&a?.codec_name!=='aac')))throw new DownloadError('format','La conversión no conservó el contenido completo.');
    return {kind,path:out,mime:kind==='audio'?'audio/mpeg':'video/mp4',bytes};
}
async function localVideo(input,kind,dir,limit,runner,end){
    const args=socialVideoArgs(input.url,dir,kind,limit);
    const {stdout}=await boundedRun(args,dir,limit,(bin,a,opts)=>runner(bin,a,{...opts,timeout:remaining(end,90000)}));
    const lines=stdout.trim().split('\n').filter(Boolean);
    if(lines.length!==1)throw notAvailable();
    const path=lines[0];
    // Accept only the output filename generated by our template, never arbitrary paths.
    if(!/^download\.[a-z0-9]{1,8}$/i.test(path.slice(dir.length+1))||!path.startsWith(dir+'/')&&!path.startsWith(dir+'\\'))throw notAvailable();
    return normalizeSocialFile(path,kind,dir,{limit,runner,end});
}
export async function withSocialDownload(platform,query,{kind='video',position}={},consume,{runner=run,fetcher=fetch,limit=maxInputBytes}={}){
    const initial=socialUrl(platform,query);
    return withTemp(async dir=>{
        const end=Date.now()+deadlineMs,start=Date.now();
        let sent=0,total=0;
        try{
            const input=await expand(platform,initial,end,fetcher);
            let items;
            if(platform==='instagram'&&kind==='post'){
                items=instagramItems(await jsonAt('https://api.bk9.dev/download/instagram?url='+encodeURIComponent(input.url),'api.bk9.dev',end,fetcher));
            }else if(platform==='twitter'){
                items=twitterItems(await jsonAt('https://api.fxtwitter.com/status/'+input.id,'api.fxtwitter.com',end,fetcher));
            }else if(platform==='pinterest'){
                items=await pinterestMedia(input,end,fetcher);
                if(items[0]?.kind==='video')items=undefined; // use supported extractor for video
            }else if(platform==='tiktok'&&input.photo){
                const data=await photoTikTok(input,dir,end,runner);
                items=kind==='audio'?(data.music?[{kind:'audio',url:data.music}]:[]):data.items;
            }
            if(items===undefined){
                const result=await localVideo(input,kind==='audio'?'audio':'video',dir,limit,runner,end);
                total=1;
                try{await consume(result,0,1);}catch{throw new DownloadError('send','No se pudo enviar el archivo a WhatsApp.');}
                sent=1;
            }else{
                const chosen=selectItems(items,position,MAX_ITEMS);
                total=chosen.length;
                let bytes=0;
                // Validate all destinations before sending any item.
                const checked=chosen.map(item=>({...item,url:mediaUrl(platform,item.url)}));
                for(const [index,item] of checked.entries()){
                    const source=join(dir,'source-'+index);
                    const left=limit-bytes;
                    if(left<=0)throw new DownloadError('size','El carrusel supera el límite total de tamaño.');
                    await downloadSocialFile(item.url,source,v=>mediaUrl(platform,v),{limit:left,fetcher,signal:AbortSignal.timeout(remaining(end))});
                    const result=await normalizeSocialFile(source,item.kind,dir,{limit:left,runner,end,index});
                    try{await consume(result,index,total);}catch{throw new DownloadError('send','No se pudo enviar el archivo a WhatsApp.');}
                    sent++;bytes+=result.bytes;
                    await unlink(source).catch(()=>{});await unlink(result.path);
                }
            }
            console.info('Red social descarga completada '+JSON.stringify({platform,kind,items:sent,ms:Date.now()-start}));
            return {sent,total};
        }catch(error){
            const e=publicError(error);
            if(sent)throw new DownloadError(e.code,'Se enviaron '+sent+' de '+total+' archivos. '+e.message);
            throw e;
        }
    });
}
