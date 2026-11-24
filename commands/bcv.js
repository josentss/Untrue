import {readFileSync} from 'node:fs';
import {utilityJson} from '../services/utilityHttp.js';
import {historicalRate,parseExchangeRates,rateDate} from '../core/utilityPolicy.js';
const history=()=>{try{return historicalRate(JSON.parse(readFileSync(new URL('../services/bcvTasas.json',import.meta.url),'utf8')));}catch{return null;}};
export function getBCVPrice(){return history()?.usd.toFixed(4)||'N/D';}
export const getBCVFromHistorial=getBCVPrice;
let cached,pending;
export async function exchangeReference({fetcher=fetch,key=process.env.EXCHANGERATE_API_KEY,now=Date.now()}={}){
    if(cached&&now-cached.at<15*60000)return cached.value;
    if(pending)return pending;
    pending=(async()=>{
        let value;
        const paths=key?['https://v6.exchangerate-api.com/v6/'+encodeURIComponent(key)+'/latest/USD','https://open.er-api.com/v6/latest/USD']:['https://open.er-api.com/v6/latest/USD'];
        for(const path of paths){try{value=parseExchangeRates(await utilityJson(path,{fetcher}),now);break;}catch{}}
        if(!value)throw Error('rate unavailable');
        cached={at:now,value};return value;
    })();
    try{return await pending;}finally{pending=undefined;}
}
export async function bcvCommand(sock,m){
    let text;
    try{
        const r=await exchangeReference();
        text='*Tasas de referencia (ExchangeRate-API)*\n\nUSD: '+r.usd.toFixed(4)+' Bs\nEUR: '+r.eur.toFixed(4)+' Bs\nActualización: '+rateDate(r.timestamp)+'\nNo equivalen necesariamente a la tasa oficial BCV.\nFuente: https://www.exchangerate-api.com';
    }catch{
        const r=history();
        text='No se pudo obtener la referencia actual.'+(r?'\nÚltimo dato del archivo histórico ('+r.date+'): USD '+r.usd.toFixed(4)+' Bs; EUR '+r.eur.toFixed(4)+' Bs. No vigente.':'');
    }
    await sock.sendMessage(m.key.remoteJid,{text},{quoted:m});
}
