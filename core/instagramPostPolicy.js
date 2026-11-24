import {DownloadError,publicError} from './downloadPolicy.js';
import {socialUrl,mediaUrl} from './socialPolicy.js';
export function retryAfterMs(value,now=Date.now()){
    if(value==null||String(value).trim()==='')return 0;
    const s=String(value).trim();
    if(/^\d+$/.test(s)){
        const n=Number(s)*1000;
        return Number.isSafeInteger(n)?n:0;
    }
    const date=Date.parse(s);
    return Number.isFinite(date)?Math.max(0,date-now):0;
}
export function rateError(ms=0,provider='instagram'){
    return Object.assign(new DownloadError('remote_limit','Instagram está limitando las solicitudes. Intenta más tarde.'),{retryAfterMs:ms,provider});
}
export function createPostGate({now=Date.now,defaultMs=15*60*1000}={}){
    let until=0;
    return {
        check(){
            const left=until-now();
            if(left>0)throw rateError(left);
        },
        observe(error){
            if(error?.code==='remote_limit'){
                const delay=Math.max(defaultMs,Number(error.retryAfterMs)||0);
                until=Math.max(until,now()+delay);
            }
        }
    };
}
export const postGate=createPostGate();
export function postError(error){
    if(error instanceof DownloadError)return error;
    const diagnostic=String(error?.diagnostic||error?.message||'');
    const marker=/UNTRUE_INSTAGRAM_HTTP_429(?:\s+retry_after_ms=(\d+))?/.exec(diagnostic);
    if(marker)return rateError(Number(marker[1])||0,'gallery-dl');
    if(/(?:HTTP(?: Error)?\s*[:(]?\s*429\b|429\s+Too Many Requests|too many requests|rate.limit)/i.test(diagnostic))return rateError(0,'gallery-dl');
    if(/UNTRUE_RATE_LIMIT/.test(diagnostic))return rateError(0,'gallery-dl');
    if(/UNTRUE_ACCESS_RESTRICTED|UNTRUE_INSTAGRAM_HTTP_(?:401|403)|HTTP(?: Error)?\s*[:(]?\s*(?:401|403)\b|authentication|authorization|login required|log in|private|captcha|cookies (?:are )?required/i.test(diagnostic))return new DownloadError('restricted','Instagram restringe el acceso a esta publicación.');
    return publicError(error);
}
const unavailable=()=>new DownloadError('unavailable','El proveedor no devolvió la publicación completa.');
export function apiDirectItems(payload,expected){
    const post=payload?.post;
    if(!post||post.is_private===true||post.author_is_private===true) {
        if(post?.is_private===true||post?.author_is_private===true)throw new DownloadError('restricted','La publicación no es pública.');
        throw unavailable();
    }
    let actual;try{actual=socialUrl('instagram',post.url).url;}catch{throw unavailable();}
    if(new URL(actual).pathname.split('/')[2]!==new URL(expected).pathname.split('/')[2])throw unavailable();
    const count=post.carousel_media_count;
    if(!Number.isSafeInteger(count)||count<0)throw unavailable();
    if(count>20)throw new DownloadError('size','La publicación supera los 20 archivos.');
    const carousel=post.media_type==='carousel_container'||count>0;
    const rows=carousel?post.carousel_media:[{is_video:post.is_video,image_url:post.thumbnail_url,video_url:post.video_url}];
    if(!Array.isArray(rows)||!rows.length||(carousel&&rows.length!==count))throw unavailable();
    const urls=new Set();
    return rows.map(row=>{
        if(typeof row?.is_video!=='boolean')throw unavailable();
        const kind=row.is_video?'video':'image';
        const raw=row.is_video?row.video_url:row.image_url;
        if(typeof raw!=='string'||!raw)throw unavailable();
        let url;try{url=mediaUrl('instagram',raw);}catch{throw unavailable();}
        if(urls.has(url))throw unavailable();
        urls.add(url);
        return {kind,url};
    });
}
export function fallbackPost(error){return ['unavailable','timeout','failed','format'].includes(postError(error).code);}
