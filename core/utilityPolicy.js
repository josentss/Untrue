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
export function rateDate(ms){return new Intl.DateTimeFormat('es-VE',{timeZone:'America/Caracas',day:'2-digit',month:'2-digit',year:'numeric'}).format(ms);}
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

export function parseOfficialRates(data,now=Date.now()){
    if(!Array.isArray(data))throw new UtilityError('Tasas BCV no disponibles.');
    function find(currency){
        const rows=data.filter(row=>String(row?.moneda).toUpperCase()===currency&&['oficial','bcv'].includes(String(row?.fuente).toLowerCase()));
        if(rows.length!==1)throw new UtilityError('Tasa BCV no disponible.');
        const row=rows[0],rate=positiveRate(row.promedio),ts=Date.parse(row.fechaActualizacion);
        if(!rate||!Number.isFinite(ts)||ts>now+300000||now-ts>7*86400000)throw new UtilityError('Tasa BCV no disponible o desactualizada.');
        return {rate,ts};
    }
    const usd=find('USD'),eur=find('EUR');
    if(rateDate(usd.ts)!==rateDate(eur.ts))throw new UtilityError('Las referencias BCV corresponden a fechas diferentes.');
    return {usd:usd.rate,eur:eur.rate,timestamp:Math.min(usd.ts,eur.ts)};
}
export function parseBinanceRate(data,now=Date.now()){
    return parseUsdt({binancep2p:data},now);
}
export function formatBcv(r){return '*Tasa BCV*\n\nUSD: '+r.usd.toFixed(4)+' Bs\nEUR: '+r.eur.toFixed(4)+' Bs\nFecha: '+rateDate(r.timestamp)+'\nFuente: bcv.org.ve';}
export function formatUsdt(r){return '*Tasa USDT*\n\nPromedio: '+r.avg.toFixed(4)+' Bs\nCompra: '+r.ask.toFixed(4)+' Bs\nVenta: '+r.bid.toFixed(4)+' Bs\nFecha: '+rateDate(r.newest)+'\nFuente: p2p.binance.com';}
