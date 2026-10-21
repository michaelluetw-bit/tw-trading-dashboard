// 族群排名使用推播（lib/grouprank.mjs）：來源健康、事件時間比較、每族群覆蓋門檻、暫定／正式收盤紀錄
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRowsFor, buildGroupRanking, quotesFromSnapshot, closeRecordPlan, RANK_RULES } from '../lib/grouprank.mjs';

const date = '2026-10-21';
const row = (id, time, close = 100, change = 1, amount = 5e8, d = date) => ({ stock_id: id, date: `${d} ${time}`, close, change_price: change, total_amount: amount });
const src = (healthy, rows) => ({ healthy, fresh: healthy, rowOf: id => rows[id] || null });

test('liveRowsFor: newer event time wins, stream on ties, either side alone, other days dropped', () => {
  const stream = { a: row('a', '10:00:05'), b: row('b', '09:59:00'), c: row('c', '10:00:00'), e: row('e', '13:30:00', 100, 1, 5e8, '2026-10-20') };
  const snap = { a: row('a', '10:00:00'), b: row('b', '10:00:00'), c: row('c', '10:00:00'), d: row('d', '10:00:00') };
  const rows = liveRowsFor({ ids: ['a', 'b', 'c', 'd', 'e', 'f'], date, stream: src(true, stream), snap: { fresh: true, rowOf: id => snap[id] || null } });
  assert.deepEqual(rows.map(r => [r.stock_id, r === stream[r.stock_id] ? 'stream' : 'snap']), [['a', 'stream'], ['b', 'snap'], ['c', 'stream'], ['d', 'snap']]);
});

test('liveRowsFor: a snapshot fetched later but with an older event time does not replace a newer stream quote', () => {
  const s = row('a', '10:05:00', 101), f = { ...row('a', '10:04:00', 99), fetchedAt: 'later' };
  const [r] = liveRowsFor({ ids: ['a'], date, stream: src(true, { a: s }), snap: { fresh: true, rowOf: () => f } });
  assert.equal(r.close, 101);
});

test('liveRowsFor: stream down with stale rows still in memory → not used; snapshot also stale → nothing', () => {
  const stale = { a: row('a', '09:10:00') };
  assert.deepEqual(liveRowsFor({ ids: ['a'], date, stream: src(false, stale), snap: { fresh: false, rowOf: () => row('a', '09:00:00') } }), []);
  const onlySnap = liveRowsFor({ ids: ['a'], date, stream: src(false, stale), snap: { fresh: true, rowOf: () => row('a', '09:00:00', 98) } });
  assert.equal(onlySnap[0].close, 98, 'falls back to a fresh snapshot, never to the stale stream row');
});

test('liveRowsFor: healthy stream, stock with no new trade keeps its last row of the day', () => {
  const [r] = liveRowsFor({ ids: ['a'], date, stream: src(true, { a: row('a', '09:01:00') }), snap: { fresh: false, rowOf: () => null } });
  assert.equal(r.date, `${date} 09:01:00`);
});

test('buildGroupRanking: minCoverage marks thin groups incomplete without a rank; default rules unchanged', () => {
  const groups = [{ id: 'g1', name: 'A', stockIds: ['1', '2', '3', '4', '5'] }, { id: 'g2', name: 'B', stockIds: ['6', '7'] }];
  const q = quotesFromSnapshot([row('1', '10:00:00'), row('6', '10:00:00', 100, 2), row('7', '10:00:00', 100, -1)], new Map());
  const strict = buildGroupRanking(groups, q, { ...RANK_RULES, minCoverage: 0.8 });
  const a = strict.find(g => g.id === 'g1'), b = strict.find(g => g.id === 'g2');
  assert.deepEqual([a.incomplete, a.rank, a.coverage, b.incomplete, b.rank, b.coverage], [true, null, 20, false, 1, 100]);
  const loose = buildGroupRanking(groups, q);
  assert.equal(loose.find(g => g.id === 'g1').rank != null, true, 'default minCoverage 0 keeps the old behaviour');
  assert.equal(loose.find(g => g.id === 'g1').incomplete, false);
});

test('stream rows and snapshot rows with the same numbers rank identically', () => {
  const groups = [{ id: 'g', name: 'G', stockIds: ['1', '2'] }];
  const s = [row('1', '10:00:00', 100, 2, 9e8), row('2', '10:00:00', 50, -1, 3e8)];
  const f = s.map(r => ({ ...r, buy_price: 1, sell_price: 2, yesterday_volume: 1 }));
  assert.deepEqual(buildGroupRanking(groups, quotesFromSnapshot(s, new Map())), buildGroupRanking(groups, quotesFromSnapshot(f, new Map())));
});

test('closeRecordPlan: intraday sources only make provisional records; only daily data finalizes', () => {
  const pack = source => ({ source, builtAt: '2026-10-21T05:35:00Z', quoted: 190, stocks: 200 });
  // 13:35, only stream
  assert.deepEqual(closeRecordPlan({ existing: null, provisional: { basis: 'stream', coverage: 0.95 }, final: null }), { write: 'provisional', basis: 'stream' });
  // 13:35, snapshot already at 80% but it is not official daily data → still provisional
  assert.deepEqual(closeRecordPlan({ existing: null, provisional: { basis: 'snapshot', coverage: 0.85 }, final: null }), { write: 'provisional', basis: 'snapshot' });
  // provisional exists, daily not yet → keep
  assert.deepEqual(closeRecordPlan({ existing: pack('close-provisional'), provisional: { basis: 'stream', coverage: 0.95 }, final: null }), { write: null });
  // daily arrives → final, revisedFrom recorded by caller
  assert.deepEqual(closeRecordPlan({ existing: pack('close-provisional'), provisional: null, final: { coverage: 0.9 } }), { write: 'final', revise: true });
  assert.deepEqual(closeRecordPlan({ existing: null, provisional: null, final: { coverage: 0.9 } }), { write: 'final', revise: false });
  // final exists → never rewrite
  assert.deepEqual(closeRecordPlan({ existing: pack('close'), provisional: { basis: 'stream', coverage: 1 }, final: { coverage: 1 } }), { write: null });
  // not enough coverage → nothing
  assert.deepEqual(closeRecordPlan({ existing: null, provisional: { basis: 'stream', coverage: 0.5 }, final: { coverage: 0.4 } }), { write: null });
  assert.deepEqual(closeRecordPlan({ existing: null, provisional: null, final: null }), { write: null });
});
