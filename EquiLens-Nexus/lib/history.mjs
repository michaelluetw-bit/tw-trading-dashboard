import fs from 'node:fs';
import path from 'node:path';
const symbol = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9.&-]{0,15}$/.test(v) && !v.includes('..');
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const urls = list => Array.isArray(list) && list.every(u => { try { return ['http:','https:'].includes(new URL(u).protocol); } catch { return false; } });

// Supplements are a separate, validated store. They never participate in research scores or write price files.
export function validateSupplement(s, id, market) {
  check(s?.version === 1 && symbol(id) && s.stockId === id && s.market === market, 'history identity mismatch');
  check(date(s.from) && date(s.to) && s.from <= s.to, 'invalid history window');
  const inWindow = d => date(d) && d >= s.from && d <= s.to;
  check(Array.isArray(s.calendar) && s.calendar.length <= 3000 && s.calendar.every(inWindow) && new Set(s.calendar).size === s.calendar.length, 'invalid history calendar');
  check(Array.isArray(s.segments) && s.segments.length <= 20 && Array.isArray(s.gaps) && s.gaps.length <= 3000, 'invalid history records');
  const days = new Set(s.calendar), seen = new Set();
  for (const segment of s.segments) {
    check(['emerging','predecessor'].includes(segment.kind) && symbol(segment.originalId), 'invalid history segment');
    check(typeof segment.market === 'string' && segment.market.length <= 40, 'invalid segment market');
    check(segment.kind !== 'emerging' || (segment.originalId === id && segment.market === '興櫃'), 'invalid emerging identity');
    check(segment.kind !== 'predecessor' || segment.originalId !== id, 'invalid predecessor identity');
    check(Array.isArray(segment.rows) && segment.rows.length <= 3000, 'invalid history rows');
    for (const r of segment.rows) {
      check(days.has(r.date) && !seen.has(r.date), 'duplicate or invalid history date'); seen.add(r.date);
      check(number(r.volume) && number(r.amount), 'invalid history volume');
      if (r.close != null) {
        check(number(r.close) && number(r.high) && number(r.low) && r.low > 0 && r.low <= r.close && r.close <= r.high, 'invalid history price');
        if (segment.kind === 'predecessor') check(number(r.open) && r.open >= r.low && r.open <= r.high, 'invalid predecessor open');
      } else check(r.high == null && r.low == null, 'partial history quote');
      check(r.previousAverage == null || number(r.previousAverage), 'invalid previous average');
      check(r.dailyAverage == null || number(r.dailyAverage), 'invalid daily average');
      check(r.sources == null || urls(r.sources), 'invalid history source');
    }
  }
  const gaps = new Set();
  for (const g of s.gaps) {
    check(days.has(g.date) && !gaps.has(g.date), 'invalid gap date'); gaps.add(g.date);
    check(typeof g.reason === 'string' && g.reason.length <= 2000 && typeof g.kind === 'string', 'invalid gap reason');
    check(g.sources == null || urls(g.sources), 'invalid gap source');
  }
  check(s.notes == null || (Array.isArray(s.notes) && s.notes.every(n => typeof n === 'string' && n.length <= 2000)), 'invalid history notes');
  return s;
}

export function buildHistory(stock, price, supplement, cutoff, market = 'TW') {
  if (!supplement) return null;
  const s = validateSupplement(supplement, stock.id, market);
  check(date(cutoff), 'invalid history cutoff');
  const to = cutoff < s.to ? cutoff : s.to;
  const calendar = s.calendar.filter(d => d <= to), points = new Map();
  // Standard records always take precedence. Source objects are never modified.
  for (const r of price || []) if (r.date >= s.from && r.date <= to && r.close > 0) {
    points.set(r.date, {date:r.date,kind:'listed',market:stock.market,originalId:stock.id,open:r.open,high:r.max,low:r.min,close:r.close,previousAverage:null,dailyAverage:null,volume:r.Trading_Volume,amount:r.Trading_money,sources:[]});
  }
  for (const segment of s.segments) for (const r of segment.rows) {
    if (r.date > to || points.has(r.date) || !(r.close > 0)) continue;
    points.set(r.date, {date:r.date,kind:segment.kind,market:segment.market,originalId:segment.originalId,open:segment.kind === 'emerging' ? null : r.open,high:r.high,low:r.low,close:r.close,previousAverage:r.previousAverage ?? null,dailyAverage:r.dailyAverage ?? null,volume:r.volume,amount:r.amount,sources:r.sources || []});
  }
  // Do not continue showing an old missing-date claim once a current standard record fills that day.
  const gaps = s.gaps.filter(g => g.date <= to && !points.has(g.date)).map(g => ({...g,sources:[...(g.sources || [])]}));
  return {from:s.from,to,checkedAt:s.checkedAt || null,calendar,points:[...points.values()].sort((a,b)=>a.date.localeCompare(b.date)),gaps,notes:[...(s.notes || [])]};
}

export function loadHistory(directory, market, stock, price, cutoff) {
  if (!symbol(stock.id) || !/^[A-Z]{2,5}$/.test(market)) return null;
  try {
    const file = path.join(directory,'history-supplements',market,`${stock.id}.json`);
    if (fs.statSync(file).size > 5_000_000) throw new Error('history too large');
    return buildHistory(stock,price,JSON.parse(fs.readFileSync(file,'utf8')),cutoff,market);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return {error:'補充行情檔案無法讀取，原始行情仍可使用。'};
  }
}
