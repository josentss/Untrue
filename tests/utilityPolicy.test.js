import test from 'node:test';
import assert from 'node:assert/strict';
import {pageSelection,textChunks,parseUsdt} from '../core/utilityPolicy.js';
test('page selection supports pages beyond first 20 and rejects invalid arguments',()=>{
    assert.deepEqual(pageSelection(['25'],30),[25]);assert.deepEqual(pageSelection([],3),[1,2,3]);
    for(const args of [['0'],['2x'],['31'],['1','2'],[]])assert.throws(()=>pageSelection(args,30));
});
test('text chunking preserves line breaks and unicode',()=>{const text='abc\n😀 '.repeat(1000).trim();assert.equal(textChunks(text).join(''),text);});
test('USDT rejects stale rows and numeric string concatenation',()=>{
    const now=1700000000000;
    const r=parseUsdt({a:{ask:'40',bid:'38',time:now/1000},b:{ask:42,bid:40,time:now/1000},old:{ask:100,bid:99,time:now/1000-4000}},now);
    assert.equal(r.count,2);assert.equal(r.avg,40);assert.throws(()=>parseUsdt({a:{ask:1,bid:1}},now));
});
