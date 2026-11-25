import {quotedText} from '../core/urls.js';
import {UtilityError,languages,cleanText,textChunks} from '../core/utilityPolicy.js';
import {utilityJson} from '../services/utilityHttp.js';
export async function translateText(value,destination,source='auto',{fetcher=fetch}={}){
    if(!Object.hasOwn(languages,destination)||source!=='auto'&&!Object.hasOwn(languages,source))throw new UtilityError('Idioma no compatible.');
    const text=cleanText(value);
    if(!text||Buffer.byteLength(text)>4500)throw new UtilityError('Responde a un texto de hasta 4500 bytes.');
    if(source===destination)return text;
    try{
        const url=new URL('https://translate.googleapis.com/translate_a/single');
        url.search=new URLSearchParams({client:'gtx',sl:source,tl:destination,dt:'t',q:text});
        const data=await utilityJson(url.href,{fetcher});
        const translated=Array.isArray(data?.[0])?data[0].map(r=>typeof r?.[0]==='string'?r[0]:'').join(''):'';
        if(translated.trim())return cleanText(translated);
    }catch{}
    // MyMemory requires a real source language and accepts at most 500 bytes.
    if(source!=='auto'&&Buffer.byteLength(text)<=500){
        const url=new URL('https://api.mymemory.translated.net/get');
        url.search=new URLSearchParams({q:text,langpair:source+'|'+destination});
        const data=await utilityJson(url.href,{fetcher});
        if(Number(data?.responseStatus)===200&&!data.quotaFinished&&typeof data?.responseData?.translatedText==='string'&&data.responseData.translatedText.trim())return cleanText(data.responseData.translatedText);
    }
    throw new UtilityError('No se pudo traducir. Puedes indicar el idioma de origen: #traducir es en.');
}
export async function traducirCommand(sock,m,args=[]){
    try{
        if(args.length<1||args.length>2)throw new UtilityError('Responde a un texto con #traducir es. Idiomas: '+Object.keys(languages).join(', ')+'. Opcional: #traducir es en (origen inglés).');
        const text=await translateText(quotedText(m),args[0].toLowerCase(),args[1]?.toLowerCase()||'auto');
        for(const part of textChunks(text))await sock.sendMessage(m.key.remoteJid,{text:part},{quoted:m});
    }catch(e){await sock.sendMessage(m.key.remoteJid,{text:e instanceof UtilityError?e.message:'El servicio de traducción no está disponible.'},{quoted:m});return false;}
}
