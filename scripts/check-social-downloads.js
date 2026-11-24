import assert from 'node:assert/strict';
import sharp from 'sharp';
import {join} from 'node:path';
import {readFile,copyFile,access} from 'node:fs/promises';
import {withTemp,run} from '../core/process.js';
import {ffmpeg,ytDlp} from '../core/config.js';
import {withSocialDownload,pinterestItems,instagramPublicItems,normalizeSocialFile} from '../services/socialDownloader.js';
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
    // Exact failing route shapes, without sending user links to external services.
    const shortPhotoFetch=async url=>{
        if(url==='https://vt.tiktok.com/ZSs2dmLnJ')return new Response(null,{status:302,headers:{location:'https://www.tiktok.com/@/photo/123?_r=1'}});
        return tFetch(url);
    };
    await withSocialDownload('tiktok','https://vt.tiktok.com/ZSs2dmLnJ',{kind:'video'},async item=>assert.equal(item.kind,'image'),{runner:tRunner,fetcher:shortPhotoFetch});
    const localizedPin=async url=>{
        if(url==='https://pin.it/2s74Wk6q9')return new Response(null,{status:302,headers:{location:'https://es.pinterest.com/pin/637400153560476445/'}});
        if(url==='https://www.pinterest.com/pin/637400153560476445/')return new Response('<meta property="og:image" content="'+pinImage+'">');
        return pinFetch(url);
    };
    await withSocialDownload('pinterest','https://pin.it/2s74Wk6q9',{kind:'post'},async item=>assert.equal(item.kind,'image'),{fetcher:localizedPin});
    const html='<script id="__PWS_DATA__" type="application/json">'+JSON.stringify({related:{id:'999',images:{orig:{url:pinImage}}},pin:{id:'123',images:{orig:{url:pinImage}},videos:{video_list:{V_720P:{url:'https://v.pinimg.com/a.mp4',width:720,height:720}}}}})+'</script>';
    assert.deepEqual(pinterestItems(html,'123'),[{kind:'video',url:'https://v.pinimg.com/a.mp4'}]);
    let attempts=0;
    const instagramFallback=async url=>{
        if(url.startsWith('https://api.bk9.dev/download/instagram?')){attempts++;throw new DOMException('The operation timed out','TimeoutError');}
        if(url.startsWith('https://api.bk9.dev/download/instagram2?')){attempts++;return Response.json({status:true,BK9:[{url:a},{url:b,type:'video'}]});}
        return fetcher(url);
    };
    await withSocialDownload('instagram','https://www.instagram.com/p/DgIQuz4AsjO/?jplx=NTc4MTIwNjQ2YQ==',{kind:'post',position:2},async item=>assert.equal(item.kind,'video'),{fetcher:instagramFallback});
    assert.equal(attempts,2);
    const unavailableRunner=async(bin,args,opts)=>{
        if(bin===ytDlp){assert.ok(args[args.indexOf('--match-filter')+1].includes('duration <=? 1800'));return {stdout:''};}
        return run(bin,args,opts);
    };
    const reelFetch=async url=>{
        if(url.startsWith('https://api.bk9.dev/'))return Response.json({status:true,BK9:[{url:b,type:'video'}]});
        return fetcher(url);
    };
    await withSocialDownload('instagram','https://www.instagram.com/reel/DfzvzeHxHKW/?lqvp=NTc4MTIwNjQ2YQ==',{kind:'video'},async item=>assert.equal(item.kind,'video'),{runner:unavailableRunner,fetcher:reelFetch});
    const publicHtml='<script type="application/json">'+JSON.stringify({unrelated:{shortcode:'other',__typename:'GraphImage',display_url:a},post:{shortcode:'ABC',__typename:'GraphSidecar',edge_sidecar_to_children:{edges:[{node:{__typename:'GraphImage',display_url:a}},{node:{__typename:'GraphVideo',video_url:b}}]}}})+'</script>';
    assert.deepEqual(instagramPublicItems(publicHtml,'ABC'),[{kind:'image',url:a},{kind:'video',url:b}]);
    assert.deepEqual(instagramPublicItems(publicHtml,'missing'),[]);
    const publicFetch=async url=>{
        if(url.startsWith('https://api.bk9.dev/'))throw new DOMException('The operation timed out','TimeoutError');
        if(url==='https://www.instagram.com/p/ABC/')return new Response(publicHtml);
        return fetcher(url);
    };
    await withSocialDownload('instagram','https://instagram.com/p/ABC/',{kind:'post'},async(item,i)=>assert.equal(item.kind,i?'video':'image'),{fetcher:publicFetch});
    let restrictedCalls=0;
    await assert.rejects(withSocialDownload('instagram','https://instagram.com/p/ABC/',{kind:'post'},async()=>assert.fail('restricted media must not send'),{fetcher:async()=>{restrictedCalls++;return new Response(null,{status:403});}}),{code:'restricted'});
    assert.equal(restrictedCalls,1);
    console.log('Social media routing, mixed carousel, silent MP4, partial errors and cleanup verified');
});
