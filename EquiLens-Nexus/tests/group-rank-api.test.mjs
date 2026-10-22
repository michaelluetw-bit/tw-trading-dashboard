import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('Shioaji group rank bypasses denied snapshots, reuses 200 subscriptions and clears cached ranks on disconnect',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'group-rank-stream-')),root=new URL('../',import.meta.url),port=4393;
 const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 const ids=Array.from({length:201},(_,i)=>String(1100+i));
 save('config.json',{version:1,setupDone:true,market:'TW',language:'zh-TW',providers:{enabled:['shioaji','finmind'],prefer:{stream:'shioaji'}},llm:{provider:'anthropic',model:'',baseUrl:'',effort:'high'},publicUrl:'',upColor:'',remote:{tunnel:'auto',pocketHosts:[],contact:'',access:{hosts:[],teamDomain:'',aud:''}}});
 save('settings.json',{autoUpdate:false,monitor:true,daytrade:{enabled:false},news:{enabled:false,cnyes:false}});
 save('universe.json',ids.map(id=>({id,name:'示意'+id,sector:'半導體業',market:'上市'})));
 save('groups.json',{version:1,groups:[{id:'a',name:'A',stockIds:ids.slice(0,2)},{id:'b',name:'B',stockIds:[ids[2]]},{id:'c',name:'C',stockIds:ids.slice(3)}],stockMetadata:[]});
 const previous={date:'2026-10-21',source:'close',asOf:'2026-10-21 13:30:00',stocks:201,quoted:164,groups:[{id:'a',name:'A',stocks:2,quoted:2,rank:1,score:3,move:8,prevRank:9}]};
 save('grouprank-2026-10-21.json',previous);
 const preserved=['config.json','settings.json','groups.json','grouprank-2026-10-21.json'].map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]);
 const child=spawn(process.execPath,['--import','./tests/helpers/group-rank-offline.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),EQUITY_DATA_DIR:dir,DEMO_TIME:'2026-10-22T10:00:00+08:00',SHIOAJI_BRIDGE_TOKEN:'offline-test',FINMIND_API_TOKEN:'offline-test',FUGLE_API_KEY:'',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',s=>log+=s);
 try{
  await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error(log||'startup timeout')),8000).unref())]);
  const get=async p=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+p);assert.equal(r.status,200);return r.json();};
  const state=await get('state');
  const query=async()=>{const r=await fetch(`http://127.0.0.1:${port}/api/grouprank/query`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:'{}'});const d=await r.json();assert.equal(r.status,200,d.error);return d;};
  let monitor;for(let i=0;i<50;i++){monitor=await get('monitor');if(monitor.stream.active&&monitor.snapshot.error)break;await new Promise(r=>setTimeout(r,200));}
  assert.match(monitor.snapshot.error,/Sponsor/);assert.equal(monitor.stream.subscribed,200);
  const inject=(symbol,close,change)=>save('inject-quote.json',{event:'data',channel:'aggregates',data:{symbol,time:'2026-10-22 10:00:01',ts:Date.parse('2026-10-22T10:00:01+08:00'),close,change,totalAmount:40000000,totalVolume:400}});
  for(const [id,close,change] of [['1100',110,10],['1101',90,-10],['1102',120,20]]){inject(id,close,change);await new Promise(r=>setTimeout(r,650));}
  const network=()=>fs.readFileSync(path.join(dir,'external.ndjson'),'utf8'),transport=()=>fs.readFileSync(path.join(dir,'transport.ndjson'),'utf8');
  const beforeNetwork=network(),beforeTransport=transport();
  let result=await query();
  assert.equal(result.provider,'shioaji');assert.equal(result.feed.subscribed,200);assert.equal(result.stocks,201);assert.equal(result.quoted,200);
  assert.deepEqual(result.groups.filter(g=>g.rank).map(g=>[g.id,g.rank,g.score]),[['b',1,20],['a',2,0]]);
  assert(result.groups.every(g=>g.move===null));assert.equal(result.comparison.previousQuoted,164);
  assert.equal(result.groups.find(g=>g.id==='c').quoted,197);
  for(let i=0;i<4;i++)await query();
  assert.equal(network(),beforeNetwork,'ranking never requests snapshots or external data');assert.equal(transport(),beforeTransport,'ranking never adds a subscription');
  const history=(await get('grouprank')).record;assert.equal(history.groups[0].rank,1);assert.equal(history.groups[0].move,null);
  fs.writeFileSync(path.join(dir,'disconnect'),'');await new Promise(r=>setTimeout(r,800));
  const cached=(await get('grouprank')).live;assert.equal(cached.feed.status,'disconnected');assert.equal(cached.quoted,0);assert(cached.groups.every(g=>g.rank===null&&g.score===null));
  result=await query();assert.equal(result.feed.status,'disconnected');assert(result.groups.every(g=>g.rank===null&&g.items.length===0));
  fs.writeFileSync(path.join(dir,'no-quotes'),'');fs.unlinkSync(path.join(dir,'disconnect'));
  for(let i=0;i<40;i++){result=await query();if(result.feed.status==='waiting')break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(result.feed.status,'waiting');assert.equal(result.quoted,0);assert.equal(result.asOf,null);
  for(const [name,bytes] of preserved)assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),bytes,name+' preserved');
  const headers={'Content-Type':'application/json','X-CSRF-Token':state.csrf};
  // Disable Shioaji immediately after caching its result; the fallback must not reuse it.
  const switched=await fetch(`http://127.0.0.1:${port}/api/providers`,{method:'POST',headers,body:JSON.stringify({enabled:['finmind'],prefer:{}})});
  assert.equal(switched.status,200);assert.equal((await get('grouprank')).live,null);
  const fallback=await fetch(`http://127.0.0.1:${port}/api/grouprank/query`,{method:'POST',headers,body:'{}'});
  assert.equal(fallback.status,400,'a newly selected denied snapshot cannot return the old Shioaji cache');
  assert.match((await fallback.json()).error,/Sponsor/);
 }finally{child.kill();await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true});}
});

test('closed Shioaji ranking reads only the same-day close, preserving legacy and future files',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'group-rank-close-')),root=new URL('../',import.meta.url),port=4393;
 const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 save('config.json',{version:1,setupDone:true,market:'TW',providers:{enabled:['shioaji'],prefer:{stream:'shioaji'}}});
 save('settings.json',{autoUpdate:false,monitor:true,daytrade:{enabled:false}});
 save('universe.json',[{id:'2330',name:'示意',sector:'半導體業',market:'上市'}]);
 save('groups.json',{version:1,groups:[{id:'a',name:'A',stockIds:['2330']}],stockMetadata:[]});
 const legacy={date:'2026-10-23',source:'close',stocks:1,quoted:1,groups:[{id:'a',name:'A',rank:1,score:3,prevRank:8,move:7}]};
 save('grouprank-2026-10-23.json',legacy);const futureBytes=fs.readFileSync(path.join(dir,'grouprank-2026-10-23.json'),'utf8');
 const child=spawn(process.execPath,['--import','./tests/helpers/group-rank-offline.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),EQUITY_DATA_DIR:dir,DEMO_TIME:'2026-10-22T14:10:00+08:00',SHIOAJI_BRIDGE_TOKEN:'offline-test',FINMIND_API_TOKEN:'',FUGLE_API_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
  await once(child.stdout,'data');
  const base=`http://127.0.0.1:${port}/api/`,state=await(await fetch(base+'state')).json();
  const query=async()=>{const r=await fetch(base+'grouprank/query',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:'{}'});assert.equal(r.status,200);return r.json();};
  const closed=await query();assert.equal(closed.date,'2026-10-22');assert.equal(closed.feed.status,'closed');assert.equal(closed.quoted,0);assert.equal(closed.groups[0].rank,null);
  const sameDay={...legacy,date:'2026-10-22'};save('grouprank-2026-10-22.json',sameDay);const bytes=fs.readFileSync(path.join(dir,'grouprank-2026-10-22.json'),'utf8');
  const close=await query();assert.equal(close.source,'close');assert.equal(close.date,'2026-10-22');assert.equal(close.groups[0].score,3);assert.equal(close.groups[0].move,null);
  assert.equal(fs.readFileSync(path.join(dir,'grouprank-2026-10-22.json'),'utf8'),bytes);assert.equal(fs.readFileSync(path.join(dir,'grouprank-2026-10-23.json'),'utf8'),futureBytes);
  assert.equal(fs.existsSync(path.join(dir,'transport.ndjson')),false,'closed query opens no subscription');
 }finally{child.kill();await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true});}
});
