// 永豐金 Shioaji 即時行情（台股，經本機行情轉接服務 sj-quote-bridge）：只提供盤中即時推播（精簡模式，每檔 1 個 Quote 訂閱）。
// 轉接服務在這台電腦的 127.0.0.1:4350，使用行情專用金鑰登入永豐金，不能下單；這裡的「金鑰」是轉接服務的本機通行碼。
// 沒有日 K、分 K、快照與補資料 REST：盤中熱浪圖讀取既有推播；時光機與歷史資料照舊由其他資料源提供；當沖監控只有精簡模式。
import { DataError, num } from './common.mjs';

export const BRIDGE_URL = 'ws://127.0.0.1:4350';
// 永豐金訂閱上限 200 個（官方使用限制）；轉接服務只有 1 條連線
export const PLANS = { bridge: { limit: 200, connections: 1, perMinute: 60 } };
const VALIDATE_TIMEOUT_MS = 5000;

const levels = a => (Array.isArray(a) ? a : []).map(l => ({ price: num(l?.price), size: num(l?.size) ?? 0 })).filter(l => l.price > 0);

// 轉接服務的 data 訊息 → 衡析的聚合行情事件（與富果 aggregates 相同格式）。量的單位：張；金額：元
export function streamEvent(msg) {
  const d = msg?.data;
  if (msg?.event !== 'data' || msg.channel !== 'aggregates' || !d?.symbol) return null;
  const close = num(d.close);
  if (!(close > 0) || !d.time) return null;
  const id = String(d.symbol), change = num(d.change), prev = change != null ? close - change : null;
  const bids = levels(d.bids), asks = levels(d.asks), ts = num(d.ts) || 0;
  const row = {
    stock_id: id, date: String(d.time),
    open: num(d.open), high: num(d.high), low: num(d.low), close,
    change_price: change, change_rate: prev > 0 ? Math.round(change / prev * 1e4) / 100 : null,
    total_volume: num(d.totalVolume) ?? 0, total_amount: num(d.totalAmount) ?? 0, yesterday_volume: null,
    buy_price: bids[0]?.price ?? null, sell_price: asks[0]?.price ?? null,
    volume_at_bid: num(d.volumeAtBid), volume_at_ask: num(d.volumeAtAsk), transactions: null,
  };
  return { kind: 'agg', key: 'a:' + id, id, tradeTime: ts, time: ts, row, book: { bids, asks } };
}

// 驗證通行碼：連上轉接服務並完成認證（connect 可注入，測試用）
export function validateBridge(key, { connect = url => new WebSocket(url), url = BRIDGE_URL, timeoutMs = VALIDATE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let done = false, sock;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); try { sock?.close(); } catch { } err ? reject(err) : resolve(value); };
    const unreachable = () => finish(new DataError('無法連到永豐金行情轉接服務（sj-quote-bridge），請先在 sj-trading 執行 uv run sj-quote-bridge', null, { code: 'auth' }));
    const timer = setTimeout(unreachable, timeoutMs);
    try { sock = connect(url); } catch { return unreachable(); }
    sock.addEventListener('open', () => sock.send(JSON.stringify({ event: 'auth', data: { apikey: key } })));
    sock.addEventListener('message', ev => {
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (msg.event === 'authenticated') finish(null, { plan: 'bridge', tier: 'paid', streamLimit: PLANS.bridge.limit });
      else if (msg.event === 'error') finish(new DataError('行情轉接服務不接受此通行碼', null, { code: 'auth' }));
    });
    sock.addEventListener('close', unreachable);
    sock.addEventListener('error', () => { /* close 事件會接著處理 */ });
  });
}

export default {
  id: 'shioaji', name: '永豐金 Shioaji（行情轉接）', site: 'https://www.sinotrade.com.tw', docs: 'https://sinotrade.github.io/zh/tutor/market_data/streaming/stocks/', markets: ['TW'],
  key: 'required', keyEnv: 'SHIOAJI_BRIDGE_TOKEN', interval: 1000,
  caps: { stream: 1 },
  stream: {
    url: BRIDGE_URL, plans: PLANS, plan: () => 'bridge',
    // 只有精簡模式；沒有 full（當沖完整模式關閉），book 為空（五檔錄製器不加錄）
    channels: { lite: ['aggregates'], book: [] },
    auth: key => ({ event: 'auth', data: { apikey: key } }),
    subscribe: (symbols, channel = 'aggregates') => ({ event: 'subscribe', data: { channel, symbols } }),
    unsubscribe: ids => ({ event: 'unsubscribe', data: { ids } }),
    batch: 50,
    parse: streamEvent,
  },
  validate: key => validateBridge(key),
};
