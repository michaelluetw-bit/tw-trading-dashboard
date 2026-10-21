import test from 'node:test';import assert from 'node:assert/strict';
import {trustedAdjusted} from '../lib/adjusted-data.mjs';import {buildMarket} from '../lib/engine.mjs';import {screenPatterns} from '../lib/patterns.mjs';
const cutoff='2026-10-20',rows=Array.from({length:180},(_,i)=>({date:new Date(Date.parse(cutoff)-(179-i)*864e5).toISOString().slice(0,10),close:100+i,open:100+i,max:101+i,min:99+i,Trading_Volume:1000000}));
const stock={id:'2330',name:'fixture',market:'上市',sector:'半導體業'},proof={kind:'adjusted',provider:'finmind',dataset:'TaiwanStockPriceAdj',from:rows[0].date,to:cutoff,fetchedAt:cutoff+'T12:00:00Z'};
test('legacy raw and unproven adjusted never produce scores or patterns; raw remains usable',()=>{
 for(const extra of [{},{adjustedIsRaw:true,adjustedProvenance:proof}]){
  const raw={price:rows,adjusted:rows,...extra};assert(!trustedAdjusted(raw));const m=buildMarket([stock],{'2330':raw},[],cutoff);assert.equal(m.stocks[0].technical.score,null);assert.equal(m.stocks[0].score,null);assert.equal(m.stocks[0].price,279);assert(m.stocks[0].bars.length);assert.equal(screenPatterns([stock],{'2330':raw},cutoff).eligible,0);
 }
 const good={price:rows,adjusted:rows,adjustedProvenance:proof};assert(trustedAdjusted(good));const s=buildMarket([stock],{'2330':good},[],cutoff).stocks[0];assert(s.technical.score>0);assert.equal(s.score,null,'other missing factors cannot be renormalized into aggregate');
});
test('zero-weight absent factors do not prevent the explicitly selected technical score',()=>{
 const raw={price:rows,adjusted:rows,adjustedProvenance:proof};const s=buildMarket([stock],{'2330':raw},[],cutoff,{technical:100,chips:0,topic:0,industry:0}).stocks[0];assert.equal(s.complete,true);assert.equal(s.score,s.technical.score);
});
