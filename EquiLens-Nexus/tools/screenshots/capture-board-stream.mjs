// Offline 4391/4392 demo only. All quote and failure fixtures are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT||'playwright');
const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),errors=[];
async function advanceMonitor(page){for(let i=0;i<3;i++){await page.clock.fastForward(10001);await page.waitForTimeout(100);}}
async function check(page,mobile){
 const prefix=mobile?'mobile':'desktop',api=mobile?'**/m/api/':'**/api/';let snapshotError=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-22T10:00:00+08:00')});
 await page.route(api+'monitor',async route=>{const response=await route.fetch(),j=await response.json();await route.fulfill({response,json:{...j,error:snapshotError?'FinMind 快照無 Sponsor 權限':'',snapshot:{provider:'finmind',error:snapshotError?'FinMind 快照無 Sponsor 權限':''}}});});
 await page.goto(mobile?'http://127.0.0.1:4392/':'http://127.0.0.1:4391/');
 if(mobile){await page.evaluate(()=>fetch('/m/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'nexus-pocket'},body:JSON.stringify({password:'demo-password-123'})}));await page.goto('http://127.0.0.1:4392/');await page.locator('button.tab[data-tab="live"]').click();}
 else await page.locator('[data-page="live"]').first().click();
 await page.locator('[data-board-feed]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-board-feed]')?.textContent.includes('推播連線正常'));
 assert.match(await page.locator('.lv-card .lv-meta').first().innerText(),/Shioaji \d{2}:\d{2}:\d{2}/);
 assert.equal(await page.locator('[data-snapshot-error]').count(),0);
 if(!mobile){assert.match(await page.locator('.dt-panel .dt-status').first().innerText(),/Shioaji/);assert.doesNotMatch(await page.locator('.dt-panel .dt-status').first().innerText(),/富果bridge/);await page.locator('[data-dttab="settings"]').click();assert.equal(await page.locator('[data-dtset="plan"]').count(),0);await page.locator('[data-dttab="scan"]').click();}
 snapshotError=true;await advanceMonitor(page);await page.locator('[data-snapshot-error]').waitFor();
 assert.match(await page.locator('[data-board-feed]').innerText(),/推播連線正常/);assert.doesNotMatch(await page.locator('[data-board-feed]').getAttribute('class'),/warn/);
 await page.screenshot({path:`${out}/${prefix}-board-live.png`,fullPage:true});
 snapshotError=false;await advanceMonitor(page);await page.waitForFunction(()=>!document.querySelector('[data-snapshot-error]'));
 const boardPattern=api+'board**';
 await page.route(boardPattern,async route=>{const response=await route.fetch(),j=await response.json();await route.fulfill({response,json:{...j,live:false,stream:false,asOf:null,feed:{...j.feed,status:'disconnected'},stocks:j.stocks.map(s=>({...s,status:'disconnected',quote:null,spark:[],sparkX:[]}))}});});
 await page.clock.fastForward(3500);await page.waitForFunction(()=>document.querySelector('[data-board-feed]')?.textContent.includes('已斷線'));
 const price=mobile?'.lv-card .lv-px .big':'.lv-card .lv-px > span:first-child';assert.equal((await page.locator(price).first().innerText()).trim(),'—');
 assert.match(await page.locator('.lv-card .lv-meta').first().innerText(),/Shioaji 已斷線/);
 await page.screenshot({path:`${out}/${prefix}-board-disconnected.png`,fullPage:true});
 await page.unroute(boardPattern);await page.clock.fastForward(3500);await page.waitForFunction(()=>document.querySelector('[data-board-feed]')?.textContent.includes('推播連線正常'));
 await page.route(boardPattern,route=>route.fulfill({status:503,json:{error:'離線示意：暫時無法連線'}}));
 await page.clock.fastForward(3500);await page.waitForFunction(()=>document.querySelector('[data-board-feed]')?.textContent.includes('無法取得看板狀態'));
 assert.equal((await page.locator(price).first().innerText()).trim(),'—');await page.unroute(boardPattern);
 await page.clock.fastForward(3500);await page.waitForFunction(()=>document.querySelector('[data-board-feed]')?.textContent.includes('推播連線正常'));
 console.log(prefix+' PASS live quotes/time, snapshot error appear/clear, disconnect clear, request failure and recovery');
}
try{const d=await browser.newPage({viewport:{width:1440,height:1000}});await check(d,false);await d.close();const m=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});await check(m,true);await m.close();assert.deepEqual(errors,[]);console.log('PASS no page errors');}finally{await browser.close();}
