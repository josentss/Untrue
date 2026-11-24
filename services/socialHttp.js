import { createWriteStream } from 'node:fs';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unlink } from 'node:fs/promises';
import { DownloadError } from '../core/downloadPolicy.js';

export async function safeResponse(url,validate,{fetcher=fetch,signal=AbortSignal.timeout(15000),headers={}}={}){
    for(let i=0;i<5;i++){
        url=validate(url);
        const res=await fetcher(url,{signal,redirect:'manual',headers:{'User-Agent':'UntrueBot/2.0','Accept':'*/*',...headers}});
        if([301,302,303,307,308].includes(res.status)){
            const loc=res.headers.get('location');await res.body?.cancel();
            if(!loc)throw new DownloadError('unavailable','Redirección inválida.');
            url=new URL(loc,url).href;continue;
        }
        if(!res.ok){
            await res.body?.cancel();
            throw new DownloadError([401,403].includes(res.status)?'restricted':res.status===429?'remote_limit':'unavailable','El proveedor no permite acceder al contenido en este momento.');
        }
        return {res,url};
    }
    throw new DownloadError('unavailable','Demasiadas redirecciones.');
}
export async function readBounded(res,limit){
    if(!res.body)throw new DownloadError('unavailable','Respuesta vacía.');
    if(Number(res.headers.get('content-length'))>limit){await res.body.cancel();throw new DownloadError('size','Respuesta demasiado grande.');}
    const chunks=[];let size=0;
    for await(const chunk of Readable.fromWeb(res.body)){
        size+=chunk.length;if(size>limit)throw new DownloadError('size','Respuesta demasiado grande.');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export async function downloadSocialFile(url,path,validate,{limit,fetcher=fetch,signal=AbortSignal.timeout(30000)}={}){
    const {res}=await safeResponse(url,validate,{fetcher,signal});
    if(!res.body)throw new DownloadError('unavailable','Archivo vacío.');
    if(Number(res.headers.get('content-length'))>limit){await res.body.cancel();throw new DownloadError('size','Archivo demasiado grande.');}
    let bytes=0;
    try{
        await pipeline(Readable.fromWeb(res.body),new Transform({transform(chunk,_enc,cb){
            bytes+=chunk.length;
            cb(bytes>limit?new DownloadError('size','Archivo demasiado grande.'):null,chunk);
        }}),createWriteStream(path,{flags:'wx',mode:0o600}),{signal});
        if(!bytes)throw new DownloadError('unavailable','Archivo vacío.');
        return bytes;
    }catch(e){await unlink(path).catch(()=>{});throw e;}
}
