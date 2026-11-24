export class UtilityError extends Error {}
export const MAX_PAGES=20,MAX_TEXT=30000,MAX_AUDIO_SECONDS=600;
export const languages=Object.freeze({es:'Español',en:'Inglés',de:'Alemán',fr:'Francés',it:'Italiano',ja:'Japonés',ko:'Coreano',pt:'Portugués',ar:'Árabe'});
export function pageSelection(args,total){
    if(!Number.isSafeInteger(total)||total<1)throw new UtilityError('No se pudo determinar el número de páginas.');
    if(args.length>1||args.length===1&&!/^[1-9]\d{0,8}$/.test(args[0]))throw new UtilityError('Usa #toi o #toi 2 para una página específica.');
    if(args.length){const p=Number(args[0]);if(p>total)throw new UtilityError('El documento tiene '+total+' páginas.');return [p];}
    if(total>MAX_PAGES)throw new UtilityError('El documento tiene '+total+' páginas. Usa #toi seguido del número de página (máximo 20 páginas por solicitud).');
    return Array.from({length:total},(_,i)=>i+1);
}
export function cleanText(value){
    return typeof value==='string'?value.replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').replace(/[ \t]+\n/g,'\n').trim():'';
}
export function textChunks(value,limit=3500){
    const chars=Array.from(cleanText(value)),out=[];
    for(let i=0;i<chars.length;){
        let end=Math.min(i+limit,chars.length);
        if(end<chars.length){for(let j=end-1;j>i+Math.floor(limit*.7);j--)if(/\s/.test(chars[j])){end=j+1;break;}}
        out.push(chars.slice(i,end).join(''));i=end;
    }
    return out;
}
export function positiveRate(v){return (typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;}
export function rateDate(ms){return new Intl.DateTimeFormat('es-VE',{timeZone:'America/Caracas',dateStyle:'short',timeStyle:'short'}).format(ms);}
export function historicalRate(data){
    return Object.entries(data||{}).flatMap(([key,row])=>{
        if(!/^\d{8}$/.test(key))return [];
        const d=Number(key.slice(0,2)),m=Number(key.slice(2,4)),y=Number(key.slice(4)),ts=Date.UTC(y,m-1,d),date=new Date(ts);
        if(date.getUTCDate()!==d||date.getUTCMonth()!==m-1||date.getUTCFullYear()!==y)return [];
        const parse=v=>positiveRate(typeof v==='string'?v.replace(/\s*Bs\s*$/i,'').replace(',','.'):v);
        const usd=parse(row?.usdPrice),eur=parse(row?.eurPrice);
        return usd&&eur?[{usd,eur,date:key.slice(0,2)+'/'+key.slice(2,4)+'/'+key.slice(4),ts}]:[];
    }).sort((a,b)=>b.ts-a.ts)[0]||null;
}
export function parseExchangeRates(data,now=Date.now()){
    const usd=positiveRate(data?.conversion_rates?.VES??data?.rates?.VES),perEur=positiveRate(data?.conversion_rates?.EUR??data?.rates?.EUR);
    const timestamp=Number(data?.time_last_update_unix)*1000;
    if(data?.result!=='success'||data.base_code!=='USD'||!usd||!perEur||!Number.isFinite(timestamp)||timestamp<=0||timestamp>now+300000||now-timestamp>7*86400000)throw new UtilityError('Tasa de referencia no disponible.');
    return {usd,eur:usd/perEur,timestamp};
}
export function parseUsdt(data,now=Date.now()){
    const rows=Object.values(data||{}).flatMap(row=>{
        const ask=positiveRate(row?.ask),bid=positiveRate(row?.bid),ts=Number(row?.time)*1000;
        if(!ask||!bid||!Number.isFinite(ts)||ts<=0||ts>now+300000||now-ts>30*60000)return [];
        return [{ask,bid,ts}];
    });
    if(!rows.length)throw new UtilityError('No hay cotizaciones recientes de USDT.');
    const ask=rows.reduce((n,r)=>n+r.ask,0)/rows.length,bid=rows.reduce((n,r)=>n+r.bid,0)/rows.length;
    return {ask,bid,avg:(ask+bid)/2,count:rows.length,oldest:Math.min(...rows.map(r=>r.ts)),newest:Math.max(...rows.map(r=>r.ts))};
}
