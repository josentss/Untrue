import { DownloadError } from './downloadPolicy.js';
const invalid=()=>new DownloadError('input','Introduce un enlace público válido de la plataforma.');
const hosts={
    tiktok:['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'],
    instagram:['instagram.com','www.instagram.com','m.instagram.com'],
    facebook:['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch','fb.me','www.fb.me'],
    twitter:['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com','mobile.x.com'],
    pinterest:['pinterest.com','www.pinterest.com','pin.it','pinterest.es','www.pinterest.es','es.pinterest.com','uk.pinterest.com','fr.pinterest.com','de.pinterest.com','mx.pinterest.com','ca.pinterest.com','br.pinterest.com','pt.pinterest.com','it.pinterest.com','au.pinterest.com','pinterest.co.uk','www.pinterest.co.uk','pinterest.ca','www.pinterest.ca','pinterest.de','www.pinterest.de','pinterest.fr','www.pinterest.fr','pinterest.com.mx','www.pinterest.com.mx']
};
export function socialUrl(platform,value){
    if(typeof value==='string')value=value.trim().replace(/^[\u200B\u200E\u200F\u2060]+|[\u200B\u200E\u200F\u2060]+$/g,'').trim();
    if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f]/.test(value))throw invalid();
    let u;try{u=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);}catch{throw invalid();}
    if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts[platform]?.includes(u.hostname))throw invalid();
    const p=u.pathname;
    if(platform==='tiktok'){
        const short=['vm.tiktok.com','vt.tiktok.com'].includes(u.hostname)?/^\/[A-Za-z0-9]+\/?$/.test(p):/^\/t\/[A-Za-z0-9]+\/?$/.test(p);
        const post=/^\/@(?:[\w.-]|%[0-9A-Fa-f]{2})*\/(video|photo)\/(\d+)\/?$/.exec(p);
        const share=/^\/share\/(video|photo)\/(\d+)\/?$/.exec(p);
        const legacy=/^\/v\/(\d+)\.html$/.exec(p);
        if(!short&&!post&&!share&&!legacy)throw invalid();
        const target=post||share;
        return {url:share?'https://www.tiktok.com/@/'+share[1]+'/'+share[2]:legacy?'https://www.tiktok.com/@/video/'+legacy[1]:u.origin+p,short,photo:target?.[1]==='photo'};
    }
    if(platform==='instagram'){
        if(/^\/share\/(?:reel\/|p\/)?[A-Za-z0-9_-]+\/?$/.test(p))return {url:'https://www.instagram.com'+p,short:true};
        const match=/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?$/.exec(p);
        if(!match)throw invalid();
        const kind=match[1]==='reels'?'reel':match[1];
        return {url:'https://www.instagram.com/'+kind+'/'+match[2]+'/',photo:kind==='p'};
    }
    if(platform==='twitter'){
        const match=/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/.exec(p);
        if(!match)throw invalid();
        return {url:'https://x.com/i/web/status/'+match[1],id:match[1]};
    }
    if(platform==='pinterest'){
        if(u.hostname==='pin.it'&&/^\/[\w-]+\/?$/.test(p))return {url:u.origin+p,short:true};
        const m=/^\/pin\/(?:[\w-]+--)?(\d+)(?:\/sent)?\/?$/.exec(p);
        if(!m)throw invalid();
        return {url:'https://www.pinterest.com/pin/'+m[1]+'/',id:m[1]};
    }
    if(platform==='facebook'){
        if(['fb.watch','fb.me','www.fb.me'].includes(u.hostname)&&/^\/[\w-]+\/?$/.test(p))return {url:u.origin+p,short:true};
        if(/^\/share\/(?:v\/|r\/|p\/)?[\w-]+\/?$/.test(p))return {url:u.origin+p,short:true};
        if(/^\/watch\/?$/.test(p)||p==='/video.php'){
            const id=u.searchParams.get('v');if(!/^\d+$/.test(id||''))throw invalid();
            return {url:'https://www.facebook.com/watch/?v='+id};
        }
        if(/^\/(?:reel\/\d+|(?:[\w.]+\/)?videos\/(?:[\w-]+\/)?\d+|[\w.]+\/posts\/[\w-]+)\/?$/.test(p))return {url:'https://www.facebook.com'+p};
        throw invalid();
    }
    throw invalid();
}
const cdns={tiktok:['tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','tiktokv.com','tiktok.com','byteoversea.com','ibytedtos.com','byteimg.com','ibyteimg.com','muscdn.com'],instagram:['cdninstagram.com','fbcdn.net'],twitter:['pbs.twimg.com','video.twimg.com'],pinterest:['i.pinimg.com','v.pinimg.com','v1.pinimg.com']};
export function trustedUrl(value,domains){
    let u;try{u=new URL(value);}catch{throw invalid();}
    if(u.protocol!=='https:'||u.username||u.password||u.port||!domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw invalid();
    return u.href;
}
export const mediaUrl=(platform,value)=>trustedUrl(value,cdns[platform]||[]);
export function dedupeItems(items){
    const seen=new Set();
    return items.filter(item=>{if(!item?.url||seen.has(item.url))return false;seen.add(item.url);return true;});
}
export function instagramItems(data){
    if(![true,'true',200,1,'success'].includes(data?.status)||!Array.isArray(data.BK9))return [];
    return dedupeItems(data.BK9.filter(i=>i&&typeof i.url==='string').map(i=>({url:i.url,kind:i.type==='video'||/\.mp4(?:\?|$)/i.test(i.url||'')?'video':'image'})));
}
export function twitterItems(data){
    const tweet=data?.tweet||data?.status;
    if(data?.code!==200||!tweet||tweet.author?.protected===true)return [];
    const m=tweet.media||{};
    const items=Array.isArray(m.all)&&m.all.length?m.all:[...(m.photos||[]),...(m.videos||[])];
    return dedupeItems(items.flatMap(i=>{
        if(!i||typeof i!=='object')return [];
        if(i.type==='photo')return [{kind:'image',url:i.url}];
        if(!['video','gif'].includes(i.type))return [];
        const formats=Array.isArray(i.formats)?i.formats.filter(f=>f.container==='mp4'&&f.url).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0)):[];
        const url=formats.find(f=>f.codec==='h264')?.url||formats[0]?.url||i.url;
        return url?[{kind:'video',url}]:[];
    }));
}
export function selectItems(items,position,max=20){
    if(position!==undefined){
        if(!Number.isSafeInteger(position)||position<1||position>items.length)throw new DownloadError('input','La posición solicitada no existe en este carrusel.');
        return [items[position-1]];
    }
    if(items.length>max)throw new DownloadError('size','La publicación contiene más de '+max+' archivos. Selecciona una posición si el comando lo permite.');
    if(!items.length)throw new DownloadError('unavailable','No se encontraron archivos multimedia públicos.');
    return items;
}
