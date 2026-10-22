// Synthetic 4391/4392 only: browser QA without production credentials or data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT||'playwright');
const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),errors=[];
const poll=async page=>{await page.clock.fastForward(10100);await page.waitForTimeout(200);};
async function check(mobile){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1080}}),name=mobile?'mobile':'desktop',base=mobile?'http://127.0.0.1:4392':'http://127.0.0.1:4391',pattern=mobile?'**/m/api/chart?**':'**/api/chart?**';
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-22T10:00:00+08:00')});await page.goto(base);
 if(mobile){await page.evaluate(()=>fetch('/m/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'nexus-pocket'},body:JSON.stringify({password:'demo-password-123'})}));await page.goto(base);await page.locator('[data-tab="live"]').click();await page.locator('[data-intra="2330"]').click();}
 else {await page.locator('[data-page="live"]').first().click();await page.locator('[data-kbar="2330"]').click();}
 await page.locator('[data-cperiod="day"]').click();
 const caption=page.locator(mobile?'#sheet-body [data-chart] > section .ix-foot':'#detail .chartcaption');
 await page.waitForFunction(()=>document.querySelector('#detail .chartcaption, #sheet-body [data-chart] > section .ix-foot')?.textContent.includes('Shioaji 當日暫估'));
 assert.match(await page.locator(mobile?'#sheet-body':'#detail').innerText(),/09:59:30/);
 const ruleSource=page.locator('[data-pa-box="2330"] [data-rule-source]');
 await poll(page);assert.match(await ruleSource.innerText(),/09:59:30/,'visible reminder metadata must refresh with live quotes');
 const draft=page.locator(mobile?'#sheet-body [data-pa-form] input[name="value"]':'#detail [data-pa-form] input[name="value"]');await draft.fill('4321');
 const rulePattern=mobile?'**/m/api/price-alerts':'**/api/price-alerts';
 await page.route(rulePattern,route=>route.fulfill({status:503,json:{error:'示意提醒狀態中斷'}}));await poll(page);
 assert.doesNotMatch(await ruleSource.innerText(),/09:59:30/,'reminder failures must clear their old quote time');
 assert.equal(await draft.inputValue(),'4321','quote/status refresh must preserve an unsent reminder draft');
 await page.unroute(rulePattern);await poll(page);assert.match(await ruleSource.innerText(),/09:59:30/);
 await draft.blur();const heldAlerts=[],alertsPattern=mobile?'**/m/api/alerts?**':'**/api/alerts?**';
 await page.route(alertsPattern,route=>{heldAlerts.push(route);});await page.route(rulePattern,route=>route.fulfill({status:503,json:{error:'示意提醒狀態中斷'}}));await poll(page);
 assert.doesNotMatch(await ruleSource.innerText(),/09:59:30/,'a pending alerts endpoint cannot block reminder refresh');
 for(const route of heldAlerts)await route.abort();await page.unroute(alertsPattern);await page.unroute(rulePattern);await poll(page);assert.match(await ruleSource.innerText(),/09:59:30/);
 assert.equal(await draft.inputValue(),'4321','background updates must preserve a blurred unsent reminder draft');
 await page.locator(mobile?'#sheet':'#detail-dialog').screenshot({path:`${out}/${name}-valid-quote-chart.png`});
 await page.route(pattern,route=>route.fulfill({status:503,json:{error:'示意圖表連線中斷'}}));
 await poll(page);
 assert.doesNotMatch(await caption.innerText(),/當日暫估/,'a failed chart request must clear its provisional bar');
 assert.match(await page.locator(mobile?'#sheet-body .big':'#detail .price').first().innerText(),/—/);
 await page.unroute(pattern);await poll(page);await page.waitForFunction(()=>document.querySelector('#detail .chartcaption, #sheet-body [data-chart] > section .ix-foot')?.textContent.includes('Shioaji 當日暫估'));
 let held;await page.route(pattern,route=>{held=route;});await poll(page);await poll(page);
 assert.doesNotMatch(await caption.innerText(),/當日暫估/,'a pending request must time out and clear its provisional bar');
 await held?.abort();await page.unroute(pattern);await poll(page);await page.waitForFunction(()=>document.querySelector('#detail .chartcaption, #sheet-body [data-chart] > section .ix-foot')?.textContent.includes('Shioaji 當日暫估'));
 // A disconnected payload must not revive an old successful quote.
 await page.route(pattern,async route=>{const response=await route.fetch(),d=await response.json();await route.fulfill({response,json:{...d,feed:{...d.feed,status:'disconnected'}}});});
 await poll(page);assert.doesNotMatch(await caption.innerText(),/當日暫估/);await page.unroute(pattern);
 if(mobile){await page.locator('[data-close-sheet]').first().click();await page.locator('#settings').click();}
 else {await page.locator('[data-action="close-detail"]').first().click();await page.locator('[data-page="settings"]').first().click();}
 await page.waitForSelector('[data-news-source="finmind"]');
 const fm=page.locator('[data-news-source="finmind"]'),cn=page.locator('[data-news-source="cnyes"]');
 assert.match(await fm.innerText(),/Sponsor/);assert.match(await fm.innerText(),/重試時間/);assert.match(await cn.innerText(),/讀取正常/);assert.match(await cn.innerText(),/最後新文/);
 const monitorPattern=mobile?'**/m/api/monitor':'**/api/monitor';
 await page.route(monitorPattern,async route=>{const response=await route.fetch(),d=await response.json();d.news.status.sources.find(s=>s.provider==='cnyes').error='示意來源暫停';await route.fulfill({response,json:d});});
 await poll(page);assert.match(await cn.innerText(),/示意來源暫停/,'news settings must refresh its source state');
 await page.unroute(monitorPattern);await poll(page);assert.match(await cn.innerText(),/讀取正常/);
 await page.locator(mobile?'#news-set':'#news-settings').screenshot({path:`${out}/${name}-news-source-status.png`});
 console.log(`${name} PASS chart source/time, failure, timeout, disconnect, recovery and independent news status refresh`);
 await page.close();
}
try{for(const mobile of process.argv.includes('--mobile-only')?[true]:[false,true])await check(mobile);assert.deepEqual(errors,[]);console.log('PASS no page errors');}
finally{await browser.close();}
