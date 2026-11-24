import assert from 'node:assert/strict';
import sharp from 'sharp';
import {join} from 'node:path';
import {readFile,copyFile,access} from 'node:fs/promises';
import {withTemp,run} from '../core/process.js';
import {ffmpeg,ytDlp} from '../core/config.js';
import {withSocialDownload,pinterestItems,normalizeSocialFile} from '../services/socialDownloader.js';
await withTemp(async dir=>{
    const image=join(dir,'fixture.png'),video=join(dir,'fixture.mp4');
    await sharp({create:{width:120,height:100,channels:3,background:'red'}}).png().toFile(image);
    await run(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=160x120:rate=15','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-threads','2','-y',video]);
    const picture=await readFile(image),movie=await readFile(video);
    const a='https://x.cdninstagram.com/a.png',b='https://x.fbcdn.net/b.mp4';
    let calls=0;
    const fetcher=async url=>{
        calls++;
        if(url.startsWith('https://api.bk9.dev/'))return Response.json({status:true,BK9:[{url:a},{url:b,type:'video'}]});
        if(url===a)return new Response(picture);
        if(url===b)return new Response(movie);
        throw Error('unexpected url');
    };
    let paths=[];
    const result=await withSocialDownload('instagram','https://instagram.com/p/ABC/',{kind:'post'},async(item,i,total)=>{
        assert.equal(total,2);assert.equal(item.kind,i?'video':'image');await access(item.path);paths.push(item.path);
    },{fetcher,limit:10*1024*1024});
    assert.deepEqual(result,{sent:2,total:2});assert.equal(calls,3);
    for(const p of paths)await assert.rejects(access(p));
    assert.deepEqual(pinterestItems('<meta property="og:image" content="https://i.pinimg.com/a.png">'),[{kind:'image',url:'https://i.pinimg.com/a.png'}]);
    let invokes=0;
    const runner=async(bin,args,opts)=>{
        if(bin!==ytDlp)return run(bin,args,opts);
        invokes++;assert.equal(args.at(-2),'--');assert.ok(args.includes('--no-remote-components'));assert.ok(!('COBALT_API_KEY' in opts.env));
        const path=args[args.indexOf('-o')+1].replace('%(ext)s','mp4');await copyFile(video,path);
        return {stdout:path};
    };
    for(const [platform,url] of [['tiktok','https://www.tiktok.com/@test/video/123'],['instagram','https://instagram.com/reel/ABC/'],['facebook','https://facebook.com/reel/123']]){
        await withSocialDownload(platform,url,{kind:'video'},async item=>assert.equal(item.kind,'video'),{runner});
    }
    assert.equal(invokes,3);
    await assert.rejects(withSocialDownload('instagram','https://instagram.com/p/ABC/',{kind:'post'},async(_item,i)=>{if(i===1)throw Error('send');},{fetcher}),/Se enviaron 1 de 2/);
    const xphoto='https://pbs.twimg.com/media/a.png',xvideo='https://video.twimg.com/a.mp4';
    const twitterFetch=async url=>{
        if(url.startsWith('https://api.fxtwitter.com/'))return Response.json({code:200,tweet:{media:{all:[{type:'photo',url:xphoto},{type:'video',url:xvideo}]}}});
        if(url===xphoto)return new Response(picture);
        if(url===xvideo)return new Response(movie);
        throw Error('unexpected x url');
    };
    const kinds=[];
    await withSocialDownload('twitter','https://x.com/test/status/123',{kind:'post'},async item=>kinds.push(item.kind),{fetcher:twitterFetch});
    assert.deepEqual(kinds,['image','video']);
    const pinImage='https://i.pinimg.com/originals/a.png';
    const pinFetch=async url=>{
        if(url==='https://pin.it/abc')return new Response(null,{status:302,headers:{location:'https://www.pinterest.com/pin/123/'}});
        if(url==='https://www.pinterest.com/pin/123/')return new Response('<meta property="og:image" content="'+pinImage+'">');
        if(url===pinImage)return new Response(picture);
        throw Error('unexpected pin url');
    };
    await withSocialDownload('pinterest','https://pin.it/abc',{kind:'post'},async item=>assert.equal(item.kind,'image'),{fetcher:pinFetch});
    const tphoto='https://p16.tiktokcdn.com/a.png',taudio='https://a.tiktokcdn.com/a.mp3';
    const audio=join(dir,'fixture.mp3');
    await run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440','-t','2','-c:a','libmp3lame','-y',audio]);
    const sound=await readFile(audio);
    const tRunner=async(bin,args,opts)=>{
        if(bin===process.execPath&&args[0].endsWith('tiktok-public-photos.js'))return {stdout:JSON.stringify({items:[{kind:'image',url:tphoto}],music:taudio})};
        return run(bin,args,opts);
    };
    const tFetch=async url=>{
        if(url===tphoto)return new Response(picture);
        if(url===taudio)return new Response(sound);
        throw Error('unexpected tiktok url');
    };
    await withSocialDownload('tiktok','https://www.tiktok.com/@test/photo/123',{kind:'video'},async item=>assert.equal(item.kind,'image'),{runner:tRunner,fetcher:tFetch});
    await withSocialDownload('tiktok','https://www.tiktok.com/@test/photo/123',{kind:'audio'},async item=>assert.equal(item.kind,'audio'),{runner:tRunner,fetcher:tFetch});
    const webm=join(dir,'fixture.webm');
    await run(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=160x120:rate=15','-t','2','-c:v','libvpx-vp9','-threads','2','-y',webm]);
    const converted=await normalizeSocialFile(webm,'video',dir,{limit:10*1024*1024,index:99});
    assert.equal(converted.mime,'video/mp4');
    console.log('Social media routing, mixed carousel, silent MP4, partial errors and cleanup verified');
});
