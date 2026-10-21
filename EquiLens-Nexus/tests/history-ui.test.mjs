import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHistory} from '../public/history-ui.js';
const point={date:'2026-08-21',kind:'emerging',market:'興櫃',originalId:'3158',open:null,previousAverage:999,high:12,low:10,close:11,volume:10,amount:110,sources:[]};
test('emerging renders HLC without a candle body and includes previous average separately',()=>{
 const html=renderHistory({from:'2026-08-21',to:'2026-08-21',calendar:['2026-08-21'],points:[point],gaps:[],notes:[]});assert.match(html,/data-history-kind="emerging"/);assert.doesNotMatch(html,/data-candle-body/);assert.match(html,/data-previous-average="999"/);assert.match(html,/data-original-id="3158"/);
});
test('gap days and untrusted provenance are visible without executable markup',()=>{
 const html=renderHistory({from:'2026-08-21',to:'2026-08-24',calendar:['2026-08-21','2026-08-24'],points:[{...point,kind:'predecessor',market:'上櫃',originalId:'5371',open:10}],gaps:[{date:'2026-08-24',kind:'halt',reason:'<script>oops</script>',sources:['javascript:alert(1)']}],notes:[]});assert.match(html,/data-original-id="5371"/);assert.match(html,/data-gap-date="2026-08-24"/);assert.doesNotMatch(html,/<script>|href="javascript:/);assert.match(html,/&lt;script&gt;/);
});
