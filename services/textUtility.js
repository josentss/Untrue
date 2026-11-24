import {join} from 'node:path';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import sharp from 'sharp';
import {run} from '../core/process.js';
import {ffmpeg,ffprobe} from '../core/config.js';
import {childEnv} from './musicDownloader.js';
import {UtilityError,MAX_AUDIO_SECONDS,MAX_TEXT,cleanText} from '../core/utilityPolicy.js';
import {utilityJson} from './utilityHttp.js';
const BASE='https://api.assemblyai.com/v2';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function ocrImage(input,dir,{runner=run}={}){
    const path=join(dir,'ocr.png');
    const image=sharp(input,{limitInputPixels:32*1024*1024,failOn:'error'});
    const meta=await image.metadata();
    if(!['jpeg','png','webp','heif','avif','tiff'].includes(meta.format)||(meta.pages||1)>1)throw new UtilityError('Imagen no compatible para OCR.');
    await image.rotate().resize({width:2500,height:2500,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).grayscale().png().toFile(path);
    const {stdout}=await runner('tesseract',[path,'stdout','-l','spa+eng','--psm','3'],{timeout:30000,maxOutput:256*1024,env:{...childEnv(dir),OMP_THREAD_LIMIT:'2'},processGroup:true});
    return cleanText(stdout);
}
export async function speechAudio(input,dir,{runner=run}={}){
    const {stdout}=await runner(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',input],{timeout:10000,maxOutput:256*1024});
    const probe=JSON.parse(stdout),duration=Number(probe.format?.duration);
    if(!probe.streams?.some(s=>s.codec_type==='audio'))throw new UtilityError('El archivo no contiene audio.');
    if(!Number.isFinite(duration)||duration<=0||duration>MAX_AUDIO_SECONDS)throw new UtilityError('La transcripción admite audios de hasta 10 minutos.');
    const path=join(dir,'speech.mp3');
    await runner(ffmpeg,['-v','error','-xerror','-nostdin','-protocol_whitelist','file,pipe','-i',input,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','libmp3lame','-b:a','64k','-y',path],{timeout:45000,processGroup:true});
    const size=(await stat(path)).size;
    if(!size||size>8*1024*1024)throw new UtilityError('Audio no compatible para transcripción.');
    return path;
}
export async function transcribe(path,{key=process.env.ASSEMBLYAI_KEY,language='auto',fetcher=fetch,sleep=wait,timeout=120000}={}){
    if(!key)throw new UtilityError('La transcripción de audio no está configurada.');
    const signal=AbortSignal.timeout(timeout),headers={Authorization:key};
    const json=(suffix,options={})=>utilityJson(BASE+suffix,{fetcher,signal,headers,...options});
    let id;
    try{
        const upload=await json('/upload',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:createReadStream(path),timeout:30000});
        let url;try{url=new URL(upload.upload_url);}catch{throw new UtilityError('El servicio no devolvió un audio válido.');}
        if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='assemblyai.com'||url.hostname.endsWith('.assemblyai.com')))throw new UtilityError('El servicio devolvió una ubicación no compatible.');
        const job=await json('/transcript',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({audio_url:url.href,speech_models:['universal-2'],...(language==='auto'?{language_detection:true}:{language_code:language}),punctuate:true,format_text:true})});
        if(typeof job.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(job.id))throw new UtilityError('El servicio no devolvió una transcripción válida.');
        id=job.id;
        for(let i=0;i<40;i++){
            if(signal.aborted)break;
            const status=await json('/transcript/'+id);
            if(status.status==='completed')return cleanText(status.text);
            if(status.status==='error')throw new UtilityError('El servicio no pudo transcribir el audio.');
            if(!['queued','processing'].includes(status.status))throw new UtilityError('Estado de transcripción no reconocido.');
            await sleep(3000);
        }
        throw new UtilityError('Tiempo de transcripción agotado.');
    }finally{
        if(id)try{await utilityJson(BASE+'/transcript/'+id,{fetcher,method:'DELETE',headers,timeout:8000});}catch{console.warn('Transcripción: limpieza remota no confirmada');}
    }
}
