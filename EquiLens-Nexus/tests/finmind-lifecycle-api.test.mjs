import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
test('P2-1/P2-2 real provider API rejects persisted null and serializes retry with OS-secret save/remove/failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fm-secret-race-')),file=n=>path.join(dir,n),save=(n,v)=>fs.writeFileSync(file(n),JSON.stringify(v));
 save('config.json',{version:1,setupDone:true,market:'TW',providers:{enabled:['finmind'],prefer:{}}});save('settings.json',{autoUpdate:false,monitor:false,news:{enabled:false},report:{enabled:false}});save('finmind-access.json',null);
 const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const child=spawn(process.execPath,['--import','./tests/helpers/finmind-secret-control.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,EQUITY_DATA_DIR:dir,PORT:String(port),FINMIND_API_TOKEN:''},stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',b=>log+=b);
 const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('controlled fixture wait timed out');};
 try{await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error(log||'startup timeout')),8000).unref())]);const base=`http://127.0.0.1:${port}/api/`,get=async p=>(await fetch(base+p)).json();const state=await get('state');const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(b)});const credential=async()=>(await get('config')).providers.find(p=>p.id==='finmind').credential;
 assert.equal(await credential(),'disabled');assert.equal((await post('provider-check',{id:'finmind'})).status,200);
 for(const scenario of ['save','remove','save-failure']){
  for(const name of ['hold-save','hold-remove','fail-save','entered-save','entered-remove'])fs.rmSync(file(name),{force:true});
  assert.equal((await post('provider-key',{id:'finmind',key:'synthetic-baseline'})).status,200);await post('providers',{enabled:['finmind'],prefer:{}});
  const action=scenario==='remove'?'remove':'save';fs.rmSync(file('entered-'+action),{force:true});fs.writeFileSync(file('hold-'+action),'');if(scenario==='save-failure')fs.writeFileSync(file('fail-save'),'');
  const change=post('provider-key',action==='remove'?{id:'finmind',remove:true}:{id:'finmind',key:'synthetic-replacement'});await wait(()=>fs.existsSync(file('entered-'+action)));assert.equal(await credential(),'changing');
  let retryDone=false;const retry=post('providers',{enabled:['finmind','twse'],prefer:{}}).then(r=>{retryDone=true;return r;});await wait(async()=>(await get('config')).config.providers.enabled.includes('twse'));assert.equal(retryDone,false,'source retry must wait inside the lifecycle queue');
  fs.rmSync(file('hold-'+action));const [changed,retried]=await Promise.all([change,retry]);assert.equal(changed.status,scenario==='save-failure'?400:200);assert.equal(retried.status,200);assert.equal(await credential(),scenario==='remove'?'missing':scenario==='save-failure'?'disabled':'valid');
 }
 assert.doesNotMatch(log,/synthetic-existing-key|synthetic-replacement/);
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});}
});
