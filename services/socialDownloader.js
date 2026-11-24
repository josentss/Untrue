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
// Stop on the canonical post before fetching it. Validate every redirect,
// including the hostname and path, without rewriting the next request.
async function expand(platform,input,end,fetcher){
    if(!input.short||!['tiktok','pinterest','instagram'].includes(platform))return input;
    let url=input.url;
    const signal=AbortSignal.timeout(remaining(end,12000));
    for(let i=0;i<5;i++){
        const target=socialUrl(platform,url);
        if(!target.short)return target;
        const res=await fetcher(url,{signal,redirect:'manual',headers:{'User-Agent':'UntrueBot/2.0','Accept':'text/html'}});
        const loc=res.headers.get('location');await res.body?.cancel();
        if(![301,302,303,307,308].includes(res.status)||!loc)throw new DownloadError(res.status===401||res.status===403?'restricted':res.status===429?'remote_limit':'unavailable','No se pudo resolver el enlace compartido.');
        const next=new URL(loc,url);
        socialUrl(platform,next.href);
        url=next.href;
    }
    throw notAvailable();
}
function validPinMedia(url,kind){
    try{
        const safe=mediaUrl('pinterest',url);
        const path=new URL(safe).pathname;
        if(kind==='video'&&!/\.mp4$/i.test(path))return undefined;
        if(kind==='image'&&!/\.(?:jpe?g|png|webp|avif)$/i.test(path))return undefined;
        return {kind,url:safe};
    }catch{return undefined;}
}
export function pinterestItems(html,pinId){
    const $=load(html);
    // Only inspect objects belonging to this pin; related pins are not candidates.
    let pin;
    if(pinId)for(const el of $('script#__PWS_DATA__,script#__PWS_INITIAL_PROPS__,script[type="application/json"]').toArray()){
        try{
            const root=JSON.parse($(el).text()),stack=[root];
            let scanned=0;
            while(stack.length&&scanned++<50000){
                const obj=stack.pop();
                if(!obj||typeof obj!=='object')continue;
                if(String(obj.id)===String(pinId)&&(obj.images||obj.videos||obj.story_pin_data)){pin=obj;break;}
                for(const value of Object.values(obj))if(value&&typeof value==='object')stack.push(value);
            }
        }catch{}
        if(pin)break;
    }
    const videos=pin?.videos?.video_list;
    const variants=Object.values(videos||{}).filter(v=>v&&typeof v==='object').sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));
    const directVideo=variants.map(v=>validPinMedia(v.url,'video')).find(Boolean);
    if(directVideo)return [directVideo];
    const video=$('meta[property="og:video:secure_url"]').attr('content')||$('meta[property="og:video"]').attr('content');
    if(video||videos||pin?.story_pin_data||$('meta[property="og:type"]').attr('content')?.startsWith('video')){
        const item=validPinMedia(video,'video');
        return item?[item]:[]; // let yt-dlp resolve video, not the poster image
    }
    for(const key of ['orig','original','origin','736x','564x']){
        const item=validPinMedia(pin?.images?.[key]?.url,'image');
        if(item)return [item];
    }
    const image=$('meta[property="og:image:secure_url"]').attr('content')||$('meta[property="og:image"]').attr('content');
    const item=validPinMedia(image,'image');
    return item?[item]:[];
}
async function pinterestMedia(input,end,fetcher){
    const {res}=await safeResponse(input.url,v=>socialUrl('pinterest',v).url,{fetcher,signal:AbortSignal.timeout(remaining(end,15000)),headers:{Accept:'text/html'}});
    return pinterestItems(await readBounded(res,4*1024*1024),input.id);
}
function canTryAlternative(error){return ['unavailable','timeout','failed'].includes(publicError(error).code);}
// Public, structured page data only. Never infer a carousel from its poster.
export function instagramPublicItems(html,shortcode){
    const $=load(html);
    let post;
    for(const el of $('script[type="application/json"]').toArray()){
        try{
            const stack=[JSON.parse($(el).text())];let scanned=0;
            while(stack.length&&scanned++<50000){
                const obj=stack.pop();
                if(!obj||typeof obj!=='object')continue;
                if((obj.shortcode===shortcode||obj.code===shortcode)&&(obj.__typename||obj.media_type||obj.display_url||obj.video_url||obj.carousel_media||obj.edge_sidecar_to_children)){
                    if(obj.is_private===true||obj.owner?.is_private===true||obj.user?.is_private===true)throw new DownloadError('restricted','La publicación no es pública.');
                    post=obj;break;
                }
                for(const value of Object.values(obj))if(value&&typeof value==='object')stack.push(value);
            }
        }catch(e){if(e instanceof DownloadError)throw e;}
        if(post)break;
    }
    if(!post)return [];
    const sidecar=post.edge_sidecar_to_children?.edges;
    const carousel=post.__typename==='GraphSidecar'||post.media_type===8||Array.isArray(sidecar)||Array.isArray(post.carousel_media);
    const nodes=carousel?(Array.isArray(sidecar)?sidecar.map(e=>e?.node):post.carousel_media):[post];
    if(!Array.isArray(nodes)||!nodes.length||nodes.length>MAX_ITEMS)return [];
    const result=[];
    for(const node of nodes){
        if(!node||node.is_private===true||node.owner?.is_private===true||node.user?.is_private===true)return [];
        const video=node.is_video===true||node.media_type===2||node.__typename==='GraphVideo';
        const variants=video?node.video_versions:node.image_versions2?.candidates;
        const best=Array.isArray(variants)?[...variants].sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0))[0]?.url:undefined;
        const url=video?(node.video_url||best):(node.display_url||best);
        if(!url)return [];
        result.push({kind:video?'video':'image',url:mediaUrl('instagram',url)});
    }
    return result;
}
async function publicInstagram(input,end,fetcher){
    const {res}=await safeResponse(input.url,v=>socialUrl('instagram',v).url,{fetcher,signal:AbortSignal.timeout(remaining(end,12000)),headers:{Accept:'text/html'}});
    const html=await readBounded(res,4*1024*1024);
    const shortcode=new URL(input.url).pathname.split('/')[2];
    return instagramPublicItems(html,shortcode);
}
async function instagramMedia(input,end,fetcher){
    let last=notAvailable();
    for(const endpoint of ['instagram','instagram2']){
        try{
            const items=instagramItems(await jsonAt('https://api.bk9.dev/download/'+endpoint+'?url='+encodeURIComponent(input.url),'api.bk9.dev',end,fetcher));
            if(!items.length)throw notAvailable();
            for(const item of items)mediaUrl('instagram',item.url);
            console.info('Instagram proveedor '+JSON.stringify({endpoint,items:items.length}));
            return items;
        }catch(e){
            last=e;
            console.info('Instagram proveedor fallido '+JSON.stringify({endpoint,reason:publicError(e).code}));
            if(!canTryAlternative(e))throw e;
        }
    }
    try{
        const items=await publicInstagram(input,end,fetcher);
        if(items.length){console.info('Instagram proveedor '+JSON.stringify({endpoint:'public_metadata',items:items.length}));return items;}
    }catch(e){
        console.info('Instagram proveedor fallido '+JSON.stringify({endpoint:'public_metadata',reason:publicError(e).code}));
        if(!canTryAlternative(e))throw e;
    }
    throw last;
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
    const args=[...commonArgs(),'--no-simulate','--max-filesize',String(limit),'--match-filter','!is_live & !is_upcoming & duration <=? 1800 & availability !=? private & availability !=? premium_only & availability !=? subscriber_only & availability !=? needs_auth','--print','after_move:filepath','-o',join(dir,'download.%(ext)s')];
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
    if(!Number.isFinite(actual)||Math.abs(actual-seconds)>Math.max(0.5,Math.min(1,seconds*0.01))||(kind==='audio'?a?.codec_name!=='mp3'||v:!v||v.codec_name!=='h264'||(audio&&a?.codec_name!=='aac')))throw new DownloadError('format','La conversión no conservó el contenido completo.');
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
        let sent=0,total=0,stage='resolve';
        try{
            const input=await expand(platform,initial,end,fetcher);
            stage='provider';
            if(platform==='instagram'&&kind==='video'&&input.photo)throw new DownloadError('input','Utiliza #post para publicaciones de Instagram.');
            let items;
            if(platform==='instagram'&&kind==='post'){
                items=await instagramMedia(input,end,fetcher);
            }else if(platform==='twitter'){
                items=twitterItems(await jsonAt('https://api.fxtwitter.com/status/'+input.id,'api.fxtwitter.com',end,fetcher));
            }else if(platform==='pinterest'){
                try{items=await pinterestMedia(input,end,fetcher);}
                catch(e){if(!canTryAlternative(e))throw e;items=[];}
                if(!items.length)items=undefined; // yt-dlp resolves video without a direct MP4
            }else if(platform==='tiktok'&&input.photo){
                const data=await photoTikTok(initial.short?initial:input,dir,end,runner);
                items=kind==='audio'?(data.music?[{kind:'audio',url:data.music}]:[]):data.items;
            }
            if(items===undefined){
                let result;
                try{result=await localVideo(input,kind==='audio'?'audio':'video',dir,limit,runner,end);}
                catch(e){
                    if(platform!=='instagram'||kind!=='video'||!canTryAlternative(e))throw e;
                    console.info('Instagram video proveedor local fallido '+JSON.stringify({reason:publicError(e).code}));
                    const alternative=await instagramMedia(input,end,fetcher);
                    if(alternative.length!==1||alternative[0].kind!=='video')throw notAvailable();
                    items=alternative;
                }
                if(result){
                    total=1;
                    try{await consume(result,0,1);}catch{throw new DownloadError('send','No se pudo enviar el archivo a WhatsApp.');}
                    sent=1;
                }
            }
            if(items!==undefined){
                stage='media';
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
            console.info('Red social etapa fallida '+JSON.stringify({platform,kind,stage,reason:e.code}));
            if(sent)throw new DownloadError(e.code,'Se enviaron '+sent+' de '+total+' archivos. '+e.message);
            throw e;
        }
    });
}
