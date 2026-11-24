import {join} from 'node:path';
import {stat,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {run} from '../core/process.js';
import {childEnv} from './musicDownloader.js';
import {UtilityError,pageSelection} from '../core/utilityPolicy.js';
import sharp from 'sharp';
const supported=new Set(['pdf','doc','docx','xls','xlsx']);
export function documentExt(media){
    const ext=String(media?.fileName||'').split('.').at(-1).toLowerCase();
    if(!supported.has(ext))throw new UtilityError('Formato no compatible. Usa PDF, DOCX, DOC, XLSX o XLS.');
    return ext;
}
export async function renderDocument(input,ext,dir,args,{runner=run,limit=100*1024*1024}={}){
    if(!supported.has(ext))throw new UtilityError('Formato no compatible.');
    const end=Date.now()+120000;
    const remaining=max=>{const ms=end-Date.now();if(ms<=0)throw new UtilityError('Conversión agotada. Prueba una página específica.');return Math.min(ms,max);};
    const exec=(bin,a,max)=>runner(bin,a,{timeout:remaining(max),maxOutput:256*1024,env:childEnv(dir),processGroup:true});
    let pdf=input;
    if(ext!=='pdf'){
        const profile=join(dir,'office-profile');
        await mkdir(join(profile,'user'),{recursive:true,mode:0o700});
        await writeFile(join(profile,'user','registrymodifications.xcu'),'<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>');
        await exec(process.env.LIBREOFFICE_PATH||'libreoffice',['-env:UserInstallation='+pathToFileURL(profile).href,'--headless','--nologo','--nodefault','--norestore','--convert-to','pdf','--outdir',dir,input],60000);
        pdf=join(dir,'source.pdf');
    }
    const st=await stat(pdf);
    if(!st.size||st.size>limit)throw new UtilityError('El PDF supera el límite de tamaño o está vacío.');
    const {stdout}=await exec('pdfinfo',[pdf],10000);
    const total=Number(/^Pages:\s+(\d+)\s*$/m.exec(stdout)?.[1]);
    const pages=pageSelection(args,total),out=[];let bytes=0;
    for(const page of pages){
        const stem=join(dir,'page-'+page);
        await exec('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','2200','-png',pdf,stem],20000);
        const path=stem+'.png',size=await stat(path);
        if(!size.size)throw new UtilityError('No se pudo renderizar la página.');
        let final=path;
        if(size.size>3*1024*1024){final=stem+'.jpg';await sharp(path,{limitInputPixels:5000000}).flatten({background:'#fff'}).jpeg({quality:88}).toFile(final);}
        bytes+=(await stat(final)).size;
        if(bytes>limit)throw new UtilityError('Las imágenes superan el límite total.');
        out.push({page,total,path:final});
    }
    return out;
}
