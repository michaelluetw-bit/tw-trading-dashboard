// Run against the isolated offline demo at 4391/4392; never use production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const errors=[];
async function historyRace(page, pattern, select, display, name) {
 let release, started;const held=new Promise(r=>release=r), arrived=new Promise(r=>started=r);
 await page.route(pattern,async route=>{const response=await route.fetch();started();await held;await route.fulfill({response});});
 await page.locator(select).selectOption('2026-10-15');await arrived;
 await page.locator(select).selectOption('2026-10-16');
 await page.waitForFunction(sel=>Array.from(document.querySelectorAll(sel)).some(el=>el.textContent.includes('2026-10-16')),display);
 await page.waitForFunction(()=>!document.querySelector('[data-heat="query"],[data-heat-query]')?.disabled);
 release();await page.waitForTimeout(250);
 assert.match(await page.locator(display).allTextContents().then(x=>x.join(' ')),/2026-10-16/,name+' must preserve last selected date');
 await page.unroute(pattern);
}

try {
 const p=await browser.newPage({viewport:{width:1440,height:1000}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.clock.install({time:new Date('2026-10-22T10:00:00+08:00')});
 await p.goto('http://127.0.0.1:4391/');
 await p.locator('[data-page="heatmap"]').first().click();
 await p.getByRole('status').filter({hasText:'研究範圍'}).waitFor();
 await p.waitForFunction(()=>document.querySelectorAll('.hm-tile').length>0);
 assert.match(await p.getByRole('status').innerText(),/推播連線正常/);
 assert.equal(await p.locator('[data-heat="live"]').isDisabled(),false);
 await p.screenshot({path:out+'/desktop-heat-stream.png',fullPage:true});
 // The connection state comes from the API, while the chart must clear on a null payload.
 await p.route('**/api/heatmap/live',r=>r.fulfill({json:{data:null,feed:{status:'disconnected',symbols:200,subscribed:0,quoted:199,asOf:'2026-10-22T09:59:30'}}}));
 await p.clock.fastForward(11000);
 await p.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('已斷線'));
 assert.equal(await p.locator('.hm-tile').count(),0);
 await p.screenshot({path:out+'/desktop-heat-disconnected.png',fullPage:true});
 await p.locator('#heat-cached').selectOption('2026-10-16');
 await p.waitForFunction(()=>document.querySelectorAll('.hm-tile').length>0);
 assert.equal(await p.getByRole('status').count(),0);
 assert.match(await p.locator('.heat-controls').innerText(),/暫停/);
 await p.screenshot({path:out+'/desktop-heat-history.png',fullPage:true});
 await historyRace(p, '**/api/heatmap?date=2026-10-15', '#heat-cached', '.notice', 'desktop');
 await p.locator('[data-heat="replay"]').click();
 await p.locator('[data-hm-sector]').first().waitFor();
 await p.locator('[data-hm-sector]').first().click();
 assert.match(await p.locator('.crumbs').innerText(), /REPLAY/);
 await p.locator('[data-heat="back"]').click();
 await p.locator('[data-rp="close"]').click();
 const m=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 m.on('pageerror',e=>errors.push(e.message));await m.clock.install({time:new Date('2026-10-22T10:00:00+08:00')});
 await m.goto('http://127.0.0.1:4392/');
 await m.evaluate(()=>fetch('/m/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'nexus-pocket'},body:JSON.stringify({password:'demo-password-123'})}));
 await m.goto('http://127.0.0.1:4392/');await m.locator('button.tab[data-tab="heat"]').click();
 await m.getByRole('status').filter({hasText:'研究範圍'}).waitFor();
 assert.match(await m.getByRole('status').filter({hasText:'研究範圍'}).innerText(),/推播連線正常/);
 await m.screenshot({path:out+'/mobile-heat-stream.png',fullPage:true});
 await m.locator('[data-hsec]').first().click();
 assert.match(await m.locator('[data-hback]').innerText(),/研究範圍/);
 await m.locator('[data-hback]').click();
 await historyRace(m, '**/m/api/heatmap?date=2026-10-15', '#heat-cached', '.kpis', 'mobile');
 await m.locator('[data-hlive]').click();
 await m.getByRole('status').filter({hasText:'研究範圍'}).waitFor();
 await m.route('**/m/api/heatmap/live',r=>r.fulfill({json:{data:null,feed:{status:'disconnected',symbols:200,subscribed:0,quoted:199,asOf:'2026-10-22T09:59:30'}}}));
 await m.clock.fastForward(11000);await m.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('已斷線'));
 assert.equal(await m.locator('#hm').count(),0);
 await m.screenshot({path:out+'/mobile-heat-disconnected.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS desktop/mobile live, disconnected, reverse-order history, research scope and replay drilldown; no page errors');
} finally {await browser.close();}
