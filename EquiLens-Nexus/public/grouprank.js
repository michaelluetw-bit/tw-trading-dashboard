// 族群排名頁：研究總覽各族群的盤中漲幅排名（低量排除＋√成交金額加權），與前一交易日收盤紀錄比較名次。
import * as MK from './market.js';
import { groupRankNotice, canCompareGroupRank, currentGroupRank, groupRankFailed, createGroupRankLoader } from './group-rank-source.js';
let C = null; // { api, toast, redraw, page, openStock, inScope, esc }
const G = { live: null, record: null, dates: [], view: 'live', loading: false, error: '', open: new Set(), loaded: false, auto: true };
export function initGroupRank(ctx) { C = ctx; }
const loadRanking=createGroupRankLoader({request:()=>C.api('grouprank/query',{}),today:()=>MK.today(),receive:d=>{G.live=d;},fail:e=>{G.live=groupRankFailed(G.live);G.error=e.message;}});
const fmt = (v, n = 2) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n });
const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}%`;
const cls = v => v == null || v === 0 ? 'muted' : v > 0 ? 'up' : 'down';
const yi = v => v == null ? '—' : fmt(v / 1e8, v >= 1e10 ? 0 : 1);
const md = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
const twOpen = () => MK.isOpen();
const repaint = () => { if (C.page() !== 'grouprank') return; const pc = document.getElementById('pagecontent'); if (pc) { const y = window.scrollY; pc.innerHTML = groupRankPage(); window.scrollTo(0, y); } else C.redraw(); };

export async function enterGroupRank() {
  if (!G.loaded) { G.loaded = true; try { const r = await C.api('grouprank'); G.record = r.record; G.dates = r.dates; if (r.live) G.live = currentGroupRank(r.live,MK.today()); } catch (e) { G.error = e.message; } }
  if (!G.live || twOpen()) await query(true); else repaint();
}
async function query(quiet = false) {
  if (G.loading) return; G.loading = true; G.error = ''; if (!quiet) repaint();
  await loadRanking(); if (!quiet && !G.error) C.toast('族群排名已更新');
  G.loading = false; repaint();
}
// 盤中開著此頁時每 30 秒自動更新
setInterval(() => { if (C && G.auto && G.view === 'live' && C.page() === 'grouprank' && !document.hidden && (twOpen()||G.live?.provider==='shioaji'&&G.live.source==='live')) query(true); }, 30000);

export function moveBadge(move, prevRank) {
  if (move == null) return prevRank == null ? '<span class="fr-mv new" title="前一交易日收盤無此族群排名">—</span>' : '';
  if (move === 0) return `<span class="fr-mv flat" title="前一交易日收盤第 ${prevRank} 名">－ 0</span>`;
  return move > 0 ? `<span class="fr-mv up" title="前一交易日收盤第 ${prevRank} 名">▲ +${move}</span>` : `<span class="fr-mv down" title="前一交易日收盤第 ${prevRank} 名">▼ ${move}</span>`;
}
export function groupRankPage() {
  const esc = C.esc, d = G.view === 'live' ? currentGroupRank(G.live,MK.today()) : G.record;
  const max = Math.max(0.5, ...(d?.groups || []).filter(g => g.score != null).map(g => Math.abs(g.score)));
  const head = `<section class="panel heat-controls"><button class="primary" data-gr="query" ${G.loading ? 'disabled' : ''}>${G.loading ? '<i class="spinner"></i>更新中…' : '⟳ 更新排名'}</button>
    <select data-gr-date aria-label="收盤紀錄"><option value="live" ${G.view === 'live' ? 'selected' : ''}>即時排名</option>${G.dates.slice().reverse().map(x => `<option value="${x}" ${G.view === x ? 'selected' : ''}>${x} 收盤紀錄</option>`).join('')}</select>
    <label class="checkbox"><input type="checkbox" data-gr-auto ${G.auto ? 'checked' : ''}>盤中每 30 秒自動更新</label><span class="spacer"></span><span class="fine">排名依「量能加權漲幅」· 收盤後自動存收盤紀錄</span></section>`;
  const meta = d ? `<div class="notice"><span>${d.source === 'live' ? '盤中排名' : `<b>${esc(d.date)}</b> 收盤`} · 行情時間 <b class="mono">${esc(d.asOf?String(d.asOf).slice(5,19).replace('-','/').replace('T',' '):'—')}</b> · 取得 <b class="mono">${d.quoted}</b> / ${d.stocks} 檔成分股${canCompareGroupRank(d) ? ` · 名次變動對照 <b class="mono">${md(d.compare.date)}</b> 收盤` : ' · 未顯示名次變動'}</span><span class="tag cyan">低量排除＋√成交金額加權</span></div>` : '';
  const rows = (d?.groups || []).map(g => {
    const open = G.open.has(g.id), lead = g.items?.find(x => !x.excluded), top = g.items?.find(x => x.id === g.top);
    const bar = g.score == null ? '' : `<span class="fr-bar"><i class="${g.score >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(g.score) / max * 50}%;${g.score >= 0 ? 'left:50%' : 'right:50%'}"></i></span>`;
    const breadth = g.breadth == null ? '' : `<span class="gr-breadth" title="上漲 ${g.up}／平 ${g.flat}／下跌 ${g.down}"><i class="u" style="width:${g.up / (g.quoted || 1) * 100}%"></i><i class="f" style="width:${g.flat / (g.quoted || 1) * 100}%"></i><i class="d" style="width:${g.down / (g.quoted || 1) * 100}%"></i></span>`;
    return `<tr class="fr-row ${g.score == null ? 'none' : ''}" data-gr-group="${esc(g.id)}"><td class="rank">${g.rank ?? '—'}</td><td>${canCompareGroupRank(d)?moveBadge(g.move,g.prevRank):'<span class="fr-mv new" title="無法確認同範圍">—</span>'}</td><td class="fr-name"><strong>${esc(g.name)}</strong><small>${open ? '▾' : '▸'} 涵蓋 ${g.quoted} / ${g.stocks} 檔 · ${g.used} 檔計入${g.excluded ? ` · ${g.excluded} 檔低量排除` : ''}</small></td>
      <td class="num ${cls(g.score)}"><b>${pct(g.score)}</b></td><td class="fr-barcell">${bar}</td>
      <td class="num ${cls(g.wavg)}">${pct(g.wavg)}</td><td class="num ${cls(g.avg)}">${pct(g.avg)}</td>
      <td class="gr-bcell">${breadth}<small class="num"><span class="up">${g.up}</span>/<span class="down">${g.down}</span> · ${fmt(g.breadth, 0)}%</small></td>
      <td class="num">${yi(g.amount)} 億<small style="display:block" class="muted">${fmt(g.share, 1)}%</small></td>
      <td class="fr-lead">${lead ? `<span class="${cls(lead.rate)}">${esc(lead.name)} ${pct(lead.rate)}</span>` : ''}${top ? `<small style="display:block" class="muted">權重最大 ${esc(top.name)} ${pct(top.rate)}</small>` : ''}</td></tr>
      ${open && g.items?.length ? `<tr class="fr-detail"><td colspan="10"><div class="gr-items"><div class="gr-ih"><span>成分股</span><span>漲跌幅</span><span>成交（億）</span><span>占族群</span><span>權重</span></div>${g.items.map(x => `<button class="gr-item ${x.excluded ? 'ex' : ''}" data-gr-stock="${esc(x.id)}"><span>${esc(x.name)} <small class="mono">${esc(x.id)}</small>${x.excluded ? '<em class="ix-badge warn">低量排除</em>' : ''}</span><span class="num ${cls(x.rate)}">${pct(x.rate)}</span><span class="num">${yi(x.amount)}</span><span class="num">${fmt(x.share, 1)}%</span><span class="num">${x.excluded ? '—' : fmt(x.weight, 1) + '%'}</span></button>`).join('')}</div></td></tr>` : ''}`;
  }).join('');
  const table = d ? `<section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>族群排名</h2><p>研究總覽 ${d.groups.length} 個族群 · 點族群展開成分股與權重 · 紅色 ▲ 名次上升、綠色 ▼ 名次下降</p></div></div><div class="tablewrap"><table class="fr-table gr-table"><thead><tr><th>名次</th><th>變動</th><th style="text-align:left">族群</th><th title="排名依據">量能加權漲幅</th><th></th><th title="純成交金額加權（參考）">成交加權</th><th title="所有成分股簡單平均（參考，易受冷門股影響）">簡單平均</th><th>漲跌家數</th><th>成交金額</th><th style="text-align:left">領漲 · 權重最大</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
    : `<section class="panel empty">${G.loading ? '<p><i class="spinner"></i>計算族群排名…</p>' : '<h3>尚無排名資料</h3><p>按「更新排名」取得各族群目前的漲幅排名。</p><button class="primary" data-gr="query">⟳ 更新排名</button>'}</section>`;
  const r = d?.rules || { minShare: 0.005, minAmount: 1e7 };
  return head + (G.error ? `<div class="notice err"><span>${esc(G.error)}</span></div>` : '') + groupRankNotice(d) + meta + table
    + `<details class="panel contentpad" style="margin-top:16px"><summary>計算方式：如何避免冷門股或權值股造成失真</summary><p><b>問題：</b>簡單平均會被成交量極小、卻大漲（例如漲停）的冷門股拉高；純成交金額加權則容易被單一權值股主導，整個族群只反映一檔股票。</p><p><b>① 低量排除：</b>成交金額低於族群總成交 ${fmt(r.minShare * 100, 1)}%，或低於 ${fmt(r.minAmount / 1e4, 0)} 萬元的成分股不計入排名分數（明細中標示「低量排除」）。</p><p><b>② √成交金額加權：</b>量能加權漲幅 ＝ Σ（漲幅 × √成交金額）÷ Σ√成交金額。量大的股票影響較大，但影響力隨成交額的平方根遞增，不會讓單一權值股獨占，也不會讓冷門股左右族群。</p><p>同分時依上漲家數比排序。「成交加權」與「簡單平均」僅供對照：兩者與排名分數差距很大時，代表族群內漲跌分歧或由少數個股主導。成交金額占比為該族群占全部研究族群合計成交的比重。</p><p>收盤紀錄：每個交易日收盤 5 分鐘後以收盤資料自動存檔（優先使用時光機的收盤畫格，不需額外請求），隔日的名次變動即對照前一交易日收盤。</p></details>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-gr],[data-gr-group],[data-gr-stock]'); if (!b || !C) return;
  try {
    if (b.dataset.gr === 'query') { G.view = 'live'; return await query(); }
    if (b.dataset.grStock) { await C.openStock(b.dataset.grStock); return; }
    if (b.dataset.grGroup) { const id = b.dataset.grGroup; G.open.has(id) ? G.open.delete(id) : G.open.add(id); return repaint(); }
  } catch (err) { C.toast(err.message); }
});
document.addEventListener('change', async e => {
  if (!C) return;
  if (e.target.matches?.('[data-gr-auto]')) { G.auto = e.target.checked; return; }
  if (!e.target.matches?.('[data-gr-date]')) return;
  G.view = e.target.value;
  if (G.view !== 'live') { try { const r = await C.api('grouprank?date=' + G.view); G.record = r.record; } catch (err) { G.error = err.message; } }
  repaint();
});
