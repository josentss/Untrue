import {readFileSync} from 'node:fs';
import {utilityJson} from '../services/utilityHttp.js';
import {historicalRate,parseOfficialRates,formatBcv} from '../core/utilityPolicy.js';
const history=()=>{try{return historicalRate(JSON.parse(readFileSync(new URL('../services/bcvTasas.json',import.meta.url),'utf8')));}catch{return null;}};
export function getBCVPrice(){return history()?.usd.toFixed(4)||'N/D';}
export const getBCVFromHistorial=getBCVPrice;
let cached,pending;
export async function exchangeReference({fetcher=fetch,now=Date.now()}={}){
    if(cached&&now-cached.at<15*60000)return cached.value;
    if(pending)return pending;
    pending=(async()=>{
        const value=parseOfficialRates(await utilityJson('https://ve.dolarapi.com/v1/cotizaciones',{fetcher}),now);
        cached={at:now,value};return value;
    })();
    try{return await pending;}finally{pending=undefined;}
}
export async function bcvCommand(sock,m){
    let text,success=true;
    try{text=formatBcv(await exchangeReference());}
    catch{
        success=false;
        text='No se pudo obtener la tasa BCV actual.';
    }
    await sock.sendMessage(m.key.remoteJid,{text,linkPreview:null},{quoted:m});
    return success;
}
