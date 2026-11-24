import { join } from 'node:path';
import { stat,readdir } from 'node:fs/promises';
import { run,withTemp } from '../core/process.js';
import { ytDlp,ffmpeg,ffprobe,maxInputBytes } from '../core/config.js';
import { mediaInput,maxDuration,videoFormat,durationText,DownloadError,publicError } from '../core/downloadPolicy.js';

const metadataTemplate='%(.{title,uploader,channel,artist,duration,webpage_url,description})j';
export function commonArgs(){
    return ['--ignore-config','--no-plugin-dirs','--no-remote-components','--no-js-runtimes','--js-runtimes','node:'+process.execPath,'--no-playlist','--playlist-items','1','--no-progress','--no-colors','--socket-timeout','12','--retries','1','--fragment-retries','1','--extractor-retries','1','--abort-on-unavailable-fragments'];
}
export function downloadArgs(input,dir,kind,limit){
    const args=[...commonArgs(),'--no-simulate','--max-filesize',String(limit),'--match-filter','!is_live & !is_upcoming & duration <= '+maxDuration[kind]+' & availability !=? private & availability !=? premium_only & availability !=? subscriber_only & availability !=? needs_auth','--print','after_move:'+metadataTemplate,'-o',join(dir,'media.%(ext)s')];
    if(ffmpeg!=='ffmpeg')args.push('--ffmpeg-location',ffmpeg);
    if(kind==='audio')args.push('-f','ba/b','-x','--audio-format','mp3','--audio-quality','192K');
    else args.push('-f',videoFormat(limit),'--merge-output-format','mp4');
    return [...args,'--',input];
}
function cleanText(value,fallback,max=180){
    return typeof value==='string'&&value.trim()&&value!=='NA'?Array.from(value.replace(/[\p{C}]/gu,' ').trim()).slice(0,max).join(''):fallback;
}
function metadata(stdout){
    const lines=stdout.trim().split('\n').filter(Boolean);
    if(lines.length!==1)throw new DownloadError('unavailable','No se encontró un archivo disponible dentro de los límites.');
    try{return JSON.parse(lines[0]);}catch{throw new DownloadError('metadata','No se pudo verificar la información del archivo.');}
}
export function mediaInfo(data,seconds=data.duration){
    return {title:cleanText(data.title,'Contenido'),author:cleanText(data.artist||data.uploader||data.channel,'Desconocido'),duration:seconds,durationFormatted:durationText(seconds),url:cleanText(data.webpage_url,'',2048),description:cleanText(data.description,'',200)};
}
export function childEnv(dir){
    // No bot API keys, auth path or inherited custom plugin configuration.
    const out={PATH:process.env.PATH||'',HOME:dir,TMPDIR:dir,TMP:dir,TEMP:dir,LANG:'C.UTF-8'};
    for(const key of ['SystemRoot','WINDIR','PATHEXT','COMSPEC'])if(process.env[key])out[key]=process.env[key];
    return out;
}
async function diskUsage(dir){
    let bytes=0;
    for(const entry of await readdir(dir,{withFileTypes:true})){
        const path=join(dir,entry.name);
        if(entry.isDirectory())bytes+=await diskUsage(path);
        else if(entry.isFile())bytes+=(await stat(path).catch(e=>{if(e.code==='ENOENT')return {size:0};throw e;})).size;
    }
    return bytes;
}
export async function boundedRun(args,dir,limit,runner){
    const controller=new AbortController();
    let checking=false;
    const timer=setInterval(async()=>{
        if(checking)return;checking=true;
        try{if(await diskUsage(dir)>limit*3)controller.abort(new DownloadError('size','El archivo supera el espacio permitido para procesarlo.'));}
        catch(e){if(e.code!=='ENOENT')controller.abort(new DownloadError('failed','No se pudo verificar el almacenamiento temporal.'));}
        finally{checking=false;}
    },500);timer.unref();
    try{return await runner(ytDlp,args,{timeout:120000,maxOutput:512*1024,signal:controller.signal,env:childEnv(dir),processGroup:true,diagnostics:true});}
    finally{clearInterval(timer);}
}
export async function verifyDownload(path,kind,limit,runner=run){
    const s=await stat(path).catch(()=>null);
    if(!s?.isFile()||!s.size)throw new DownloadError('unavailable','No se obtuvo un archivo completo. Puede exceder los límites de duración o tamaño.');
    if(s.size>limit)throw new DownloadError('size','El archivo supera el límite de tamaño.');
    const {stdout}=await runner(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path],{timeout:15000,maxOutput:512*1024});
    const probe=JSON.parse(stdout),streams=probe.streams||[],duration=Number(probe.format?.duration);
    const video=streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
    const audio=streams.find(s=>s.codec_type==='audio');
    const ok=kind==='audio'?audio?.codec_name==='mp3'&&String(probe.format?.format_name).split(',').includes('mp3')&&!video:video?.codec_name==='h264'&&Number.isFinite(video.height)&&video.height>0&&video.height<=720&&audio?.codec_name==='aac'&&String(probe.format?.format_name).split(',').includes('mp4');
    if(!ok||!Number.isFinite(duration)||duration<=0||duration>maxDuration[kind]+1)throw new DownloadError('format','El archivo no cumple los requisitos de reproducción.');
    return {bytes:s.size,duration,height:video?.height};
}
export async function withMusicDownload(platform,kind,query,consume,{runner=run,limit=maxInputBytes}={}){
    const input=mediaInput(platform,query);
    return withTemp(async dir=>{
        const start=Date.now();
        try{
            const {stdout}=await boundedRun(downloadArgs(input,dir,kind,limit),dir,limit,runner);
            const filePath=join(dir,kind==='audio'?'media.mp3':'media.mp4');
            const checked=await verifyDownload(filePath,kind,limit,runner);
            const info=mediaInfo(metadata(stdout),checked.duration);
            console.info('Descarga verificada '+JSON.stringify({platform,kind,ms:Date.now()-start,bytes:checked.bytes,duration:checked.duration,height:checked.height}));
            try{return await consume({filePath,info,...checked});}catch{throw new DownloadError('send','No se pudo enviar el archivo descargado a WhatsApp.');}
        }catch(e){throw publicError(e);}
    });
}
export async function getYoutubeInfo(query,{runner=run}={}){
    const input=mediaInput('youtube',query);
    return withTemp(async dir=>{
        try{
            const {stdout}=await runner(ytDlp,[...commonArgs(),'--skip-download','--print',metadataTemplate,'--',input],{timeout:30000,maxOutput:512*1024,env:childEnv(dir),processGroup:true,diagnostics:true});
            return mediaInfo(metadata(stdout));
        }catch(e){throw publicError(e);}
    });
}
