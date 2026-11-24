import {utilityJson} from '../services/utilityHttp.js';
import {parseUsdt,rateDate} from '../core/utilityPolicy.js';
let cached,pending;
async function quote({fetcher=fetch,now=Date.now()}={}){
    if(cached&&now-cached.at<60000)return cached.value;
    if(pending)return pending;
    pending=(async()=>{const value=parseUsdt(await utilityJson('https://criptoya.com/api/usdt/ves',{fetcher}),now);cached={at:now,value};return value;})();
    try{return await pending;}finally{pending=undefined;}
}
const format=n=>n.toFixed(4)+' Bs';
export async function getUSDTPrice(){try{const r=await quote();return {avgPrice:format(r.avg),date:rateDate(r.newest)};}catch{return {avgPrice:'N/D',date:'N/D'};}}
export async function usdtCommand(sock,m){
    let text;
    try{const r=await quote();text='*Referencia USDT/VES*\n\nPromedio: '+format(r.avg)+'\nVenta (ask): '+format(r.ask)+'\nCompra (bid): '+format(r.bid)+'\nMercados: '+r.count+'\nÚltima cotización: '+rateDate(r.newest)+'\nFuente: CriptoYa. Promedio simple; no es una oferta de compra o venta.';}
    catch{text='No hay cotizaciones recientes de USDT disponibles.';}
    await sock.sendMessage(m.key.remoteJid,{text},{quoted:m});
}
