import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT || 'playwright');
const out=process.argv[2];if(!out)throw Error('output directory required');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4391/');await page.locator('[data-page="overview"]').first().click();
 await page.locator('[data-stock="9991"]').first().click();await page.locator('[data-stock-detail="9991"]').click();
 const panel=page.locator('#detail .history-panel');await panel.waitFor();await panel.scrollIntoViewIfNeeded();
 if(await panel.locator('[data-history-kind="emerging"]').count()!==70)throw Error('missing emerging points');
 await panel.screenshot({path:out+'/history-supplement.png'});
 await panel.locator('.history-data > summary').click();
 const row=panel.locator('tbody tr').first();if(!/不適用/.test(await row.innerText()))throw Error('emerging open mislabeled');
 await page.locator('[data-action="close-detail"]').click();
 // Close the quote dialog opened by the first stock selection before choosing another company.
 await page.keyboard.press('Escape');await page.locator('[data-stock="9992"]').first().click();await page.locator('[data-stock-detail="9992"]').click();
 const pred=page.locator('#detail .history-panel');await pred.waitFor();if(await pred.locator('svg [data-original-id="9990"]').count()!==100)throw Error('predecessor identity lost');await pred.screenshot({path:out+'/history-predecessor.png'});
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile.on('pageerror',e=>errors.push(e.message));
 await mobile.goto('http://127.0.0.1:4392/');await mobile.locator('#pw').fill('demo-password-123');await mobile.locator('#login button[type="submit"]').click();
 await mobile.locator('[data-tab="stocks"]').click();await mobile.locator('[data-mode="all"]').click();await mobile.locator('[data-stock="9991"]').first().click();await mobile.locator('[data-stock-detail="9991"]').click();
 const mp=mobile.locator('.history-panel');await mp.waitFor();await mp.scrollIntoViewIfNeeded();await mp.screenshot({path:out+'/history-mobile.png'});
 const overflow=await mp.evaluate(e=>e.scrollWidth>e.clientWidth+2);if(overflow)throw Error('mobile panel overflows');
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS: desktop emerging/predecessor views, explicit missing open, authenticated mobile and no page errors');
}finally{await browser.close();}
