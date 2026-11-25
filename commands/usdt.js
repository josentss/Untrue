import {utilityJson} from '../services/utilityHttp.js';
import {parseBinanceRate,formatUsdt} from '../core/utilityPolicy.js';
let cached,pending;
async function quote({fetcher=fetch,now=Date.now()}={}){
    if(cached&&now-cached.at<60000)return cached.value;
    if(pending)return pending;
    pending=(async()=>{const value=parseBinanceRate(await utilityJson('https://criptoya.com/api/binancep2p/usdt/ves',{fetcher}),now);cached={at:now,value};return value;})();
    try{return await pending;}finally{pending=undefined;}
}
export async function usdtCommand(sock,m){
    let text,success=true;
    try{text=formatUsdt(await quote());}
    catch{success=false;text='No hay cotizaciones recientes de USDT disponibles.';}
    await sock.sendMessage(m.key.remoteJid,{text,linkPreview:null},{quoted:m});
    return success;
}
