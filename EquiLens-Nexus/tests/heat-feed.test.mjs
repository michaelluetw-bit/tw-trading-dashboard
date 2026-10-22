import test from 'node:test';
import assert from 'node:assert/strict';
import * as feed from '../public/heat-feed.js';
test('a delayed Shioaji response from the previous trading day cannot restore a live chart',()=>{
 assert.equal(typeof feed.currentHeatResponse,'function');
 const old={data:{live:true,source:'shioaji',date:'2026-10-22'},feed:{source:'shioaji',status:'live',quoted:199,asOf:'2026-10-22T13:30:00'}};
 const result=feed.currentHeatResponse(old,'2026-10-23');assert.equal(result.data,null);assert.equal(result.feed.status,'waiting');assert.equal(result.feed.asOf,null);assert.equal(result.feed.quoted,0);
 assert.equal(feed.currentHeatResponse(old,'2026-10-22'),old,'same-day response is not rewritten');
});
