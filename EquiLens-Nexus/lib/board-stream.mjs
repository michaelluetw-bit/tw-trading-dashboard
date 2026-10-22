// Read-only board projection of the existing Shioaji subscription cache.
const number = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export function boardStamp(value) {
  const s = String(value || '').replace(' ', 'T').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + '+08:00'))) return null;
  if (Number(s.slice(11,13)) > 23 || Number(s.slice(14,16)) > 59 || Number(s.slice(17,19)) > 59) return null;
  return s;
}
export function validBoardQuote(r, today, now = Date.now()) {
  const at = boardStamp(r.date);
  return !!at && at.slice(0,10) === today && number(r.close) > 0 && Date.parse(at + '+08:00') <= now + 10000;
}
export function boardStream(input, { ids = new Set(), today, enabled = true, open = true, connected = false, alive = 0, since = 0, subscribed = 0, error = '', now = Date.now() } = {}) {
  const quotes = new Map();
  for (const r of input) {
    const at = boardStamp(r.date);
    if (!ids.has(r.stock_id) || !validBoardQuote(r,today,now)) continue;
    if (!quotes.has(r.stock_id) || at >= boardStamp(quotes.get(r.stock_id).date)) quotes.set(r.stock_id, r);
  }
  const asOf = [...quotes.values()].map(r => boardStamp(r.date)).sort().at(-1) || null;
  const confirmed = Math.max(0, Math.min(ids.size, Number(subscribed) || 0));
  const timedOut = alive ? now - alive >= 75000 : since && now - since >= 75000;
  const status = !enabled ? 'paused' : !open ? 'closed' : !connected ? 'disconnected' : timedOut ? 'stale' : !alive || !quotes.size ? 'waiting' : error || confirmed < ids.size ? 'partial' : 'live';
  return { feed: { provider: 'shioaji', scope: 'research', status, subscribed: confirmed, planned: ids.size, quoted: quotes.size, asOf }, rows: ['live','partial'].includes(status) ? quotes : new Map() };
}
export function streamBoardQuote(r) {
  if (!r) return null;
  const close = number(r.close), changePrice = number(r.change_price), prev = changePrice == null ? null : close - changePrice, at = boardStamp(r.date);
  return { close, change: prev > 0 ? Math.round(changePrice / prev * 1e4) / 100 : null, changePrice, open:number(r.open), high:number(r.high), low:number(r.low), volume:number(r.total_volume), amount:number(r.total_amount), yesterdayVolume:number(r.yesterday_volume), bid:number(r.buy_price), ask:number(r.sell_price), volumeAtBid:number(r.volume_at_bid), volumeAtAsk:number(r.volume_at_ask), source:'stream', provider:'shioaji', at, date:at.slice(0,10), time:at.slice(11) };
}
export function recordBoardMinute(minutes, r) {
  const at = boardStamp(r.date), close = number(r.close);
  if (!at || !(close > 0)) return;
  let points = minutes.get(r.stock_id); if (!points) minutes.set(r.stock_id, points = new Map());
  const hm = at.slice(11,16), previous = points.get(hm);
  if (!previous || at >= previous.at) points.set(hm, { at, close });
}
export function boardSpark(points, position) {
  return [...(points || [])].sort(([a],[b])=>a.localeCompare(b)).map(([hm,q])=>[position(hm),q.close]).filter(([x,p])=>x!=null&&p>0);
}
