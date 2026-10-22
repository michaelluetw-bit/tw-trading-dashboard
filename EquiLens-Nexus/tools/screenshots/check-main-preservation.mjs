// Offline demo only, using the same 4391 server as capture-heat-stream.mjs.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:'chrome'});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4391/');await p.locator('[data-page="chips"]').first().click();
 await p.locator('[data-cw-date]').selectOption('2026-10-15');
 await p.waitForFunction(()=>document.querySelector('[data-cw-date]')?.value==='2026-10-15');
 const saved=p.waitForResponse(r=>r.url().endsWith('/api/chipwatch/settings')&&r.request().method()==='POST');
 await p.locator('[data-cw-opt="dayPct"]').selectOption('20');assert.equal((await saved).status(),200);
 await p.waitForTimeout(200);assert.equal(await p.locator('[data-cw-date]').inputValue(),'2026-10-15','saving threshold preserves selected historical day');
 assert.ok(await p.locator('.ix-cw-w').count()>0,'saved warrant tracking remains visible');
 const data=await p.evaluate(async()=>{const r=await fetch('/api/chipwatch?date=2026-10-15');return r.json();});
 assert.equal(data.date,'2026-10-15');assert.ok(data.report.branches.some(b=>b.warrants?.buy?.length),'warrant results stay in historical report');
 await p.locator('[data-cw-date]').selectOption('__pick');await p.locator('[data-cw-pick]').fill('2026-10-14');await p.locator('[data-cw="pick"]').click();
 await p.waitForFunction(()=>document.querySelector('[data-cw-date]')?.value==='2026-10-14');
 const warrants=await p.evaluate(async()=>{const r=await fetch('/api/warrants?id=3017');return r.json();});assert.ok(warrants.count>0&&warrants.list.length>0,'stock warrant API still reads cached quotes');
 assert.deepEqual(errors,[]);console.log('PASS main preservation: cached warrants, broker historical dates, save without date reset, custom date picker; no page errors');
}finally{await browser.close();}
