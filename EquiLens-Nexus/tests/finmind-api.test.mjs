import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
test('C01/C03/C10/P03/S01 access settings preserve capabilities, support recheck after disable and never expose the environment key',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fm-access-api-'));
 const save=(n,v)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(v));
 save('config.json',{version:1,setupDone:true,market:'TW',providers:{enabled:['finmind'],prefer:{}}});save('settings.json',{autoUpdate:false,monitor:false,news:{enabled:false},report:{enabled:false}});
 const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const child=spawn(process.execPath,['--import','./tests/helpers/finmind-access-offline.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,EQUITY_DATA_DIR:dir,PORT:String(port),FINMIND_API_TOKEN:'SENSITIVE_TEST_MARKER'},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
 try{await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error(errors||'startup timeout')),8000).unref())]);
 const base=`http://127.0.0.1:${port}/api/`,get=async p=>{const r=await fetch(base+p);assert.equal(r.status,200);return r.json();};const state=await get('state');const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(b)});
 let config=await get('config'),p=config.providers.find(p=>p.id==='finmind');assert.equal(p.credential,'legacy_unverified');for(const cap of ['universe','calendar','daily','adjusted','dailyAll','snapshot','intraday','news','marketNews','valuation','revenue','institutional','brokers','holders','flows','futures','margin','dayTrade'])assert.ok(p.caps.includes(cap),cap);assert.equal(config.capabilities.stream,null);
 assert.equal((await fetch(base+'finmind-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'disable'})})).status,403);
 let r=await post('finmind-access',{action:'disable'});assert.equal(r.status,200);config=await get('config');assert.equal(config.providers.find(p=>p.id==='finmind').credential,'disabled');
 await post('providers',{enabled:['finmind'],prefer:{}});assert.equal((await get('config')).providers.find(p=>p.id==='finmind').credential,'disabled');
 r=await post('provider-check',{id:'finmind'});assert.equal(r.status,200);config=await r.json();p=config.providers.find(p=>p.id==='finmind');assert.equal(p.credential,'valid');assert.equal(p.plan.tier,'unknown');assert.equal(p.entitlement.status,'unknown');
 r=await post('provider-key',{id:'finmind',key:'new-token-fixture'});assert.equal(r.status,409);assert.doesNotMatch(JSON.stringify(config)+fs.readFileSync(path.join(dir,'finmind-access.json'),'utf8'),/SENSITIVE_TEST_MARKER|new-token-fixture/);
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});}
});
