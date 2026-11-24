import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,copyFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { withTemp,run } from '../core/process.js';
import { ytDlp,ffmpeg } from '../core/config.js';
import { commonArgs,downloadArgs,verifyDownload,withMusicDownload,getYoutubeInfo } from '../services/musicDownloader.js';

await withTemp(async dir=>{
    const video=join(dir,'fixture.mp4'),audio=join(dir,'fixture.mp3');
    await run(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=15','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',video]);
    await run(ffmpeg,['-v','error','-i',video,'-vn','-c:a','libmp3lame','-b:a','192k','-y',audio]);
    assert.equal((await verifyDownload(video,'video',1e7)).height,240);
    assert.ok((await verifyDownload(audio,'audio',1e7)).duration>=1.9);
    await assert.rejects(verifyDownload(video,'audio',1e7),{code:'format'});
    await assert.rejects(verifyDownload(audio,'audio',1),{code:'size'});
    const meta={title:'Synthetic fixture',uploader:'Untrue CI',duration:2,webpage_url:'https://www.youtube.com/watch?v=abcdefghijk'};
    let calls=0,path;
    const fake=async(bin,args,options)=>{
        if(bin!==ytDlp)return run(bin,args,options);
        calls++;assert.ok(!('COBALT_API_KEY' in options.env));assert.ok(args.includes('--ignore-config'));
        if(args.includes('--skip-download'))return {stdout:JSON.stringify(meta)};
        const out=args[args.indexOf('-o')+1];const isAudio=args.includes('--audio-format');
        path=out.replace('%(ext)s',isAudio?'mp3':'mp4');
        await copyFile(isAudio?audio:video,path);
        return {stdout:JSON.stringify(meta)};
    };
    for(const [platform,kind,query] of [['youtube','video','https://youtu.be/abcdefghijk'],['youtube','audio','fixture'],['soundcloud','audio','fixture']]){
        const before=calls;
        await withMusicDownload(platform,kind,query,async r=>{assert.equal(r.info.title,meta.title);assert.ok(r.bytes>0);await access(r.filePath);},{runner:fake});
        assert.equal(calls,before+1);await assert.rejects(access(path));
    }
    await assert.rejects(withMusicDownload('youtube','audio','fixture',async()=>{throw Error('send failed');},{runner:fake}),{code:'send'});
    await assert.rejects(access(path));
    assert.equal((await getYoutubeInfo('fixture',{runner:fake})).author,'Untrue CI');
    await assert.rejects(withMusicDownload('youtube','audio','fixture',async()=>assert.fail('must not send'),{runner:async()=>{throw Object.assign(new Error('process failed'),{diagnostic:'HTTP Error 429'});}}),{code:'remote_limit'});
    // Exercise actual yt-dlp, FFmpeg postprocessing and metadata template on an
    // operator-owned local fixture. Never access a commercial platform in CI.
    const payload=await readFile(video);
    const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':payload.length});res.end(req.method==='HEAD'?undefined:payload);});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
        const url='http://127.0.0.1:'+server.address().port+'/fixture.mp4';
        const actual=join(dir,'actual.%(ext)s');
        const args=[...commonArgs(),'--no-simulate','--max-filesize','10000000','-f','b','-x','--audio-format','mp3','--audio-quality','192K','--print','after_move:%(.{title,duration,webpage_url})j','-o',actual,'--',url];
        const {stdout}=await run(ytDlp,args,{timeout:30000,diagnostics:true});
        assert.equal(typeof JSON.parse(stdout.trim()).title,'string');
        assert.ok((await verifyDownload(join(dir,'actual.mp3'),'audio',1e7)).duration>=1.9);
    }finally{await new Promise(r=>server.close(r));}
    console.log('Music download policies, actual local yt-dlp, FFprobe and cleanup verified');
});
