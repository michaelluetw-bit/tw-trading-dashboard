import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'equilens-pattern-test-'));process.env.EQUITY_DATA_DIR=directory;
const {updatePatternData,clearPatterns,patternSnapshot}=await import('../lib/pattern-service.mjs');const {write,read}=await import('../lib/storage.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('./pattern-fixtures.json',import.meta.url),'utf8'))[0];const stock=fixture.stock,dates=fixture.price.map(x=>x.date),cutoff=dates.at(-1);
test('pattern updater is scoped by industry, persists separate cache and resumes without touching DSL price history',async()=>{
 try{write('stocks/'+stock.id+'.json',{price:fixture.price,adjusted:fixture.adjusted,privateMarker:'preserve',adjustedSnapshot:cutoff,adjustedIsRaw:true});const before=fs.readFileSync(path.join(directory,'stocks',stock.id+'.json'),'utf8');let calls=0;
 const mock=async(dataset,params)=>{calls++;if(dataset==='TaiwanStockTradingDate')return dates.map(date=>({date}));const key=dataset==='TaiwanStockPrice'?'price':'adjusted';return [{...fixture[key].find(x=>x.date===params.start_date),stock_id:stock.id},{...fixture[key].find(x=>x.date===params.start_date),stock_id:'2881'}];};
 const list=[stock,{id:'2881',name:'金融排除',market:'上市',sector:'金融保險業'}];const progress=[];await updatePatternData(list,{cutoff,request:mock,onProgress:p=>progress.push(p)});assert.equal(calls,181);assert(progress.some(p=>/型態資料準備中/.test(p.message||'')),'progress messages are built (translation function not shadowed)');assert.equal(fs.readFileSync(path.join(directory,'stocks',stock.id+'.json'),'utf8'),before);const active=read('pattern-active.json',{});assert(!fs.existsSync(path.join(directory,active.directory,'2881.json')));assert.equal(read(active.directory+'/'+stock.id+'.json',{}).adjusted.length,90);assert.equal(read(active.directory+'/'+stock.id+'.json',{}).adjustedIsRaw,undefined);
 calls=0;await updatePatternData(list,{cutoff,request:mock});assert.equal(calls,1);clearPatterns();assert.equal(patternSnapshot(list).asOf,cutoff);
 const published=JSON.stringify(read('pattern-active.json',{}));let failingCalls=0;
 await assert.rejects(updatePatternData(list,{cutoff:'2026-09-19',request:async(...args)=>{if(++failingCalls===6)throw new Error('network failure');return mock(...args);}}));assert.equal(JSON.stringify(read('pattern-active.json',{})),published);
 calls=0;const resumed=await updatePatternData(list,{cutoff:'2026-09-19',request:mock});assert(resumed.complete);assert(calls<91);assert.equal(read(read('pattern-active.json',{}).directory+'/'+stock.id+'.json',{}).adjusted.length,90);
 const beforeEmpty=JSON.stringify(read('pattern-active.json',{}));let emptyOnce=true;
 const partial=await updatePatternData(list,{cutoff:'2026-09-20',request:async(dataset,...args)=>{if(dataset==='TaiwanStockPriceAdj'&&emptyOnce){emptyOnce=false;return [];}return mock(dataset,...args);}});assert.equal(partial.complete,false);assert.equal(partial.empty,1);assert.equal(JSON.stringify(read('pattern-active.json',{})),beforeEmpty);
 calls=0;assert((await updatePatternData(list,{cutoff:'2026-09-20',request:mock})).complete);assert.equal(calls,2);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('same-cutoff legacy raw placeholder cannot fill a missing adjusted row in a new batch',async()=>{
 fs.mkdirSync(path.join(directory,'stocks'),{recursive:true});
 try {
  write('stocks/'+stock.id+'.json',{price:fixture.price,adjusted:fixture.price,adjustedSnapshot:cutoff,adjustedIsRaw:true});
  const missing=dates[20];
  await updatePatternData([stock],{cutoff,request:async(dataset,params)=>{
   if(dataset==='TaiwanStockTradingDate')return dates.map(date=>({date}));
   const key=dataset==='TaiwanStockPrice'?'price':'adjusted';
   return [{...fixture[key].find(r=>r.date===params.start_date),stock_id:key==='adjusted'&&params.start_date===missing?'outside':stock.id}];
  }});
  const active=read('pattern-active.json',{}),raw=read(active.directory+'/'+stock.id+'.json',{});
  assert.equal(raw.adjusted.length,89);assert(!raw.adjusted.some(r=>r.date===missing));clearPatterns();assert.equal(patternSnapshot([stock]).eligible,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
