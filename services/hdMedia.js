import {join} from 'node:path';
import {stat} from 'node:fs/promises';
import sharp from 'sharp';
import {run} from '../core/process.js';
import {ffmpeg,ffprobe} from '../core/config.js';
import {childEnv} from './musicDownloader.js';
import {HDMediaError,HD_LIMITS,videoLimits,validVideoDimensions} from '../core/hdPolicy.js';

const imageTypes={jpeg:['jpg','image/jpeg'],png:['png','image/png'],webp:['webp','image/webp'],heif:['heif','image/heif'],avif:['avif','image/avif']};
const formatError=()=>new HDMediaError('El archivo multimedia no tiene un formato compatible.');
async function bytes(path,limit){
    const st=await stat(path);
    if(!st.isFile()||!st.size||st.size>limit)throw new HDMediaError('El archivo está vacío o supera el límite de tamaño.');
    return st.size;
}
function result(path,kind,mime,ext,extra={}){
    return {path,kind,mime,fileName:'multimedia.'+ext,...extra};
}
async function inspect(path,dir,runner){
    const {stdout}=await runner(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path],{timeout:12000,maxOutput:256*1024,env:childEnv(dir),processGroup:true});
    const data=JSON.parse(stdout),streams=data.streams||[],video=streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),audio=streams.find(s=>s.codec_type==='audio');
    const seconds=Number(data.format?.duration),[num,den]=String(video?.avg_frame_rate||'').split('/').map(Number),fps=num/den;
    if(!video||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||video.width<1||video.height<1||video.width*video.height>3840*2160||!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(fps)||fps<=0||fps>120)throw formatError();
    const rotation=Number(video.side_data_list?.find(x=>typeof x.rotation!=='undefined')?.rotation??video.tags?.rotate??0);
    if(!Number.isFinite(rotation)||rotation%90!==0)throw formatError();
    return {video,audio,seconds,fps,rotation,mp4:String(data.format?.format_name).split(',').includes('mp4'),streams};
}
export async function prepareHD(input,kind,dir,{mode='native',status=false,limit=100*1024*1024,runner=run}={}){
    if(!['native','original'].includes(mode)||status&&mode==='original')throw formatError();
    await bytes(input,limit);
    if(kind==='image'){
        const image=sharp(input,{limitInputPixels:HD_LIMITS.imagePixels,failOn:'error'});
        const meta=await image.metadata();
        const type=imageTypes[meta.format];
        if(!type||!meta.width||!meta.height||(meta.pages||1)!==1)throw formatError();
        if(mode==='original'){
            // No resize or re-encode, but decode once to reject malformed images.
            await image.stats();return result(input,'document',type[1],type[0]);
        }
        const edge=status?HD_LIMITS.statusEdge:HD_LIMITS.imageEdge;
        const cap=Math.min(limit,status?HD_LIMITS.statusBytes:HD_LIMITS.imageBytes);
        if(meta.format==='jpeg'&&(!meta.orientation||meta.orientation===1)&&Math.max(meta.width,meta.height)<=edge&&!status){
            const size=await bytes(input,limit);
            if(size<=cap){await image.stats();return result(input,'image','image/jpeg','jpg',{width:meta.width,height:meta.height});}
        }
        const out=join(dir,'hd.jpg');
        const info=await image.rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:status?90:94,chromaSubsampling:'4:4:4'}).toFile(out);
        await bytes(out,cap);
        return result(out,'image','image/jpeg','jpg',{width:info.width,height:info.height});
    }
    if(kind!=='video')throw formatError();
    const data=await inspect(input,dir,runner);
    if(mode==='original'){
        if(!data.mp4||data.seconds>1800)throw new HDMediaError('El modo archivo admite videos MP4 de hasta 30 minutos.');
        return result(input,'document','video/mp4','mp4');
    }
    const limits=videoLimits(status),cap=Math.min(limit,limits.bytes);
    if(data.seconds>limits.seconds)throw new HDMediaError('Máximo '+limits.seconds+' segundos de video. No se recorta automáticamente.');
    const v=data.video,a=data.audio;
    const compatible=data.rotation%360===0&&data.mp4&&v.codec_name==='h264'&&v.pix_fmt==='yuv420p'&&validVideoDimensions(v.width,v.height,limits)&&data.fps<=limits.fps+.01&&(!a||a.codec_name==='aac');
    const out=join(dir,'hd.mp4');
    const portrait=Math.abs(data.rotation%180)===90?v.width>v.height:v.height>v.width;
    const w=portrait?limits.short:limits.long,h=portrait?limits.long:limits.short;
    const scale='scale=w=min(iw\\,'+w+'):h=min(ih\\,'+h+'):force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p';
    const filters=scale+(data.fps>limits.fps?',fps='+limits.fps:'');
    const args=['-v','error','-xerror','-nostdin','-protocol_whitelist','file,pipe','-i',input,'-map','0:'+v.index,'-map','0:a:0?','-map_metadata','-1','-map_chapters','-1',...(compatible?['-c:v','copy']:['-vf',filters,'-c:v','libx264','-preset','veryfast','-crf','19','-threads','2']),'-c:a',a?.codec_name==='aac'?'copy':'aac','-movflags','+faststart','-fs',String(cap),'-y',out];
    await runner(ffmpeg,args,{timeout:60000,maxOutput:256*1024,env:childEnv(dir),processGroup:true});
    await bytes(out,cap);
    const checked=await inspect(out,dir,runner);
    if(!checked.mp4||checked.video.codec_name!=='h264'||checked.video.pix_fmt!=='yuv420p'||!validVideoDimensions(checked.video.width,checked.video.height,limits)||checked.fps>limits.fps+.05||Boolean(checked.audio)!==Boolean(a)||(a&&checked.audio.codec_name!=='aac')||Math.abs(checked.seconds-data.seconds)>Math.max(.25,Math.min(.5,data.seconds*.02)))throw new HDMediaError('No se pudo conservar el video completo dentro de los límites.');
    return result(out,'video','video/mp4','mp4',{width:checked.video.width,height:checked.video.height,seconds:Math.ceil(checked.seconds)});
}
export function mediaContent(file){
    if(file.kind==='document')return {document:{url:file.path},fileName:file.fileName,mimetype:file.mime};
    return {[file.kind]:{url:file.path},mimetype:file.mime,width:file.width,height:file.height,...(file.kind==='video'?{seconds:file.seconds}:{})};
}
