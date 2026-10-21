import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fm-phase1-'));process.env.EQUITY_DATA_DIR=directory;
const {createAccess,allows,confirmedPlan,classifyResponse,responseCode,ACCESS_FILE}=await import('../lib/finmind-access.mjs');
const {request,tickSnapshot,default:fm}=await import('../lib/providers/finmind.mjs');
const {supports,PROVIDERS,setInterval_}=await import('../lib/providers/index.mjs');
const save=s=>fs.writeFileSync(path.join(directory,ACCESS_FILE),JSON.stringify(s));
const state=credential=>({credential,entitlement:{source:'official-account',plan:'backer',confirmedAt:'2026-10-21'}});
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
test('explicit entitlement mapping and unknown numerical levels',()=>{
 for(const plan of ['free','backer','sponsor']) {assert.equal(confirmedPlan({source:'official-account',plan,confirmedAt:'2026-10-21'}),plan);assert.equal(allows(plan,'daily'),true);}
 assert(!allows('free','adjusted'));assert(allows('backer','dailyAll'));assert(!allows('backer','intraday'));assert(allows('sponsor','intraday'));assert(allows('unknown','daily'));assert(!allows('unknown','adjusted'));assert(!allows('sponsor','holders'));
 assert.equal(confirmedPlan({level:3,level_title:'Sponsor',limitHour:6000}),'unknown');
});
test('auth, forbidden, quota and network remain separate; fake-clock cooldown',()=>{
 for(const [status,msg,code] of [[400,'token is invalid','auth'],[400,'Token is expired','auth'],[401,'','auth'],[403,'','forbidden'],[402,'','quota'],[429,'','quota'],[400,'bad date','data']])assert.equal(classifyResponse(status,msg),code);
 assert.equal(responseCode(401,200),'auth');assert.equal(responseCode(403,200),'forbidden');assert.equal(responseCode(429,200),'quota');
 let s=state('valid'),clock=0;const a=createAccess({load:()=>s,save:x=>s=x,now:()=>clock});a.fail('quota');assert.equal(s.credential,'valid');assert.throws(()=>a.assert(),e=>e.code==='quota');clock=3600001;a.assert();a.fail('auth');assert.equal(s.credential,'auth_failed');assert.throws(()=>a.assert());
});
test('all blocked states reject without transport; queued revocation persists and source switch cannot clear it',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({status:200,data:[]})};};
 try {
  for(const credential of ['missing','unverified','revoked','auth_failed']){save(state(credential));await assert.rejects(request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0}));await assert.rejects(tickSnapshot({token:'mock-only'}));}
  assert.equal(calls,0);
  save(state('valid'));let release,entered;const ready=new Promise(r=>entered=r);globalThis.fetch=async()=>{calls++;entered();await new Promise(r=>release=r);return {ok:true,status:200,json:async()=>({status:200,data:[]})};};
  const first=request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0});await ready;
  const waiting=request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0});save(state('revoked'));const {saveConfig}=await import('../lib/config.mjs');saveConfig({providers:{enabled:['twse'],prefer:{}}});saveConfig({providers:{enabled:['twse','finmind'],prefer:{}}});setInterval_('finmind',1);release();await first;await assert.rejects(waiting);assert.equal(calls,1);
  const restarted=createAccess({load:()=>JSON.parse(fs.readFileSync(path.join(directory,ACCESS_FILE))),save});assert.throws(()=>restarted.assert());await assert.rejects(fm.validate('mock-only'));assert.equal(calls,1);
  assert.equal(supports(PROVIDERS.finmind,'dailyAll'),true,'entitlement independent of credential');
 }finally{globalThis.fetch=old;}
});
test('raw success survives denied adjusted request and auth failure stops later calls',async()=>{
 const old=globalThis.fetch;let calls=0;save(state('valid'));
 globalThis.fetch=async()=>{calls++;return calls===1?{ok:true,status:200,json:async()=>({status:200,data:[{date:'2026-10-20',close:100}]})}:{ok:false,status:400,json:async()=>({status:400,msg:'Token is invalid'})};};
 try{const got=await fm.daily('2330','2026-10-20','2026-10-20',{token:'mock-only',interval:0});assert.equal(got.price.length,1);assert.deepEqual(got.adjusted,[]);await assert.rejects(request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0}));assert.equal(calls,2);}finally{globalThis.fetch=old;}
});

test('network errors do not loop and candidate activation is a separate explicit transition',async()=>{
 const old=globalThis.fetch;let calls=0;save(state('valid'));globalThis.fetch=async()=>{calls++;throw new Error('offline fixture');};
 try{await assert.rejects(request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0}));assert.equal(calls,1);}finally{globalThis.fetch=old;}
 let s=state('revoked');const a=createAccess({load:()=>s,save:x=>s=x});a.activate();assert.equal(s.credential,'valid');assert.equal(confirmedPlan(s.entitlement),'unknown');a.confirmEntitlement(state('valid').entitlement);assert.equal(confirmedPlan(s.entitlement),'backer');
});

test('non-JSON HTTP401 persists auth failure before any later request',async()=>{
 const old=globalThis.fetch;let calls=0;save(state('valid'));globalThis.fetch=async()=>{calls++;return {ok:false,status:401,json:async()=>{throw new Error('html');}};};
 try{await assert.rejects(request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0}),e=>e.code==='auth');await assert.rejects(request('TaiwanStockPrice',{data_id:'2330'},{token:'mock-only',interval:0}));assert.equal(calls,1);}finally{globalThis.fetch=old;}
});
