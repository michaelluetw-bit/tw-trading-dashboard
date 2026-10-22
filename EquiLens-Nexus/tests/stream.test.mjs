// 盤中即時推播（lib/stream.mjs）：以假的 WebSocket 與時鐘測試認證、分批訂閱、批次送出、心跳逾時、重連與關閉
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStream } from '../lib/stream.mjs';
import fugle from '../lib/providers/fugle.mjs';

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
class FakeSocket extends EventTarget {
  constructor(url) { super(); this.url = url; this.sent = []; this.closed = false; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  emit(type, data) { this.dispatchEvent(data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) })); }
}
function setup(symbols = ['2330', '2317'], opts = {}) {
  const clock = fakeClock(), socks = [], rows = [], states = [];
  const stream = createStream({
    spec: fugle.stream, key: 'test-key', market: { tz: 'Asia/Taipei', lot: 1000 }, symbols, ...opts,
    onEvents: r => rows.push(r), onStatus: s => states.push(s),
    connect: url => { const ws = new FakeSocket(url); socks.push(ws); return ws; }, now: clock.now, timers: clock.timers,
  });
  const login = ws => { ws.emit('open'); ws.emit('message', { event: 'authenticated', data: { message: 'Authenticated successfully' } }); };
  return { clock, socks, rows, states, stream, login, last: () => states.at(-1) };
}
const agg = (symbol, close) => ({ event: 'data', channel: 'aggregates', id: 'x', data: { date: '2026-10-08', symbol, closePrice: close, change: 1, total: { tradeVolume: 10, tradeValue: close * 10000, tradeVolumeAtBid: 4, tradeVolumeAtAsk: 6 }, lastUpdated: Date.UTC(2026, 9, 8, 2, 0) * 1000 } });

test('stream: key sent only in the auth message, symbols subscribed in batches after authentication', () => {
  const symbols = Array.from({ length: 120 }, (_, i) => String(1101 + i));
  const { socks, login, last } = setup(symbols), ws = socks[0];
  assert.equal(ws.url, 'wss://api.fugle.tw/marketdata/v1.0/stock/streaming');
  assert.ok(!ws.url.includes('test-key'));
  login(ws);
  assert.deepEqual(ws.sent[0], { event: 'auth', data: { apikey: 'test-key' } });
  const subs = ws.sent.slice(1);
  assert.deepEqual(subs.map(m => m.data.symbols.length), [50, 50, 20]);
  assert.ok(subs.every(m => m.event === 'subscribe' && m.data.channel === 'aggregates'));
  assert.deepEqual(subs.flatMap(m => m.data.symbols), symbols);
  ws.emit('message', { event: 'subscribed', data: subs[0].data.symbols.map(symbol => ({ id: symbol, channel: 'aggregates', symbol })) });
  ws.emit('message', { event: 'subscribed', data: { id: 'y', channel: 'aggregates', symbol: '1201' } });
  assert.deepEqual([last().connected, last().symbols, last().subscribed, last().expected], [true, 120, 51, 120]);
});

test('stream: data buffered and flushed once per second, latest row per symbol', () => {
  const { clock, socks, rows, login, last } = setup(), ws = socks[0];
  login(ws);
  ws.emit('message', agg('2330', 1460)); ws.emit('message', agg('2317', 210)); ws.emit('message', agg('2330', 1465));
  ws.emit('message', { event: 'heartbeat', data: { time: 1 } });
  assert.equal(rows.length, 0, 'not yet flushed');
  clock.advance(1000);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map(e => [e.kind, e.row.stock_id, e.row.close, e.row.volume_at_ask]), [['agg', '2330', 1465, 6], ['agg', '2317', 210, 6]]);
  ws.emit('message', { event: 'heartbeat', data: { time: 2 } });
  clock.advance(1000);
  assert.equal(rows.length, 1, 'nothing new, nothing flushed');
  assert.deepEqual([last().connected, last().alive], [true, 1000], 'alive tracks the last message, heartbeats included');
});

test('stream: rejected key waits 10 minutes before retrying; dropped connection backs off', () => {
  const { clock, socks, login, last } = setup();
  socks[0].emit('open');
  socks[0].emit('message', { event: 'error', data: { message: 'Invalid authentication credentials' } });
  assert.ok(socks[0].closed);
  assert.deepEqual([last().connected, last().authFailed, last().error], [false, true, 'Invalid authentication credentials']);
  clock.advance(10 * 60e3 - 1); assert.equal(socks.length, 1);
  clock.advance(1); assert.equal(socks.length, 2);
  socks[1].emit('close'); // 尚未認證就斷線：5 秒、10 秒……逐步拉長
  clock.advance(4999); assert.equal(socks.length, 2);
  clock.advance(1); assert.equal(socks.length, 3);
  socks[2].emit('close');
  clock.advance(9999); assert.equal(socks.length, 3);
  clock.advance(1); assert.equal(socks.length, 4);
  login(socks[3]); // 認證成功後退避重設
  socks[3].emit('close');
  clock.advance(5000); assert.equal(socks.length, 5);
});

test('stream: silent connection is replaced; heartbeats keep it alive', () => {
  const { clock, socks, login } = setup();
  login(socks[0]);
  clock.advance(60e3); socks[0].emit('message', { event: 'heartbeat', data: { time: 1 } });
  clock.advance(60e3); assert.equal(socks.length, 1, 'heartbeat 60 s ago is fine');
  clock.advance(20e3); assert.equal(socks.length, 2, 'over 75 s without any message');
  assert.ok(socks[0].closed);
});

test('stream: update() resubscribes only when the list changes; close() stops everything', () => {
  const { clock, socks, stream, login } = setup();
  login(socks[0]);
  stream.update(['2330', '2317', '2330']);
  clock.advance(10); assert.equal(socks.length, 1, 'same list, no reconnect');
  stream.update(['2454', '2330']);
  clock.advance(0); assert.equal(socks.length, 2);
  assert.ok(socks[0].closed);
  login(socks[1]);
  assert.deepEqual(socks[1].sent.at(-1).data.symbols, ['2454', '2330']);
  assert.deepEqual(stream.symbols, ['2454', '2330']);
  stream.close();
  assert.ok(socks[1].closed);
  socks[1].emit('close');
  clock.advance(30 * 60e3); assert.equal(socks.length, 2, 'no reconnect after close');
});

test('stream: extra (book-only) subscriptions counted apart, changed in place without reconnecting', () => {
  const events = [];
  const { clock, socks, stream, login, last, rows } = setup(['2330', '2317'], { channels: ['trades', 'books'], extra: { symbols: ['3406', '2330'], channels: ['books'] }, onEvent: e => events.push(e) });
  const ws = socks[0]; login(ws);
  const subs = ws.sent.slice(1).map(m => [m.data.channel, m.data.symbols]);
  assert.deepEqual(subs, [['trades', ['2330', '2317']], ['books', ['2330', '2317']], ['books', ['3406']]], '2330 books already in the main list, not subscribed twice');
  ws.emit('message', { event: 'subscribed', data: [{ id: 't1', channel: 'trades', symbol: '2330' }, { id: 't2', channel: 'trades', symbol: '2317' }] });
  ws.emit('message', { event: 'subscribed', data: [{ id: 'b1', channel: 'books', symbol: '2330' }, { id: 'b2', channel: 'books', symbol: '2317' }] });
  ws.emit('message', { event: 'subscribed', data: [{ id: 'x1', channel: 'books', symbol: '3406' }] });
  assert.deepEqual([last().subscribed, last().expected, last().extraSubscribed, last().extraSymbols], [4, 4, 1, 2]);
  // 五檔每一筆都交給 onEvent（批次只留最新一筆）
  const book = (symbol, p) => ({ event: 'data', channel: 'books', data: { symbol, time: 1760320800000000, bids: [{ price: p, size: 1 }], asks: [{ price: p + 5, size: 2 }] } });
  ws.emit('message', book('3406', 1100)); ws.emit('message', book('3406', 1105));
  assert.deepEqual(events.map(e => e.bids[0].price), [1100, 1105]);
  clock.advance(1000); assert.equal(rows[0].length, 1);
  // 只換加錄清單：取消 3406（用訂閱 id）、訂閱 1569，不重新連線
  const n = ws.sent.length;
  stream.update(['2330', '2317'], ['trades', 'books'], { symbols: ['1569'], channels: ['books'] });
  assert.equal(socks.length, 1);
  assert.deepEqual(ws.sent.slice(n), [{ event: 'unsubscribe', data: { ids: ['x1'] } }, { event: 'subscribe', data: { channel: 'books', symbols: ['1569'] } }]);
  ws.emit('message', { event: 'unsubscribed', data: { id: 'x1', channel: 'books', symbol: '3406' } });
  ws.emit('message', { event: 'subscribed', data: { id: 'x2', channel: 'books', symbol: '1569' } });
  assert.deepEqual([last().subscribed, last().extraSubscribed], [4, 1]);
  // 主清單變更才重新連線，並連同加錄清單一起訂閱
  stream.update(['2330'], ['trades', 'books'], { symbols: ['1569'], channels: ['books'] });
  clock.advance(0); assert.equal(socks.length, 2); login(socks[1]);
  assert.deepEqual(socks[1].sent.slice(1).map(m => [m.data.channel, m.data.symbols]), [['trades', ['2330']], ['books', ['2330']], ['books', ['1569']]]);
});

test('stream: an unsubscribe reply only removes the ids we cancelled, even if it lists other subscriptions', () => {
  const { socks, stream, login, last } = setup(['2330', '2317'], { channels: ['trades', 'books'], extra: { symbols: ['3406', '1569'], channels: ['books'] } });
  const ws = socks[0]; login(ws);
  ws.emit('message', { event: 'subscribed', data: ['2330', '2317'].flatMap(s => ['trades', 'books'].map(c => ({ id: c + s, channel: c, symbol: s }))) });
  ws.emit('message', { event: 'subscribed', data: [{ id: 'x1', channel: 'books', symbol: '3406' }, { id: 'x2', channel: 'books', symbol: '1569' }] });
  assert.deepEqual([last().subscribed, last().extraSubscribed], [4, 2]);
  stream.update(['2330', '2317'], ['trades', 'books'], { symbols: ['1569'], channels: ['books'] });
  // 富果的回覆除了被取消的 x1，也列出仍在推播的其他訂閱
  ws.emit('message', { event: 'unsubscribed', data: [{ id: 'x1', channel: 'books', symbol: '3406' }, { id: 'x2', channel: 'books', symbol: '1569' }, { id: 'trades2330', channel: 'trades', symbol: '2330' }, { id: 'books2317', channel: 'books', symbol: '2317' }] });
  assert.deepEqual([last().subscribed, last().expected, last().extraSubscribed, last().extraExpected], [4, 4, 1, 1], 'main stays complete; only 3406 removed');
});

test('stream: a connection that fails before opening (error without close) is retried with backoff', () => {
  const { clock, socks, last } = setup();
  socks[0].emit('error');
  assert.equal(last().connected, false);
  clock.advance(5000);
  assert.equal(socks.length, 2, 'retried after the first backoff');
  socks[1].emit('error');
  socks[1].emit('close'); // a late close for the same socket must not schedule a second retry
  clock.advance(10000);
  assert.equal(socks.length, 3, 'one retry per failure, backoff doubled');
});
