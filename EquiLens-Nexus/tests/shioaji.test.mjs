// 永豐金 Shioaji 行情轉接（lib/providers/shioaji.mjs）：訊息轉換、通行碼驗證、訂閱規劃（lib/stream.mjs planStream）與完整推播流程
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStream, planStream } from '../lib/stream.mjs';
import shioaji, { streamEvent, validateBridge, BRIDGE_URL } from '../lib/providers/shioaji.mjs';
import fugle from '../lib/providers/fugle.mjs';
import { PROVIDERS } from '../lib/providers/index.mjs';

// 與 sj-trading 的 tests/fixtures/quote_stk_expected.json 相同：官方 Quote 範例經 quote_format.quote_payload 轉換後的輸出
const sample = JSON.parse(fs.readFileSync(new URL('./shioaji-quote-fixture.json', import.meta.url), 'utf8'));

class FakeSocket extends EventTarget {
  constructor(url) { super(); this.url = url; this.sent = []; this.closed = false; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  emit(type, data) { this.dispatchEvent(data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) })); }
}
function fakeClock() {
  let t = 0, seq = 0; const jobs = new Map();
  const add = (fn, ms, every) => { const id = ++seq; jobs.set(id, { fn, at: t + ms, every }); return id; };
  return {
    now: () => t,
    timers: { setTimeout: (fn, ms) => add(fn, ms), clearTimeout: id => jobs.delete(id), setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: id => jobs.delete(id) },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, j] of jobs) if (j.at <= end && (!next || j.at < next[1].at)) next = [id, j];
        if (!next) break;
        const [id, j] = next; t = j.at;
        if (j.every) j.at += j.every; else jobs.delete(id);
        j.fn();
      }
      t = end;
    },
  };
}

test('shioaji: bridge quote → agg event with lots, NTD, 外盤/內盤 and five-level book', () => {
  const e = streamEvent({ event: 'data', channel: 'aggregates', data: sample });
  assert.deepEqual([e.kind, e.key, e.id, e.time, e.tradeTime], ['agg', 'a:2890', '2890', 1779329404164, 1779329404164]);
  assert.deepEqual(e.row, {
    stock_id: '2890', date: '2026-05-21 10:10:04', open: 29.8, high: 30, low: 29.7, close: 29.8,
    change_price: 0, change_rate: 0, total_volume: 8313, total_amount: 247941050, yesterday_volume: null,
    buy_price: 29.75, sell_price: 29.8, volume_at_bid: 4445, volume_at_ask: 3303, transactions: null,
  });
  assert.deepEqual(e.book.bids[0], { price: 29.75, size: 522 });
  assert.equal(e.book.asks.length, 5);
});

test('shioaji: change rate from price change; non-data, other channels and empty quotes are ignored', () => {
  const e = streamEvent({ event: 'data', channel: 'aggregates', data: { ...sample, close: 31, change: 1 } });
  assert.equal(e.row.change_rate, 3.33);
  assert.equal(streamEvent({ event: 'heartbeat' }), null);
  assert.equal(streamEvent({ event: 'data', channel: 'books', data: sample }), null);
  assert.equal(streamEvent({ event: 'data', channel: 'aggregates', data: { ...sample, close: 0 } }), null);
});

test('shioaji: provider is registered as a stream-only source with a 200-subscription bridge plan', () => {
  assert.equal(PROVIDERS.shioaji, shioaji);
  assert.deepEqual(Object.keys(shioaji.caps), ['stream']);
  assert.equal(shioaji.stream.url, BRIDGE_URL);
  assert.match(BRIDGE_URL, /^ws:\/\/127\.0\.0\.1:/);
  assert.equal(shioaji.stream.plan({}, 'advanced'), 'bridge');
  assert.deepEqual(shioaji.stream.plans.bridge, { limit: 200, connections: 1, perMinute: 60 });
  assert.equal(shioaji.stream.channels.full, undefined);
  assert.deepEqual(shioaji.stream.channels.book, []);
  for (const fn of ['streamHistory', 'streamBackfill', 'quoteDetail', 'indexDetail', 'streamTrades', 'snapshot']) assert.equal(shioaji[fn], undefined, fn);
});

test('shioaji: validate succeeds on authenticated, fails on error or when the bridge is unreachable', async () => {
  let sock;
  const connect = url => (sock = new FakeSocket(url));
  const ok = validateBridge('token-123', { connect });
  sock.emit('open');
  assert.deepEqual(sock.sent[0], { event: 'auth', data: { apikey: 'token-123' } });
  sock.emit('message', { event: 'authenticated' });
  assert.deepEqual(await ok, { plan: 'bridge', tier: 'paid', streamLimit: 200 });
  assert.ok(sock.closed);

  const bad = validateBridge('wrong', { connect });
  sock.emit('open'); sock.emit('message', { event: 'error', data: { message: 'invalid bridge token' } });
  await assert.rejects(bad, /不接受此通行碼/);

  const down = validateBridge('token-123', { connect });
  sock.emit('close');
  await assert.rejects(down, /無法連到永豐金行情轉接服務/);

  await assert.rejects(validateBridge('token-123', { connect: () => new FakeSocket('x'), timeoutMs: 10 }), /無法連到/);
});

test('planStream: Shioaji spec gives lite mode, at most 200 symbols and no order-book extras', () => {
  const universe = Array.from({ length: 250 }, (_, i) => String(1101 + i));
  let slotsAsked = false;
  const plan = planStream({ spec: shioaji.stream, planId: shioaji.stream.plan(), universe, watchlistSize: 5, fullAllowed: true, bookSlots: () => { slotsAsked = true; return 100; }, bookExtras: () => ['9999'] });
  assert.equal(plan.full, false);
  assert.deepEqual(plan.channels, ['aggregates']);
  assert.equal(plan.ids.length, 200);
  assert.deepEqual(plan.ids, universe.slice(0, 200));
  assert.equal(plan.plan.limit, 200);
  assert.deepEqual([plan.slots, plan.extra, slotsAsked], [0, [], false]);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0].extra, { symbols: [], channels: [] });
});

test('planStream: Fugle behaviour unchanged (full mode split over connections, order-book extras on books)', () => {
  const universe = Array.from({ length: 40 }, (_, i) => String(2301 + i));
  const plan = planStream({ spec: fugle.stream, planId: 'advanced', universe, watchlistSize: 10, fullAllowed: true, bookSlots: spare => Math.min(30, spare - 50), bookExtras: (main, n) => ['9901', '9902'].filter(id => !main.has(id)).slice(0, n) });
  assert.equal(plan.full, true);
  assert.deepEqual(plan.channels, ['trades', 'candles', 'books']);
  assert.equal(plan.ids.length, 40);
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.slots, 30);
  assert.deepEqual(plan.extra, ['9901', '9902']);
  assert.deepEqual(plan.groups.flatMap(g => g.extra.symbols).sort(), ['9901', '9902']);
  assert.ok(plan.groups.every(g => g.extra.channels.length === 1 && g.extra.channels[0] === 'books'));
  const lite = planStream({ spec: fugle.stream, planId: 'developer', universe, watchlistSize: 10, fullAllowed: false, bookSlots: () => 0, bookExtras: () => [] });
  assert.deepEqual([lite.full, lite.channels, lite.groups.length], [false, ['aggregates'], 1]);
});

test('shioaji stream: auth, subscribe, rejected symbols not counted, quotes become rows, bridge close → disconnected', () => {
  const clock = fakeClock(), socks = [], rows = [], states = [];
  const stream = createStream({
    spec: shioaji.stream, key: 'token-123', market: { tz: 'Asia/Taipei', lot: 1000 }, symbols: ['2330', '2890', '9999'],
    onEvents: r => rows.push(r), onStatus: s => states.push(s),
    connect: url => { const ws = new FakeSocket(url); socks.push(ws); return ws; }, now: clock.now, timers: clock.timers,
  });
  const ws = socks[0], last = () => states.at(-1);
  assert.equal(ws.url, BRIDGE_URL);
  ws.emit('open');
  assert.deepEqual(ws.sent[0], { event: 'auth', data: { apikey: 'token-123' } });
  ws.emit('message', { event: 'authenticated' });
  assert.deepEqual(ws.sent[1], { event: 'subscribe', data: { channel: 'aggregates', symbols: ['2330', '2890', '9999'] } });
  ws.emit('message', { event: 'subscribed', data: [{ id: '1', channel: 'aggregates', symbol: '2330' }, { id: '2', channel: 'aggregates', symbol: '2890' }] });
  ws.emit('message', { event: 'error', data: { message: 'subscription rejected: 9999(unknown)' } });
  assert.deepEqual([last().connected, last().subscribed, last().expected], [true, 2, 3]);
  assert.match(last().error, /9999\(unknown\)/);
  ws.emit('message', { event: 'data', channel: 'aggregates', data: sample });
  clock.advance(1000);
  assert.deepEqual(rows.at(-1).map(e => [e.kind, e.row.stock_id, e.row.close, e.row.volume_at_ask]), [['agg', '2890', 29.8, 3303]]);
  // 上游斷線時轉接服務會關閉連線：衡析必須回報斷線並自動重連
  ws.emit('close');
  assert.equal(last().connected, false);
  clock.advance(5000);
  assert.equal(socks.length, 2, 'reconnects with backoff');
  stream.close();
});
