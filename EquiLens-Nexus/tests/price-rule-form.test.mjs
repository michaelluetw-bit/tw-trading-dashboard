import test from 'node:test';
import assert from 'node:assert/strict';
import { priceRuleForm } from '../public/insight-ui.js';

const now = Date.parse('2026-10-23T10:00:00+08:00');
const quote = {close:2400,date:'2026-10-23',time:'10:00:00',at:'2026-10-23T10:00:00',provider:'shioaji',source:'stream'};

test('historical chart or research prices never become the reminder current price or threshold hint',t=>{
 t.mock.method(Date,'now',()=>now);
 for(const stock of [
  {id:'2330',close:2385},
  {id:'2330',close:2385,live:false,quote},
  {id:'2330',live:true,quote:{...quote,date:'2026-10-22',at:'2026-10-22T13:30:00'}},
 ]){
  const html=priceRuleForm(stock);
  assert.match(html,/等待有效即時報價/);
  assert.doesNotMatch(html,/現價|2,385|2,400|placeholder="2385|placeholder="2400/);
  assert.match(html,/name="stockId" value="2330"/);
 }
});

test('a current live quote supplies the reminder price, timestamp and threshold placeholder',t=>{
 t.mock.method(Date,'now',()=>now);
 const html=priceRuleForm({id:'2330',close:2385,live:true,quote});
 assert.match(html,/現價 2,400\.00/);
 assert.match(html,/2026-10-23T10:00:00/);
 assert.match(html,/placeholder="2400\.00"/);
 assert.doesNotMatch(html,/2,385/);
});

test('outside the trading window even a same-day quote is not labeled current',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-23T14:00:00+08:00'));
 assert.doesNotMatch(priceRuleForm({id:'2330',live:true,quote}),/現價|placeholder="2400/);
 assert.doesNotMatch(priceRuleForm(),/現價|等待有效即時報價/);
});
