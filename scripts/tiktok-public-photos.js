import Tiktok from '@tobyg74/tiktok-api-dl';
const url=process.argv[2];
function first(value){
    if(typeof value==='string')return value.startsWith('https://')?value:undefined;
    if(Array.isArray(value))return value.map(first).find(Boolean);
    return value&&typeof value==='object'?first(value.url||value.src||value.playUrl):undefined;
}
try{
    const result=await Tiktok.Downloader(url,{version:'v3'});
    const r=result?.result||{};
    const images=r.images||r.image||[];
    const items=Array.isArray(images)?images.map(first).filter(Boolean).map(url=>({kind:'image',url})):[];
    const music=first(r.music?.playUrl||r.music||r.music_url||r.sound);
    console.log(JSON.stringify({items,music}));
}catch{process.exitCode=1;}
