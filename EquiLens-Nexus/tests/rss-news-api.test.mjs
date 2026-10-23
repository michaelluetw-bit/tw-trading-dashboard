import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('RSS sources integrate with persisted cadence, first-source seeding, independent failure and stale-setting guards',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rss-api-'));const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 save('config.json',{version:1,setupDone:true,market:'TW',providers:{enabled:[],prefer:{}}});save('settings.json',{monitor:false,autoUpdate:false,daytrade:{enabled:false},report:{auto:false},news:{enabled:false,scope:'all',quiet:false}});save('universe.json',[{id:'2330',name:'台積電',market:'上市'}]);save('groups.json',{version:1,groups:[{id:'a',name:'合成研究',stockIds:['2330']}],stockMetadata:[]});
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>r(n));});});
 let child;const start=async()=>{child=spawn(process.execPath,['--import','./tests/helpers/rss-news-offline.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),EQUITY_DATA_DIR:dir,FINMIND_API_TOKEN:'',SHIOAJI_BRIDGE_TOKEN:'',FUGLE_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),new Promise((_,j)=>setTimeout(()=>j(Error('fixture startup timeout')),5000).unref())]);};
 const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 const get=async p=>(await fetch(`http://127.0.0.1:${port}/api/${p}`)).json();const requests=()=>{try{return fs.readFileSync(path.join(dir,'requests.ndjson'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return[];}};
 const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await delay(20);}throw Error('condition timed out');};
 const news=async()=> (await get('monitor')).news;let csrf;const post=async(p,b)=>{const r=await fetch(`http://127.0.0.1:${port}/api/${p}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(b)});assert.equal(r.status,200);return r.json();};
 try{
  await start();csrf=(await get('state')).csrf;await delay(80);assert.equal(requests().length,0,'disabled news never fetches');
  await post('news/settings',{enabled:true,scope:'all',quiet:false});await wait(async()=>(await news()).status.sources.some(s=>s.provider==='technews'&&s.lastSuccess));
  let n=await news();assert.deepEqual(n.sources,['cnyes','technews','ltn']);assert.equal(n.status.today,0,'first source batches are seeded');
  const initial=requests().filter(r=>r.id==='technews').length;await stop();save('advance.json',60000);await start();csrf=(await get('state')).csrf;await delay(100);assert.equal(requests().filter(r=>r.id==='technews').length,initial,'restart retains five-minute attempt');
  save('feed-technews.json',{titles:['台積電合成第二篇']});save('feed-ltn.json',{fail:true});save('advance.json',300001);
  await wait(async()=>{const s=(await news()).status.sources;return s.some(x=>x.provider==='ltn'&&x.error)&&s.some(x=>x.provider==='technews'&&x.lastNew);});n=await news();assert.equal(n.status.today,1);assert.ok(n.status.sources.find(s=>s.provider==='ltn').retryAt>Date.parse('2026-10-23T02:10:00Z'));
  const before=requests().filter(r=>r.id==='technews').length;fs.writeFileSync(path.join(dir,'hold-technews'),'');save('advance.json',600002);await wait(()=>requests().filter(r=>r.id==='technews').length>before);const cn=requests().filter(r=>r.id==='cnyes').length;save('advance.json',660003);await wait(()=>requests().filter(r=>r.id==='cnyes').length>cn);
  const success=(await news()).status.sources.find(s=>s.provider==='technews').lastSuccess;await post('news/settings',{enabled:false,scope:'all',quiet:false});fs.rmSync(path.join(dir,'hold-technews'));await delay(100);assert.equal((await news()).status.sources.find(s=>s.provider==='technews').lastSuccess,success,'disabled generation discards pending success');
  const count=requests().length;await post('config',{market:'US'});await post('news/settings',{enabled:true,scope:'all',quiet:false});save('advance.json',960004);await delay(100);assert.equal(requests().length,count,'non-TW market does not fetch RSS or cnyes');
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('resume seed stays with a slow RSS request across later ticks while healthy cnyes can publish new news',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rss-resume-')),file=n=>path.join(dir,n),save=(n,v)=>fs.writeFileSync(file(n),JSON.stringify(v));
 const initial=Date.parse('2026-10-23T02:00:00Z');
 save('config.json',{version:1,setupDone:true,market:'TW',providers:{enabled:[],prefer:{}}});save('settings.json',{monitor:false,autoUpdate:false,daytrade:{enabled:false},report:{auto:false},news:{enabled:true,scope:'all',quiet:false}});save('universe.json',[{id:'2330',name:'台積電',market:'上市'}]);save('groups.json',{version:1,groups:[{id:'a',name:'合成研究',stockIds:['2330']}],stockMetadata:[]});save('news-seen.json',{at:initial-660000,seen:{},sources:['cnyes','technews','ltn']});save('feed-ltn.json',{titles:[]});fs.writeFileSync(file('hold-technews'),'');
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const child=spawn(process.execPath,['--import','./tests/helpers/rss-news-offline.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),EQUITY_DATA_DIR:dir,FINMIND_API_TOKEN:'',SHIOAJI_BRIDGE_TOKEN:'',FUGLE_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','pipe']});
 const get=async()=> (await (await fetch(`http://127.0.0.1:${port}/api/monitor`)).json()).news;
 const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await delay(20);}throw Error('resume fixture timed out');};
 try{
  await once(child.stdout,'data');await wait(async()=>(await get()).status.sources.find(s=>s.provider==='ltn')?.lastSuccess===initial);
  assert.equal((await get()).status.today,0);
  save('feed-cnyes.json',{titles:['台積電合成持續來源新文']});save('advance.json',61000);await wait(async()=>(await get()).status.today===1);
  fs.rmSync(file('hold-technews'));await wait(async()=>(await get()).status.sources.find(s=>s.provider==='technews')?.lastSuccess===initial+61000);
  assert.equal((await get()).status.today,1,'slow resumed RSS must not notify its old batch after the next cnyes tick');
  save('feed-technews.json',{titles:['台積電合成下一輪新文']});save('advance.json',300001);await wait(async()=>(await get()).status.sources.find(s=>s.provider==='technews')?.lastAttempt===initial+300001);await wait(async()=>(await get()).status.today===2);
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});}
});
