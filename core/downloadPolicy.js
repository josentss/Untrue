export class DownloadError extends Error {
    constructor(code,message){super(message);this.name='DownloadError';this.code=code;}
}
const invalid=()=>new DownloadError('input','Introduce un enlace válido o una búsqueda.');
export function mediaInput(platform,value){
    const q=String(value||'').trim();
    if(!q||q.length>2048||/[\x00-\x1f\x7f]/.test(q)) throw invalid();
    const isLink=/^[a-z][a-z0-9+.-]*:/i.test(q)||/^(?:www\.|(?:m\.|music\.)?youtube\.com\/|youtu\.be\/|soundcloud\.com\/|on\.soundcloud\.com\/)/i.test(q);
    if(!isLink){
        if(q.length>300||q.startsWith('-')) throw invalid();
        return (platform==='youtube'?'ytsearch1:':'scsearch1:')+q;
    }
    let u;
    try{u=new URL(/^https?:/i.test(q)?q:'https://'+q);}catch{throw invalid();}
    if(u.protocol!=='https:'||u.username||u.password||u.port) throw invalid();
    if(platform==='youtube'){
        let id;
        if(u.hostname==='youtu.be') id=/^\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
        else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(u.hostname)){
            id=u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
        }
        if(!/^[A-Za-z0-9_-]{11}$/.test(id||'')) throw invalid();
        return 'https://www.youtube.com/watch?v='+id;
    }
    if(platform!=='soundcloud') throw invalid();
    if(u.hostname==='on.soundcloud.com'&&/^\/[A-Za-z0-9]+\/?$/.test(u.pathname)) return 'https://on.soundcloud.com'+u.pathname;
    if(!['soundcloud.com','www.soundcloud.com','m.soundcloud.com'].includes(u.hostname)||!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) throw invalid();
    const [user,track]=u.pathname.split('/').filter(Boolean);
    if(['discover','search','you','stream','charts','stations','pages','settings'].includes(user)||['sets','likes','tracks','albums','reposts','popular-tracks'].includes(track)) throw invalid();
    return 'https://soundcloud.com/'+user+'/'+track;
}
export const maxDuration={audio:3600,video:1800};
export const videoFormat='bv[ext=mp4][vcodec^=avc1][height<=720]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][vcodec^=avc1][acodec^=mp4a][height<=720]';
export function durationText(seconds){
    if(!Number.isFinite(seconds)||seconds<0)return 'N/D';
    const s=Math.floor(seconds),h=Math.floor(s/3600),m=Math.floor(s/60)%60;
    return h?h+':'+String(m).padStart(2,'0')+':'+String(s%60).padStart(2,'0'):m+':'+String(s%60).padStart(2,'0');
}
export function publicError(error){
    if(error instanceof DownloadError)return error;
    const s=String(error?.diagnostic||error?.message||'');
    if(/sign in|log.?in|not a bot|captcha|age.restrict|private video|members.only|premium|geo.restrict|DRM|not available in your country|subscription/i.test(s))return new DownloadError('restricted','La plataforma restringe el acceso a este contenido.');
    if(/HTTP Error (?:403|429)|too many requests|rate.limit/i.test(s))return new DownloadError('remote_limit','La plataforma está limitando las descargas desde el servidor. Intenta más tarde.');
    if(/timeout|timed out|agotado/i.test(s))return new DownloadError('timeout','La descarga superó el tiempo disponible. Intenta con un contenido más corto.');
    if(/too large|max.filesize|larger than|disk budget/i.test(s))return new DownloadError('size','El archivo supera el límite de tamaño.');
    if(/not available|unavailable|no video|no results|no matches|requested format/i.test(s))return new DownloadError('unavailable','No se encontró contenido disponible en un formato compatible.');
    return new DownloadError('failed','No se pudo completar la descarga. Comprueba el enlace e inténtalo nuevamente.');
}
