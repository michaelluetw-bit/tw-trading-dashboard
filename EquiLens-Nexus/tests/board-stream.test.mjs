// 即時看板使用推播資料（lib/intraday.mjs）：推播與快照取較新的一筆、推播每分鐘價格 → 看板走勢圖
import test from 'node:test';
import assert from 'node:assert/strict';
import { newerRow, sparkFromMinutes } from '../lib/intraday.mjs';

const row = date => ({ stock_id: '2330', date, close: 1 });

test('newerRow: picks the newer of stream and snapshot rows; either side alone; none', () => {
  const s = row('2026-10-21 09:30:05'), f = row('2026-10-21 09:30:00');
  assert.equal(newerRow(s, f), s);
  assert.equal(newerRow(row('2026-10-21 09:29:00'), f), f);
  assert.equal(newerRow(s, null), s);
  assert.equal(newerRow(null, f), f);
  assert.equal(newerRow(null, null), null);
  const same = row('2026-10-21 09:30:00');
  assert.equal(newerRow(same, f), same, 'equal time prefers the stream row');
});

test('sparkFromMinutes: points sorted by session position, minutes outside the session skipped', () => {
  const minutes = new Map([['09:02', 102], ['09:00', 100], ['13:40', 999], ['09:01', 101]]);
  const posOf = t => t === '13:40' ? null : (Number(t.slice(3, 5)) / 10);
  assert.deepEqual(sparkFromMinutes(minutes, posOf), [[0, 100], [0.1, 101], [0.2, 102]]);
});

test('sparkFromMinutes: empty or missing input gives no points; non-positive prices are skipped', () => {
  assert.deepEqual(sparkFromMinutes(undefined, () => 0), []);
  assert.deepEqual(sparkFromMinutes(new Map(), () => 0), []);
  assert.deepEqual(sparkFromMinutes(new Map([['09:00', 0], ['09:01', 50]]), t => Number(t.slice(3, 5))), [[1, 50]]);
});
