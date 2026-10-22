import { activeMarket } from './config.mjs';
import { closeHM } from './markets.mjs';
import { framePrice, frameAmount, prevPrice } from './replay.mjs';
import { createHash } from 'node:crypto';
// 族群排名：研究總覽各族群成分股的盤中漲幅排名。
// 避免失真：① 低量排除——成交金額低於族群總成交 0.5% 或低於 1,000 萬元者不計入分數（仍列出並標示）；
// ② √成交金額加權——量大者影響較大，但不會讓單一權值股獨大，也不讓冷門股的極端漲幅左右族群。
export const RANK_RULES = { minShare: 0.005, minAmount: 1e7 };
const r2 = v => v == null ? null : Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
const median = a => { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2 : null; };

// groups：[{ id, name, stockIds }]；quotes：Map(股票代號 → { name, close, rate, amount })
export function buildGroupRanking(groups, quotes, rules = RANK_RULES) {
  const marketAmount = [...new Set(groups.flatMap(g => g.stockIds))].reduce((s, id) => s + (quotes.get(id)?.amount || 0), 0);
  const rows = groups.map(g => {
    const all = g.stockIds.map(id => { const q = quotes.get(id); return q && q.rate != null && q.amount > 0 ? { id, ...q } : null; }).filter(Boolean);
    const amount = all.reduce((s, x) => s + x.amount, 0);
    for (const x of all) { x.share = amount ? x.amount / amount : 0; x.excluded = x.share < rules.minShare || x.amount < rules.minAmount; }
    const used = all.filter(x => !x.excluded), wsum = used.reduce((s, x) => s + Math.sqrt(x.amount), 0);
    for (const x of all) x.weight = x.excluded || !wsum ? 0 : r2(Math.sqrt(x.amount) / wsum * 100);
    const score = wsum ? used.reduce((s, x) => s + x.rate * Math.sqrt(x.amount), 0) / wsum : null;
    const uAmt = used.reduce((s, x) => s + x.amount, 0);
    const up = all.filter(x => x.rate > 0).length, down = all.filter(x => x.rate < 0).length;
    all.sort((a, b) => b.rate - a.rate);
    return {
      id: g.id, name: g.name, stocks: g.stockIds.length, quoted: all.length, used: used.length, excluded: all.length - used.length,
      score: r2(score), wavg: uAmt ? r2(used.reduce((s, x) => s + x.rate * x.amount, 0) / uAmt) : null,
      avg: all.length ? r2(all.reduce((s, x) => s + x.rate, 0) / all.length) : null, median: r2(median(all.map(x => x.rate))),
      up, down, flat: all.length - up - down, breadth: all.length ? r2(up / all.length * 100) : null,
      amount, share: marketAmount ? r2(amount / marketAmount * 100) : null,
      top: used.slice().sort((a, b) => b.amount - a.amount)[0]?.id || null,
      items: all.map(x => ({ id: x.id, name: x.name, close: x.close, rate: x.rate, amount: x.amount, share: r2(x.share * 100), weight: x.weight, excluded: x.excluded })),
    };
  });
  const ranked = rows.filter(r => r.score != null).sort((a, b) => b.score - a.score || (b.breadth ?? 0) - (a.breadth ?? 0) || a.name.localeCompare(b.name, 'zh-Hant'));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return [...ranked, ...rows.filter(r => r.score == null).map(r => ({ ...r, rank: null }))];
}
// 名次變動：正數＝名次上升（例如 13 → 4 為 +9）
export function compareRanks(rows, prev) {
  const before = new Map((prev?.groups || []).filter(g => g.rank != null).map(g => [g.id, g.rank]));
  return rows.map(r => ({ ...r, prevRank: before.get(r.id) ?? null, move: r.rank != null && before.has(r.id) ? before.get(r.id) - r.rank : null }));
}
// 快照列 → quotes
export function quotesFromSnapshot(rows, meta) {
  const q = new Map();
  for (const r of rows) { const close = Number(r.close), ch = Number(r.change_price), amt = Number(r.total_amount); if (!(close > 0) || !Number.isFinite(ch) || close - ch <= 0) continue; q.set(r.stock_id, { name: meta.get(r.stock_id)?.name || r.stock_id, close, rate: r2(ch / (close - ch) * 100), amount: amt > 0 ? amt : 0, time: String(r.date).slice(0, 19) }); }
  return q;
}
// 推播排名必須有漲跌與成交額；缺值不能經 Number(null) 變成零漲跌。
export function quotesFromStream(rows, meta) {
  const finite = v => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
  return quotesFromSnapshot(rows.filter(r => [r.close,r.change_price,r.total_amount].every(finite) && Number(r.close) > 0 && Number(r.close)-Number(r.change_price) > 0 && Number(r.total_amount) > 0), meta);
}
const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 比較依據只存於新紀錄；既有收盤檔不回寫、不推定當時的成分範圍。
export function groupRankingRecord(groups, quotes, { date, source, previous = null, provider = null, feed = null, now = Date.now() } = {}) {
  const usable = new Map([...quotes].filter(([,q])=>q && [q.close,q.rate,q.amount].every(Number.isFinite) && q.close>0 && q.amount>0));
  const scope = groups.map(g => [g.id,[...new Set(g.stockIds)].sort()]).sort(([a],[b])=>a.localeCompare(b));
  const ids = [...new Set(scope.flatMap(([,members])=>members))].sort(), quotedIds = ids.filter(id=>usable.has(id));
  const scopeKey = signature(scope), coverageKey = signature(quotedIds);
  const reason = !previous ? 'no-previous' : !previous.scopeKey || !previous.coverageKey ? 'unknown-scope' : previous.scopeKey !== scopeKey ? 'scope-changed' : previous.coverageKey !== coverageKey ? 'coverage-changed' : previous.rules?.minShare !== RANK_RULES.minShare || previous.rules?.minAmount !== RANK_RULES.minAmount ? 'rules-changed' : '';
  const comparison = { compatible: !reason, reason, previousDate: previous?.date || null, previousQuoted: previous?.quoted ?? null, previousStocks: previous?.stocks ?? null };
  const times = quotedIds.map(id=>usable.get(id).time).filter(Boolean).sort();
  return { date, source, asOf:times.at(-1)||null, builtAt:new Date(now).toISOString(), stocks:ids.length, quoted:quotedIds.length, rules:RANK_RULES,
    scope:'research', scopeKey, coverageKey, comparison, compare:previous?{date:previous.date}:null,
    groups:compareRanks(buildGroupRanking(groups,usable),comparison.compatible?previous:null), ...(provider?{provider}:{}), ...(feed?{feed}: {}) };
}
export function historicalRanking(record) {
  if (!record) return null;
  const known = !!record.scopeKey && !!record.coverageKey && !!record.comparison;
  if (known && record.comparison.compatible) return record;
  return { ...record, comparison:known?record.comparison:{compatible:false,reason:'unknown-scope',previousDate:record.compare?.date||null,previousQuoted:null,previousStocks:null},
    groups:(record.groups||[]).map(g=>({...g,prevRank:null,move:null})) };
}
// 研究名單本機日成交資料（TaiwanStockPrice：close、spread、Trading_money）→ quotes；時光機紀錄不完整時補建收盤紀錄，不需請求
export function quotesFromDaily(stocks, date, market = activeMarket()) {
  const q = new Map(), close_ = closeHM(market);
  for (const s of stocks) {
    const r = (s.bars || []).find(b => b.date === date), close = Number(r?.close), sp = Number(r?.spread), amt = Number(r?.Trading_money);
    if (!(close > 0) || !Number.isFinite(sp) || close - sp <= 0) continue;
    q.set(s.id, { name: s.name, close, rate: r2(sp / (close - sp) * 100), amount: amt > 0 ? amt : 0, time: `${date} ${close_}:00` });
  }
  return q;
}
// 時光機畫格 → quotes（補建過去交易日的收盤紀錄）
export function quotesFromReplay(day, meta, frameIndex = day.frames.length - 1) {
  const f = day.frames[frameIndex], q = new Map();
  day.ids.forEach((id, i) => { const p = framePrice(day, f, i), prev = prevPrice(day, i); if (p > 0 && prev > 0) q.set(id, { name: meta.get(id)?.name || id, close: p, rate: r2((p / prev - 1) * 100), amount: frameAmount(day, f, i), time: `${day.date} ${f.t}:00` }); });
  return q;
}
