import test from 'node:test';
import assert from 'node:assert/strict';
const listeners=new Map();
globalThis.document={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},getElementById(){return null;},querySelector(){return null;},hidden:false};
const click=async dataset=>{for(const fn of listeners.get('click')||[])await fn({target:{closest:()=>({dataset})}});};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const ui=await import('../public/heatmap.js');globalThis.setInterval=interval;
const heat=(date,live=false)=>({date,live,asOf:date+'T10:00:00',retrievedAt:date+'T02:00:00Z',total:{count:0},sectors:[]});
const state=()=>({capabilities:{stream:'shioaji',snapshot:null},tokenConfigured:false,job:{running:false}});
test('Shioaji works without FinMind token, shows coverage and clears historical chart on disconnect',async()=>{
 ui.initHeatmap({state,redraw(){},api:async()=>({data:heat('2026-10-21'),dates:[]})});await ui.loadHeatmap();
 ui.initHeatmap({state,redraw(){},api:async()=>({data:null,feed:{status:'disconnected',symbols:200,quoted:150,asOf:'2026-10-22T10:00:00'}})});
 await ui.loadLive();const html=ui.heatPage();assert.match(html,/已斷線/);assert.match(html,/200/);assert.match(html,/2026-10-22T10:00:00/);assert.doesNotMatch(html,/2026-10-21<\/b>/);
 const button=html.match(/<button data-heat="live"[^>]*>/)[0];assert.doesNotMatch(button,/disabled/);
});
test('late live response cannot overwrite a requested historical chart',async()=>{
 let resolve;ui.initHeatmap({state:()=>({...state(),tokenConfigured:true}),redraw(){},api:async path=>path==='heatmap/live'?new Promise(r=>resolve=r):({data:heat('2026-10-20'),dates:[]})});
 const pending=ui.loadLive();await ui.loadHeatmap({date:'2026-10-20'});resolve({data:heat('2026-10-22',true),feed:{status:'live',symbols:200,quoted:100}});await pending;
 assert.match(ui.heatPage(),/2026-10-20<\/b>/);assert.doesNotMatch(ui.heatPage(),/已斷線/);
});

test('newer historical selection wins even while an older selection is loading',async()=>{
 const pending=new Map();ui.initHeatmap({state,redraw(){},api:path=>new Promise(resolve=>pending.set(path,resolve))});
 const a=ui.loadHeatmap({date:'2026-10-19'}),b=ui.loadHeatmap({date:'2026-10-20'});
 assert.ok(pending.has('heatmap?date=2026-10-20'),'second selection is not discarded');
 pending.get('heatmap?date=2026-10-20')({data:heat('2026-10-20'),dates:[]});await b;
 pending.get('heatmap?date=2026-10-19')({data:heat('2026-10-19'),dates:[]});await a;
 assert.match(ui.heatPage(),/2026-10-20<\/b>/);
});
test('replay sector drilldown does not use live chart variables',async()=>{
 ui.initHeatmap({state,redraw(){},toast(message){throw Error(message);},api:async path=>path==='replay/days'?{days:['2026-10-20']}:path.startsWith('replay?')?{date:'2026-10-20',times:['09:00'],sectors:[],ids:[],stocks:[]}: {}});
 await click({heat:'replay'});await click({heatSector:'半導體業'});
 assert.doesNotThrow(()=>ui.heatPage());await click({rp:'close'});
});
