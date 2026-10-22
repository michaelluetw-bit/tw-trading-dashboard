// Synthetic 4391/4392 only; never run against the live dashboard or broker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT||'playwright');
const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),errors=[];
async function poll(page){await page.clock.fastForward(30100);await page.waitForTimeout(150);}
async function check(page,mobile){
 const name=mobile?'mobile':'desktop',prefix=mobile?'**/m/api/':'**/api/',queryPattern=prefix+'grouprank/query';
 const score=mobile?'.fr-av':'.gr-table .fr-row td:nth-child(4)',rank=mobile?'.fr-rk':'.gr-table .fr-row .rank';
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-22T10:00:00+08:00')});
 await page.goto(mobile?'http://127.0.0.1:4392/':'http://127.0.0.1:4391/');
 if(mobile){
  await page.evaluate(()=>fetch('/m/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'nexus-pocket'},body:JSON.stringify({password:'demo-password-123'})}));
  await page.goto('http://127.0.0.1:4392/');await page.locator('button.tab[data-tab="live"]').click();await page.locator('[data-lview="groups"]').click();
 }else await page.locator('[data-page="grouprank"]').first().click();
 await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('推播連線正常'));
 assert.match(await page.locator('[data-rank-source]').innerText(),/Shioaji/);
 assert.equal(await page.locator('[data-board-feed]').count(),1,'the ranking page has one authoritative feed status');
 assert.match(await page.locator('[data-rank-source]').innerText(),/09:59:30/);
 assert.match(await page.locator('[data-rank-coverage]').innerText(),/36 \/ 43/);
 assert.match(await page.locator('[data-rank-coverage]').innerText(),/不顯示升降名次/);
 assert((await page.locator('.fr-mv').allInnerTexts()).every(x=>x==='—'));
 assert((await page.locator(score).allInnerTexts()).some(x=>x!=='—'));
 await page.screenshot({path:`${out}/${name}-grouprank-live.png`,fullPage:true});

 // Keep old scores in the response to verify that the actual client clears them.
 await page.route(queryPattern,async route=>{const response=await route.fetch(),d=await response.json();await route.fulfill({response,json:{...d,feed:{...d.feed,status:'disconnected'}}});});
 await poll(page);await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('已斷線'));
 assert((await page.locator(score).allInnerTexts()).every(x=>x==='—'));
 assert((await page.locator(rank).allInnerTexts()).every(x=>x==='—'));
 await page.screenshot({path:`${out}/${name}-grouprank-disconnected.png`,fullPage:true});
 await page.unroute(queryPattern);await poll(page);
 await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('推播連線正常'));

 await page.route(queryPattern,route=>route.fulfill({status:503,json:{error:'示意連線中斷'}}));
 await poll(page);await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('無法取得看板狀態'));
 assert((await page.locator(score).allInnerTexts()).every(x=>x==='—'));
 await page.unroute(queryPattern);await poll(page);
 await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('推播連線正常'));

 let held;await page.route(queryPattern,route=>{held=route;});
 await poll(page);await page.clock.fastForward(10100);await page.waitForTimeout(100);
 await page.waitForFunction(()=>document.body.textContent.includes('排名連線逾時'));
 assert((await page.locator(score).allInnerTexts()).every(x=>x==='—'));
 await held.abort();await page.unroute(queryPattern);await poll(page);
 await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('推播連線正常'));

 await page.route(queryPattern,async route=>{const response=await route.fetch(),d=await response.json();await route.fulfill({response,json:{...d,date:'2026-10-21'}});});
 await poll(page);await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('等待本次連線的新報價'));
 assert((await page.locator(score).allInnerTexts()).every(x=>x==='—'));
 await page.unroute(queryPattern);await poll(page);
 await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('推播連線正常'));
 await page.locator('[data-gr-date]').selectOption('2026-10-21');
 await page.waitForFunction(()=>document.querySelector('[data-rank-source]')?.textContent.includes('收盤紀錄'));
 assert((await page.locator(score).allInnerTexts()).some(x=>x!=='—'));
 assert((await page.locator('.fr-mv').allInnerTexts()).every(x=>x==='—'));
 console.log(name+' PASS live source/time/coverage, unknown comparison hidden, disconnect clear, failure, timeout, prior-day response and history');
}
try{
 const desktop=await browser.newPage({viewport:{width:1440,height:1000}});await check(desktop,false);await desktop.close();
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});await check(mobile,true);await mobile.close();
 assert.deepEqual(errors,[]);console.log('PASS no page errors');
}finally{await browser.close();}
