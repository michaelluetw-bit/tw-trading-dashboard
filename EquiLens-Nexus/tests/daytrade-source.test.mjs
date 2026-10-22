import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.document={addEventListener(){}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const dt=await import('../public/daytrade.js');globalThis.setInterval=interval;
test('daytrade feed identifies the actual Shioaji provider instead of a Fugle bridge plan',async()=>{
 dt.initDaytrade({api:async()=>({capable:true,enabled:false,settings:{},feed:{provider:'shioaji',window:true,connected:true,mode:'lite',subscribed:200,expected:200},plan:'bridge',plans:{bridge:{limit:200}}})});
 await dt.loadDaytrade();const html=dt.daytradePanel();assert.match(html,/Shioaji/);assert.doesNotMatch(html,/富果bridge/);
});
