import { join } from 'node:path';
import { galleryFiles } from './galleryDownloader.js';
import { stat,rename,unlink,readdir,rm } from 'node:fs/promises';
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
        try{socialUrl(platform,next.href);}catch{
            // Do not follow an unrecognized or foreign destination, including a login page.
            const known=next.protocol==='https:'&&(platform==='tiktok'?['www.tiktok.com','m.tiktok.com','tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(next.hostname):platform==='pinterest'?next.hostname==='pin.it'||next.hostname.endsWith('.pinterest.com')||next.hostname==='pinterest.com':['www.instagram.com','instagram.com'].includes(next.hostname));
            console.info('Enlace compartido destino no reconocido '+JSON.stringify({platform,samePlatform:known,pathKind:next.pathname.includes('/photo/')?'photo':next.pathname.includes('/pin/')?'pin':next.pathname.includes('/login')?'login':'other'}));
            throw new DownloadError(next.pathname.includes('/login')?'restricted':'unavailable','No se pudo resolver el enlace compartido. Prueba con el enlace completo de la publicación.');
        }
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
// A video pin may store its renditions in a story block rather than videos.
export function pinDataItems(pin){
    if(!pin||typeof pin!=='object')return {items:[],video:false,confirmedImage:false};
    const lists=[pin.videos?.video_list];
    const blocks=(Array.isArray(pin.story_pin_data?.pages)?pin.story_pin_data.pages:[]).flatMap(page=>Array.isArray(page?.blocks)?page.blocks:[]);
    for(const block of blocks)lists.push(block?.video?.video_list);
    const variants=lists.flatMap(list=>Object.values(list||{})).filter(v=>v&&typeof v==='object').sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));
    const direct=variants.map(v=>validPinMedia(v.url,'video')).find(Boolean);
    const video=Boolean(direct||Object.keys(pin.videos||{}).length||blocks.some(b=>b?.video)||pin.is_video===true||pin.is_video_pin===true||pin.embed?.src||/video/i.test(String(pin.media_type||pin.pin_type||'')));
    if(video)return {items:direct?[direct]:[],video:true,confirmedImage:false};
    if(pin.story_pin_data)return {items:[],video:false,confirmedImage:false}; // unsupported multi-block story, never its cover
    for(const key of ['orig','original','origin','736x','564x']){
        const item=validPinMedia(pin.images?.[key]?.url,'image');
        if(item)return {items:[item],video:false,confirmedImage:true};
    }
    return {items:[],video:false,confirmedImage:false};
}
export function pinterestPage(html,pinId){
    const $=load(html);
    let pin;
    if(pinId)for(const el of $('script#__PWS_DATA__,script#__PWS_INITIAL_PROPS__,script[type="application/json"]').toArray()){
        try{
            const root=JSON.parse($(el).text()),stack=[root];let scanned=0;
            while(stack.length&&scanned++<50000){
                const obj=stack.pop();
                if(!obj||typeof obj!=='object')continue;
                if(String(obj.id)===String(pinId)&&(obj.images||obj.videos||obj.story_pin_data)){pin=obj;break;}
                for(const value of Object.values(obj))if(value&&typeof value==='object')stack.push(value);
            }
        }catch{}
        if(pin)break;
    }
    const structured=pinDataItems(pin);
    if(structured.video)return structured;
    const video=$('meta[property="og:video:secure_url"]').attr('content')||$('meta[property="og:video"]').attr('content');
    if(video||$('meta[property="og:type"]').attr('content')?.startsWith('video')){
        const item=validPinMedia(video,'video');
        return {items:item?[item]:[],video:true,confirmedImage:false};
    }
    if(structured.confirmedImage)return structured;
    if(pin?.story_pin_data)return structured;
    const image=$('meta[property="og:image:secure_url"]').attr('content')||$('meta[property="og:image"]').attr('content');
    const item=validPinMedia(image,'image');
    return {items:item?[item]:[],video:false,confirmedImage:Boolean(item&&/^(?:image|photo)$/i.test($('meta[property="og:type"]').attr('content')||''))};
}
export function pinterestItems(html,pinId){return pinterestPage(html,pinId).items;}
async function pinterestMedia(input,end,fetcher){
    // Same anonymous, single-pin resource used by yt-dlp. Exact ID, no cookies.
    const api='https://www.pinterest.com/resource/PinResource/get/?data='+encodeURIComponent(JSON.stringify({options:{field_set_key:'unauth_react_main_pin',id:input.id}}));
    try{
        const {res}=await safeResponse(api,v=>{
            const u=new URL(trustedUrl(v,['www.pinterest.com']));
            if(u.hostname!=='www.pinterest.com'||u.pathname!=='/resource/PinResource/get/')throw notAvailable();
            return u.href;
        },{fetcher,signal:AbortSignal.timeout(remaining(end,12000)),headers:{Accept:'application/json','X-Pinterest-PWS-Handler':'www/[username].js'}});
        const pin=JSON.parse(await readBounded(res,4*1024*1024))?.resource_response?.data;
        if(String(pin?.id)===input.id){
            const result=pinDataItems(pin);
            if(result.video||result.confirmedImage){console.info('Pinterest tipo '+JSON.stringify({source:'resource',video:result.video,confirmedImage:result.confirmedImage}));return result;}
        }
    }catch(e){if(!canTryAlternative(e))throw e;}
    const {res}=await safeResponse(input.url,v=>socialUrl('pinterest',v).url,{fetcher,signal:AbortSignal.timeout(remaining(end,15000)),headers:{Accept:'text/html'}});
    const result=pinterestPage(await readBounded(res,4*1024*1024),input.id);
    console.info('Pinterest tipo '+JSON.stringify({source:'page',video:result.video,confirmedImage:result.confirmedImage}));
    return result;
}
function canTryAlternative(error){return ['unavailable','timeout','failed'].includes(publicError(error).code);}
// Public, structured page data only. Never infer a carousel from its poster.
export function instagramPublicItems(html,shortcode){
    const $=load(html);
    let post;
    for(const el of $('script').toArray()){
        try{
            const raw=$(el).text().trim();
            let json;
            if($(el).attr('type')==='application/json')json=JSON.parse(raw);
            else{
                // Parse a literal JSON argument; never execute page JavaScript.
                const m=/^window\.__additionalDataLoaded\(\s*(?:"[^"]*"|'[^']*')\s*,\s*(\{[\s\S]*\})\s*\)\s*;?$/.exec(raw);
                if(!m)continue;
                json=JSON.parse(m[1]);
            }
            const stack=[json];let scanned=0;
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
async function instagramEmbed(input,end,fetcher){
    const url=input.url+'embed/';
    const {res}=await safeResponse(url,v=>{
        const u=new URL(v);
        if(u.origin!=='https://www.instagram.com'||u.username||u.password||u.pathname!==new URL(url).pathname)throw new DownloadError(u.pathname.includes('/login')?'restricted':'unavailable','La publicación no está disponible para incrustación pública.');
        return u.href;
    },{fetcher,signal:AbortSignal.timeout(remaining(end,10000)),headers:{Accept:'text/html'}});
    return instagramPublicItems(await readBounded(res,4*1024*1024),new URL(input.url).pathname.split('/')[2]);
}
async function instagramMedia(input,end,fetcher,{post=false}={}){
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
    if(post){
        try{
            const items=await instagramEmbed(input,end,fetcher);
            if(items.length){console.info('Instagram proveedor '+JSON.stringify({endpoint:'public_embed',items:items.length}));return items;}
        }catch(e){
            console.info('Instagram proveedor fallido '+JSON.stringify({endpoint:'public_embed',reason:publicError(e).code}));
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
    if(post)throw new DownloadError('unavailable','Instagram no devolvió los archivos de la publicación. El proveedor puede estar temporalmente caído.');
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
export async function normalizeSocialFile(path,kind,dir,{limit,runner=run,end=Date.now()+deadlineMs,index=0,remux=false}){
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
        if(!remux&&compatible&&String(info.format?.format_name).split(',').includes('mp4'))await rename(path,out);
        else await runner(ffmpeg,['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',path,'-map','0:'+video.index,'-map','0:a:0?',...(compatible?['-c:v','copy']:['-vf','scale=w=min(1280\\,iw):h=min(1280\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','20','-threads','2']),'-c:a',compatible&&audio?.codec_name==='aac'?'copy':'aac','-movflags','+faststart','-fs',String(limit),out],{timeout:remaining(end,60000),processGroup:true});
    }
    const bytes=await checkedSize(out,limit),verified=await probe(out,runner,end);
    const v=verified.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),a=verified.streams?.find(s=>s.codec_type==='audio');
    const actual=Number(verified.format?.duration);
    if(!Number.isFinite(actual)||Math.abs(actual-seconds)>Math.max(0.5,Math.min(1,seconds*0.01))||(kind==='audio'?a?.codec_name!=='mp3'||v:!v||v.codec_name!=='h264'||(audio&&a?.codec_name!=='aac')))throw new DownloadError('format','La conversión no conservó el contenido completo.');
    if(remux&&kind==='video'){
        // Decode the complete remuxed video, not only its container metadata.
        await runner(ffmpeg,['-v','error','-xerror','-nostdin','-protocol_whitelist','file,pipe','-i',out,'-map','0:v:0','-map','0:a:0?','-f','null','-'],{timeout:remaining(end,30000),processGroup:true});
    }
    return {kind,path:out,mime:kind==='audio'?'audio/mpeg':'video/mp4',bytes,...(remux&&kind==='video'?{seconds:Math.ceil(actual)}:{})};
}
async function localVideo(input,kind,dir,limit,runner,end,remux=false){
    const args=socialVideoArgs(input.url,dir,kind,limit);
    const {stdout}=await boundedRun(args,dir,limit,(bin,a,opts)=>runner(bin,a,{...opts,timeout:remaining(end,90000)}));
    const lines=stdout.trim().split('\n').filter(Boolean);
    if(lines.length!==1)throw notAvailable();
    const path=lines[0];
    // Accept only the output filename generated by our template, never arbitrary paths.
    if(!/^download\.[a-z0-9]{1,8}$/i.test(path.slice(dir.length+1))||!path.startsWith(dir+'/')&&!path.startsWith(dir+'\\'))throw notAvailable();
    return normalizeSocialFile(path,kind,dir,{limit,runner,end,remux});
}
export async function withSocialDownload(platform,query,{kind='video',position}={},consume,{runner=run,fetcher=fetch,limit=maxInputBytes,gallery=true}={}){
    const initial=socialUrl(platform,query);
    return withTemp(async dir=>{
        const end=Date.now()+deadlineMs,start=Date.now();
        let sent=0,total=0,stage='resolve';
        try{
            let input;
            try{input=await expand(platform,initial,end,fetcher);}
            catch(e){
                // gallery-dl has its own pin.it resolver and photo-only TikTok extractor.
                if(!gallery||!initial.short||!['pinterest','tiktok'].includes(platform)||!canTryAlternative(e))throw e;
                input=initial;
            }
            stage='provider';
            if(platform==='instagram'&&kind==='video'&&input.photo)throw new DownloadError('input','Utiliza #post para publicaciones de Instagram.');
            let items;
            const useGallery=gallery&&(platform==='pinterest'||platform==='instagram'&&kind==='post'||platform==='tiktok'&&(input.photo||input.short));
            if(useGallery){
                let prepared;
                try{
                    const raw=await galleryFiles(platform,input.short?initial.url:input.url,join(dir,'gallery'),kind,{runner,limit,timeout:remaining(end,45000)});
                    const chosen=selectItems(raw,position,MAX_ITEMS);
                    prepared=[];let bytes=0;
                    for(const [index,item] of chosen.entries()){
                        const checked=await normalizeSocialFile(item.path,item.kind,dir,{limit:limit-bytes,runner,end,index,remux:platform==='pinterest'});
                        bytes+=checked.bytes;prepared.push(checked);
                    }
                }catch(e){
                    const reason=publicError(e).code;
                    console.info('Galería proveedor fallido '+JSON.stringify({platform,provider:'gallery-dl',reason}));
                    // Remove every intermediate output before trying the next provider.
                    for(const name of await readdir(dir))await rm(join(dir,name),{recursive:true,force:true});
                    if(!canTryAlternative(e)&&reason!=='format')throw e;
                    if(input.short)throw e; // do not pass an unresolved short URL to unrelated extractors
                    prepared=undefined;
                }
                if(prepared){
                    total=prepared.length;
                    for(const [index,item] of prepared.entries()){
                        stage='send';
                        try{await consume(item,index,total);}catch{throw new DownloadError('send','No se pudo enviar el archivo a WhatsApp.');}
                        sent++;
                    }
                    console.info('Red social descarga completada '+JSON.stringify({platform,kind,provider:'gallery-dl',items:sent,ms:Date.now()-start}));
                    return {sent,total};
                }
                console.info('Galería proveedor alternativo '+JSON.stringify({platform}));
            }
            if(platform==='instagram'&&kind==='post'){
                items=await instagramMedia(input,end,fetcher,{post:true});
            }else if(platform==='twitter'){
                items=twitterItems(await jsonAt('https://api.fxtwitter.com/status/'+input.id,'api.fxtwitter.com',end,fetcher));
            }else if(platform==='pinterest'){
                let pin;
                try{pin=await pinterestMedia(input,end,fetcher);}
                catch(e){if(!canTryAlternative(e))throw e;}
                if(pin?.video&&pin.items.length||pin?.confirmedImage)items=pin.items;
                // Ambiguous OpenGraph image is not enough: try the video extractor first.
            }else if(platform==='tiktok'&&input.photo){
                const data=await photoTikTok(initial.short?initial:input,dir,end,runner);
                items=kind==='audio'?(data.music?[{kind:'audio',url:data.music}]:[]):data.items;
            }
            if(items===undefined){
                let result;
                try{result=await localVideo(input,kind==='audio'?'audio':'video',dir,limit,runner,end,platform==='pinterest');}
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
                const checked=chosen.map(item=>{
                    try{return {...item,url:mediaUrl(platform,item.url)};}
                    catch{
                        console.info('Red social CDN no reconocido '+JSON.stringify({platform,kind:item.kind}));
                        throw new DownloadError('unavailable','El proveedor devolvió un archivo desde un servidor no compatible.');
                    }
                });
                for(const [index,item] of checked.entries()){
                    const source=join(dir,'source-'+index);
                    const left=limit-bytes;
                    if(left<=0)throw new DownloadError('size','El carrusel supera el límite total de tamaño.');
                    await downloadSocialFile(item.url,source,v=>mediaUrl(platform,v),{limit:left,fetcher,signal:AbortSignal.timeout(remaining(end))});
                    const result=await normalizeSocialFile(source,item.kind,dir,{limit:left,runner,end,index,remux:platform==='pinterest'});
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
