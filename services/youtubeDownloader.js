import { createWriteStream } from 'node:fs';
import { stat, unlink, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { platformUrl } from '../core/urls.js';
import { run } from '../core/process.js';
import { ytDlp, ffprobe, maxInputBytes } from '../core/config.js';

const api = process.env.COBALT_API_URL;
const apiKey = process.env.COBALT_API_KEY;
function duration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'N/A';
    const s = Math.floor(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
async function resolveInfo(args) {
    const q = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    if (!q || q.length > 2048) throw Error('Consulta inválida');
    const input = /^https?:/i.test(q) ? platformUrl(q, ['youtube.com','youtu.be']) : 'ytsearch1:' + q.slice(0,300);
    const { stdout } = await run(ytDlp, ['--ignore-config','--no-playlist','--socket-timeout','10','--retries','0','--skip-download','--dump-single-json','--',input], {timeout:25000,maxOutput:8*1024*1024});
    const json = JSON.parse(stdout);
    const info = json.entries?.[0] || json;
    return { url: platformUrl(info.webpage_url || info.original_url,['youtube.com','youtu.be']), title: info.title || 'YouTube', author: info.uploader || info.channel || 'Desconocido', duration: info.duration || 0, durationFormatted: duration(info.duration), description: info.description || '' };
}
async function resolveUrl(args) {
    const q = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    if (/^https?:/i.test(q)) return {url:platformUrl(q,['youtube.com','youtu.be']),title:'YouTube',author:'Desconocido',durationFormatted:'N/A'};
    return resolveInfo(q);
}
function trustedDownload(value, origin) {
    const u = new URL(value);
    if (u.username || u.password || u.protocol !== 'https:') throw Error('Destino de descarga no permitido');
    if (u.origin === origin) return u;
    const hosts = (process.env.COBALT_MEDIA_HOSTS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    if (u.port || !hosts.some(h=>u.hostname === h || u.hostname.endsWith('.'+h))) throw Error('Dominio de descarga no autorizado');
    return u;
}
async function request(body) {
    if (!api) throw Error('Proveedor no configurado');
    const url = new URL(api);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('Proveedor inválido');
    const headers = { Accept:'application/json','Content-Type':'application/json' };
    if (apiKey) headers.Authorization = 'Api-Key ' + apiKey;
    const res = await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error'});
    if (!res.ok) throw Error('Proveedor no disponible');
    const data = await res.json();
    if (!['tunnel','redirect'].includes(data.status) || typeof data.url !== 'string') throw Error('Proveedor no devolvió un archivo');
    return { ...data, origin:url.origin };
}
async function download(data,path) {
    let url = trustedDownload(data.url,data.origin);
    const signal = AbortSignal.timeout(90000);
    for (let i=0;i<4;i++) {
        const headers = url.origin === data.origin && apiKey ? {Authorization:'Api-Key '+apiKey} : {};
        const res = await fetch(url,{headers,signal,redirect:'manual'});
        if ([301,302,303,307,308].includes(res.status)) {
            await res.body?.cancel();
            url = trustedDownload(new URL(res.headers.get('location'),url).href,data.origin); continue;
        }
        if (!res.ok || !res.body || Number(res.headers.get('content-length')) > maxInputBytes) {
            await res.body?.cancel(); throw Error('Archivo no disponible o demasiado grande');
        }
        let bytes=0;
        const limit=new Transform({transform(chunk,_enc,cb){bytes+=chunk.length;cb(bytes>maxInputBytes?Error('Archivo demasiado grande'):null,chunk);}});
        await pipeline(Readable.fromWeb(res.body),limit,createWriteStream(path,{flags:'wx'}),{signal});
        if (!bytes) throw Error('Archivo vacío');
        return;
    }
    throw Error('Demasiadas redirecciones');
}
async function inspect(path, audio) {
    const {stdout}=await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path],{timeout:15000,maxOutput:1024*1024});
    const info=JSON.parse(stdout);
    const streams=info.streams || [];
    if (audio ? !streams.some(s=>s.codec_type==='audio' && s.codec_name==='mp3') : !streams.some(s=>s.codec_type==='video' && s.codec_name==='h264')) throw Error('Formato multimedia no compatible');
    if (!audio && !String(info.format?.format_name).includes('mp4')) throw Error('Contenedor no compatible');
    return Number(info.format?.duration);
}
async function getMedia(args,audio) {
    const info=await resolveUrl(args);
    const dir=await mkdtemp(join(tmpdir(),'untrue-yt-'));
    const filePath=join(dir,audio?'media.mp3':'media.mp4');
    try {
        const data=await request({url:info.url,downloadMode:audio?'audio':'auto',...(audio?{audioFormat:'mp3',audioBitrate:'128'}:{videoQuality:'480',youtubeVideoCodec:'h264',youtubeVideoContainer:'mp4'}),filenameStyle:'basic'});
        await download(data,filePath);
        const seconds=await inspect(filePath,audio);
        if (!(await stat(filePath)).size) throw Error('Archivo vacío');
        return {filePath,videoInfo:{...info,title:info.title==='YouTube'?(data.filename?.replace(/\.[^.]+$/,'')||info.title):info.title,duration:seconds,durationFormatted:duration(seconds)}};
    } catch(e) { await rm(dir,{recursive:true,force:true}); throw e; }
}
export const downloadYoutubeAudio = args => getMedia(args,true);
export const downloadYoutubeVideo = args => getMedia(args,false);
export const getYoutubeInfo = resolveInfo;
export const getYouTubeVideoInfo = resolveInfo;
export async function cleanUpFile(path) { if(path) await rm(dirname(path),{recursive:true,force:true}); }
