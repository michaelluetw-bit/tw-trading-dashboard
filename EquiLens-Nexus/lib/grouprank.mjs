import { activeMarket } from './config.mjs';
import { closeHM } from './markets.mjs';
import { framePrice, frameAmount, prevPrice } from './replay.mjs';
import { newerRow } from './intraday.mjs';
// 族群排名：研究總覽各族群成分股的盤中漲幅排名。
// 避免失真：① 低量排除——成交金額低於族群總成交 0.5% 或低於 1,000 萬元者不計入分數（仍列出並標示）；
// ② √成交金額加權——量大者影響較大，但不會讓單一權值股獨大，也不讓冷門股的極端漲幅左右族群。
// ③ minCoverage：族群有報價的成分股比例低於此值時不給分數與名次（預設 0＝不檢查；盤中推播排名用 0.8）
export const RANK_RULES = { minShare: 0.005, minAmount: 1e7, minCoverage: 0 };
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
    const coverage = g.stockIds.length ? all.length / g.stockIds.length : 0, incomplete = coverage < (rules.minCoverage || 0);
    const score = wsum && !incomplete ? used.reduce((s, x) => s + x.rate * Math.sqrt(x.amount), 0) / wsum : null;
    const uAmt = used.reduce((s, x) => s + x.amount, 0);
    const up = all.filter(x => x.rate > 0).length, down = all.filter(x => x.rate < 0).length;
    all.sort((a, b) => b.rate - a.rate);
    return {
      id: g.id, name: g.name, stocks: g.stockIds.length, quoted: all.length, used: used.length, excluded: all.length - used.length,
      coverage: r2(coverage * 100), incomplete,
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

// 盤中行情列：推播與快照各自的健康狀態由呼叫端傳入（推播不健康時，記憶體裡的舊推播列不使用；快照過期時不使用快照）。
// 每檔取行情事件時間（date 欄位）較新的一列，時間相同用推播；只留 date 當日的列。推播健康時，沒有新成交的股票沿用當天最後一筆。
export function liveRowsFor({ ids, date, stream, snap }) {
  const out = [];
  for (const id of ids) {
    const s = stream?.healthy ? stream.rowOf(id) : null, f = snap?.fresh ? snap.rowOf(id) : null;
    const today = r => r && String(r.date).slice(0, 10) === date ? r : null;
    const r = newerRow(today(s), today(f));
    if (r) out.push(r);
  }
  return out;
}

// 收盤紀錄要不要寫、寫哪一版：盤中來源（時光機、快照、推播）只能寫暫定版；只有正式日資料（覆蓋率 ≥ 80%）能定稿；已定稿不再改寫
export const CLOSE_MIN_COVERAGE = 0.8;
export function closeRecordPlan({ existing, provisional, final }) {
  if (existing?.source === 'close') return { write: null };
  if (final && final.coverage >= CLOSE_MIN_COVERAGE) return { write: 'final', revise: existing?.source === 'close-provisional' };
  if (existing?.source === 'close-provisional') return { write: null };
  if (provisional && provisional.coverage >= CLOSE_MIN_COVERAGE) return { write: 'provisional', basis: provisional.basis };
  return { write: null };
}
