import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile,stat} from 'node:fs/promises';
import {withTemp,run} from '../core/process.js';
import {renderDocument} from '../services/documentConverter.js';
import {ocrImage,speechAudio,transcribe} from '../services/textUtility.js';
import {translateText} from '../commands/traducir.js';
import {ffmpeg} from '../core/config.js';
import sharp from 'sharp';
await withTemp(async dir=>{
    // Make a real multi-page PDF through LibreOffice; verify selective rendering.
    const html=join(dir,'source.html');
    await writeFile(html,'<html><body>'+Array.from({length:22},(_,i)=>'<p style="page-break-before:'+(i?'always':'auto')+'">Page '+(i+1)+'</p>').join('')+'</body></html>');
    await run('libreoffice',['--headless','--convert-to','pdf','--outdir',dir,html],{timeout:60000});
    const pdf=join(dir,'source.pdf');
    const {stdout}=await run('pdfinfo',[pdf]);const total=Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);assert.ok(total>=22);
    const result=await renderDocument(pdf,'pdf',dir,['22']);
    assert.equal(result.length,1);assert.equal(result[0].page,22);assert.equal(result[0].total,total);
    assert.ok((await stat(result[0].path)).size>0);
    const img=join(dir,'ocr-fixture.png');
    await sharp(Buffer.from('<svg width="1200" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="300" fill="white"/><text x="70" y="150" font-size="80" font-family="DejaVu Sans">HOLA MUNDO</text></svg>')).png().toFile(img);
    assert.match(await ocrImage(img,dir),/HOLA\s+MUNDO/i);
    const audio=join(dir,'test.wav');
    await run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440','-t','2','-y',audio]);
    const speech=await speechAudio(audio,dir);assert.ok((await stat(speech)).size>0);
    const calls=[];
    const fetcher=async(url,opts)=>{
        calls.push([url,opts.method]);
        if(url.endsWith('/upload')){for await(const _ of opts.body){}return Response.json({upload_url:'https://cdn.assemblyai.com/upload/test'});}
        if(opts.method==='POST'){const body=JSON.parse(opts.body);assert.equal(body.language_detection,true);assert.deepEqual(body.speech_models,['universal-2']);return Response.json({id:'test'});}
        if(opts.method==='DELETE')return Response.json({});
        return Response.json({status:'completed',text:'Hola\nMundo'});
    };
    assert.equal(await transcribe(speech,{key:'test',fetcher}), 'Hola\nMundo');
    assert.equal(calls.at(-1)[1],'DELETE');
    const translation=await translateText('Hello','es','en',{fetcher:async url=>url.includes('googleapis')?new Response(null,{status:503}):Response.json({responseStatus:200,responseData:{translatedText:'Hola'}})});
    assert.equal(translation,'Hola');
    console.log('Utilities: PDF page selection, native OCR, audio normalization, transcription lifecycle and translation fallback verified');
});
