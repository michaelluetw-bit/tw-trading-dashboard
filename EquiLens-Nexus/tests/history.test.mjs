import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistory,validateSupplement} from '../lib/history.mjs';
const stock={id:'3718',market:'上櫃'};
const bar={date:'2026-09-03',stock_id:'3718',open:30,max:32,min:29,close:31,Trading_Volume:1000,Trading_money:31000};
const base=()=>({version:1,market:'TW',stockId:'3718',from:'2025-10-20',to:'2026-10-20',checkedAt:'2026-10-21',calendar:['2026-08-21','2026-08-24','2026-09-03'],segments:[],gaps:[],notes:[]});
test('emerging previous average outside the daily range never becomes the open',()=>{
 const s=base();s.segments=[{kind:'emerging',market:'興櫃',originalId:'3718',rows:[{date:'2026-08-21',open:999,previousAverage:999,high:12,low:10,close:11,volume:100,amount:1100}]}];
 const h=buildHistory(stock,[bar],s,'2026-10-21');assert.ok(h);assert.equal(h.points[0].open,null);assert.equal(h.points[0].previousAverage,999);assert.equal(h.points[0].kind,'emerging');assert.equal(h.points[0].close,11);
});
test('original prices win conflicts and predecessor identities remain intact without mutation',()=>{
 const s=base();s.segments=[{kind:'predecessor',market:'上櫃',originalId:'5371',rows:[{date:'2026-08-21',open:20,high:22,low:19,close:21,volume:100,amount:2100},{date:'2026-09-03',open:200,high:220,low:190,close:210,volume:100,amount:21000}]}];
 const saved=JSON.stringify(s),prices=Object.freeze([Object.freeze({...bar})]);const h=buildHistory(stock,prices,s,'2026-10-21');assert.ok(h);assert.deepEqual(h.points.map(r=>[r.date,r.originalId,r.close]),[['2026-08-21','5371',21],['2026-09-03','3718',31]]);assert.equal(JSON.stringify(s),saved);assert.equal(prices[0].close,31);
});
test('halt reasons survive without synthetic candles and cutoff hides future points and reasons',()=>{
 const s=base();s.gaps=[{date:'2026-08-24',kind:'halt',reason:'股份轉換停止買賣',sources:['https://www.tpex.org.tw/']},{date:'2026-09-03',kind:'unknown',reason:'舊註記'}];
 const h=buildHistory(stock,[bar],s,'2026-08-24');assert.ok(h);assert.equal(h.points.length,0);assert.deepEqual(h.gaps.map(r=>r.date),['2026-08-24']);
 const live=buildHistory(stock,[bar],s,'2026-10-21');assert.deepEqual(live.gaps.map(r=>r.date),['2026-08-24']);assert.equal(live.points.length,1);
});
test('mismatched symbol, market, duplicate dates and invalid prices are rejected',()=>{
 assert.throws(()=>validateSupplement({...base(),stockId:'../../secrets'},'3718','TW'));
 assert.throws(()=>validateSupplement({...base(),market:'US'},'3718','TW'));
 const s=base();s.segments=[{kind:'emerging',market:'興櫃',originalId:'3718',rows:[{date:'2026-08-21',high:10,low:12,close:11}]}];assert.throws(()=>validateSupplement(s,'3718','TW'));
 s.segments[0].rows=[{date:'2026-08-21',high:12,low:10,close:11,volume:0,amount:0},{date:'2026-08-21',high:12,low:10,close:11,volume:0,amount:0}];assert.throws(()=>validateSupplement(s,'3718','TW'));
});
