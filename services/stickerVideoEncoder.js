import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {childEnv} from './musicDownloader.js';
import {ffmpeg} from '../core/config.js';
// No shell, no raw-video files, no inherited API keys. Exit 3 is an expected
// size rejection from the bounded native encoder, not a damaged animation.
export async function encodeIndependentVideo({args,fps,quality,durationMs,output,dir,timeout,encoder=process.env.STICKER_WEBP_ENCODER||'untrue-sticker-webp'}){
    const env=childEnv(dir);
    const decoder=spawn(ffmpeg,args,{shell:false,env,stdio:['ignore','pipe','ignore']});
    const writer=spawn(encoder,[String(fps),String(quality),String(durationMs),output],{shell:false,env,stdio:['pipe','ignore','ignore']});
    let timedOut=false,failed=false,transferFailed=false;
    const stop=child=>{try{child.kill('SIGKILL');}catch{}};
    const both=()=>{stop(decoder);stop(writer);};
    const watch=child=>new Promise(resolve=>{
        child.once('error',()=>{failed=true;both();});
        child.once('close',code=>resolve(code));
    });
    const d=watch(decoder),w=watch(writer);
    const timer=setTimeout(()=>{timedOut=true;both();},timeout);
    try{
        const transfer=pipeline(decoder.stdout,writer.stdin).catch(()=>{transferFailed=true;stop(decoder);});
        const [decode,encode]=await Promise.all([d,w,transfer]);
        if(timedOut)throw Error('Tiempo de procesamiento agotado');
        if(failed)throw Error('Codificador no disponible');
        if(encode===3)return false;
        if(decode!==0||encode!==0||transferFailed)throw Error('No se pudo codificar el video completo');
        return true;
    }finally{clearTimeout(timer);both();}
}
