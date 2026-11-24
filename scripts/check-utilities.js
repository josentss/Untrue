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
    // Deterministic PDF with 22 pages; no dependence on an HTML importer's
    // interpretation of CSS page breaks.
    const n=22,objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count '+n+' /Kids ['+Array.from({length:n},(_,i)=>(3+i*2)+' 0 R').join(' ')+'] >>'];
    for(let i=0;i<n;i++){
        objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents '+(4+i*2)+' 0 R >>');
        const body='0 0 1 rg 10 10 '+(20+i)+' 40 re f\n';
        objects.push('<< /Length '+Buffer.byteLength(body)+' >>\nstream\n'+body+'endstream');
    }
    let data='%PDF-1.4\n';const offsets=[0];
    for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';}
    const xref=Buffer.byteLength(data);data+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n';
    for(const offset of offsets.slice(1))data+=String(offset).padStart(10,'0')+' 00000 n \n';
    data+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
    const pdf=join(dir,'source.pdf');await writeFile(pdf,data);
    const result=await renderDocument(pdf,'pdf',dir,['22']);
    assert.equal(result.length,1);assert.equal(result[0].page,22);assert.equal(result[0].total,22);
    assert.ok((await stat(result[0].path)).size>0);
    await assert.rejects(renderDocument(pdf,'pdf',dir,[]),/22 páginas/);
    await withTemp(async office=>{
        const input=join(office,'source.txt');await writeFile(input,'Documento de prueba.\nHola mundo.');
        await run('libreoffice',['--headless','--convert-to','docx:Office Open XML Text','--outdir',office,input],{timeout:60000});
        const pages=await renderDocument(join(office,'source.docx'),'docx',office,['1']);
        assert.equal(pages.length,1);assert.equal(pages[0].page,1);
    });
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
