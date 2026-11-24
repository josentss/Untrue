import {join,resolve,dirname} from 'node:path';
import {mkdir,readdir,lstat,readFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {run} from '../core/process.js';
import {galleryPython} from '../core/config.js';
import {childEnv} from './musicDownloader.js';
import {postError} from '../core/instagramPostPolicy.js';
import {DownloadError,publicError} from '../core/downloadPolicy.js';
const script=fileURLToPath(new URL('../scripts/gallery-public.py',import.meta.url));
function galleryError(e){
    const diagnostic=String(e?.diagnostic||e?.message||'');
    if(/UNTRUE_RATE_LIMIT|\b429\b|too many requests|rate.?limit/i.test(diagnostic))return new DownloadError('remote_limit','La plataforma está limitando las descargas desde el servidor.');
    if(/UNTRUE_ACCESS_RESTRICTED|\b(?:401|403)\b|authentication|authorization|login|log in|private|captcha|cookies (?:are )?required/i.test(diagnostic))return new DownloadError('restricted','La plataforma restringe el acceso a esta publicación.');
    return publicError(e);
}
const unsupported=()=>new DownloadError('unavailable','No se encontró una galería pública completa.');
export function galleryArgs(platform,url,dir,kind){
    const categories={tiktok:'tiktok:post,tiktok:vmpost',instagram:'instagram:post',pinterest:'pinterest:pin,pinterest:pinit'};
    if(!categories[platform])throw unsupported();
    const args=[script,platform,'--ignore-config','--no-input','--no-colors','--http-timeout','12','--retries','0','--whitelist',categories[platform],
        '--range','1-21','--directory',dir,'--Print-to-file','after:{_path}',join(dir,'manifest.txt'),
        '-o','extractor.skip=false','-o','downloader.ytdl.enabled=false','-o','extractor.instagram.previews=false','-o','extractor.pinterest.videos=true'];
    if(platform==='tiktok')args.push('-o','extractor.tiktok.photos='+(kind==='audio'?'false':'true'),'-o','extractor.tiktok.audio='+(kind==='audio'?'true':'false'),'-o','extractor.tiktok.videos=false','-o','extractor.tiktok.covers=false');
    return [...args,'--',url];
}
function mediaKind(path){
    if(/\.(?:jpe?g|png|webp|avif|heic|heif)$/i.test(path))return 'image';
    if(/\.(?:mp4|webm|mov|mkv)$/i.test(path))return 'video';
    if(/\.(?:mp3|m4a|aac|ogg|opus|wav)$/i.test(path))return 'audio';
    return null;
}
async function usage(dir){
    let bytes=0;
    for(const name of await readdir(dir)){
        const st=await lstat(join(dir,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(!st)continue;
        if(!st.isFile()||st.isSymbolicLink())throw unsupported();
        bytes+=st.size;
    }
    return bytes;
}
export async function galleryFiles(platform,url,dir,kind,{runner=run,limit,timeout=45000}){
    await mkdir(dir,{mode:0o700});
    const controller=new AbortController();
    let busy=false;
    const timer=setInterval(async()=>{
        if(busy)return;busy=true;
        try{if(await usage(dir)>limit*2)controller.abort(new DownloadError('size','La galería supera el espacio temporal permitido.'));}
        catch(e){controller.abort(e);}
        finally{busy=false;}
    },300);timer.unref();
    try{
        const args=galleryArgs(platform,url,dir,kind);
        const result=await runner(galleryPython,args,{env:childEnv(dir),timeout,maxOutput:512*1024,processGroup:true,diagnostics:true,signal:controller.signal});
        if(controller.signal.aborted)throw controller.signal.reason;
        // A successful process may still have reported extraction/download errors.
        const diagnostics=String(result.stderr||'');
        if(/UNTRUE_(?:ACCESS_RESTRICTED|RATE_LIMIT|INSTAGRAM_HTTP_\d+)|\b(?:error|critical)\b/i.test(diagnostics)||/failed to (?:download|extract)|unsupported story block|error when extracting/i.test(diagnostics))throw Object.assign(Error('gallery failed'),{diagnostic:diagnostics});
        const names=(await readFile(join(dir,'manifest.txt'),'utf8').catch(()=> '')).trim().split(/\r?\n/).filter(Boolean);
        if(!names.length)throw unsupported();
        if(names.length>20)throw new DownloadError('size','La publicación supera los 20 archivos.');
        const files=[],seen=new Set();let bytes=0;
        for(const name of names){
            const path=resolve(name),type=mediaKind(path);
            if(dirname(path)!==resolve(dir)||seen.has(path)||!type)throw unsupported();
            if(platform==='tiktok'&&type!==(kind==='audio'?'audio':'image'))throw unsupported();
            if(platform==='instagram'&&type==='audio')throw unsupported();
            const st=await lstat(path);
            if(!st.isFile()||st.isSymbolicLink()||!st.size)throw unsupported();
            seen.add(path);bytes+=st.size;
            if(bytes>limit)throw new DownloadError('size','La galería supera el límite de tamaño.');
            files.push({path,kind:type});
        }
        // Do not silently accept missing manifest entries or interrupted downloads.
        for(const name of await readdir(dir))if(name!=='manifest.txt'&&!seen.has(join(dir,name)))throw unsupported();
        return files;
    }catch(e){throw platform==='instagram'?postError(e):galleryError(e);}
    finally{clearInterval(timer);if(controller.signal.aborted)await rm(dir,{recursive:true,force:true});}
}
