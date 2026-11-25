import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialRates,parseBinanceRate,formatBcv,formatUsdt,rateDate} from '../core/utilityPolicy.js';
const ts=Date.parse('2026-11-24T15:00:00Z');
test('official BCV only, both currencies required, four decimals and short date',()=>{
    const data=[{moneda:'USD',fuente:'oficial',promedio:100.12345,fechaActualizacion:new Date(ts).toISOString()},{moneda:'EUR',fuente:'oficial',promedio:110,fechaActualizacion:new Date(ts).toISOString()},{moneda:'USD',fuente:'paralelo',promedio:999,fechaActualizacion:new Date(ts).toISOString()}];
    const r=parseOfficialRates(data,ts);assert.equal(r.usd,100.12345);
    assert.equal(formatBcv(r),'*Tasa BCV*\n\nUSD: 100.1235 Bs\nEUR: 110.0000 Bs\nFecha: 24/11/2026\nFuente: bcv.org.ve');
    assert.throws(()=>parseOfficialRates(data.slice(0,1),ts));assert.throws(()=>parseOfficialRates(data,ts+8*86400000));
    assert.equal(rateDate(Date.parse('2026-11-25T01:00:00Z')),'24/11/2026');
});
test('USDT uses Binance P2P only and a simple midpoint',()=>{
    const r=parseBinanceRate({ask:120,bid:118,time:ts/1000},ts);
    assert.equal(formatUsdt(r),'*Tasa USDT*\n\nPromedio: 119.0000 Bs\nCompra: 120.0000 Bs\nVenta: 118.0000 Bs\nFecha: 24/11/2026\nFuente: p2p.binance.com');
    assert.throws(()=>parseBinanceRate({ask:120,bid:118,time:ts/1000-1900},ts));
});
