import { downloadContentFromMessage } from 'baileys';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { maxInputBytes } from '../core/config.js';
import { MediaError } from '../core/mediaTarget.js';

export async function saveBoundedStream(stream, path, {limit,signal}){
    let bytes=0;
    const meter=new Transform({transform(chunk,_encoding,cb){
        bytes+=chunk.length;
        if(bytes>limit) return cb(new MediaError('Archivo demasiado grande.'));
        cb(null,chunk);
    }});
    await pipeline(stream,meter,createWriteStream(path,{flags:'wx',mode:0o600}),{signal});
    if(!bytes) throw new MediaError('Archivo vacío.');
}
export async function downloadToFile(target,path,{limit=maxInputBytes,timeout=30000,download=downloadContentFromMessage}={}){
    const length=Number(target.media.fileLength || 0);
    if (length>limit) throw new MediaError('Archivo demasiado grande.');
    const signal=AbortSignal.timeout(timeout);
    const stream=await download(target.media,target.type,{options:{signal}});
    await saveBoundedStream(stream,path,{limit,signal});
}
