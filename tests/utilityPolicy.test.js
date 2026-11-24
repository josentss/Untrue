import test from 'node:test';
import assert from 'node:assert/strict';
import {pageSelection,textChunks,historicalRate,parseExchangeRates,parseUsdt} from '../core/utilityPolicy.js';
test('page selection supports pages beyond first 20 and rejects invalid arguments',()=>{
    assert.deepEqual(pageSelection(['25'],30),[25]);assert.deepEqual(pageSelection([],3),[1,2,3]);
    for(const args of [['0'],['2x'],['31'],['1','2'],[]])assert.throws(()=>pageSelection(args,30));
});
test('text chunking preserves line breaks and unicode',()=>{const text='abc\n😀 '.repeat(1000).trim();assert.equal(textChunks(text).join(''),text);});
test('reference rates preserve dates and validate real positive numbers',()=>{
    const now=1700000000000;
    assert.deepEqual(parseExchangeRates({result:'success',base_code:'USD',conversion_rates:{VES:40,EUR:.8},time_last_update_unix:now/1000},now),{usd:40,eur:50,timestamp:now});
    assert.throws(()=>parseExchangeRates({result:'success',base_code:'USD',conversion_rates:{VES:0,EUR:1},time_last_update_unix:now/1000},now));
    assert.equal(historicalRate({'31122024':{usdPrice:'1,25 Bs',eurPrice:'2,50 Bs'},'01012025':{usdPrice:'2,25 Bs',eurPrice:'3,50 Bs'}}).date,'01/01/2025');
});
test('USDT rejects stale rows and numeric string concatenation',()=>{
    const now=1700000000000;
    const r=parseUsdt({a:{ask:'40',bid:'38',time:now/1000},b:{ask:42,bid:40,time:now/1000},old:{ask:100,bid:99,time:now/1000-4000}},now);
    assert.equal(r.count,2);assert.equal(r.avg,40);assert.throws(()=>parseUsdt({a:{ask:1,bid:1}},now));
});
