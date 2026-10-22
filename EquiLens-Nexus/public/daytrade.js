import { quoteProviderName } from './quote-source.js';
// 衡析 Nexus：當沖掃描面板（盤中雷達頁）— 即時推播狀態、當沖分數 Top N、排除統計、收盤後訊號檢討、當沖監控設定。
// 資料：/api/daytrade（每 3 秒）、/api/daytrade/review、/api/daytrade/settings。只有設定了支援即時推播的資料源（例如富果）才顯示。
import { esc, fmt, pct, cls } from './insight-ui.js';
import * as MK from './market.js';

let X = null; // { api, toast, repaint, isLive }
const D = { info: null, review: null, tab: 'scan', draft: null, error: '', at: 0 };
export function initDaytrade(ctx) { X = ctx; }
export const dtCapable = () => !!D.info?.capable;
export async function loadDaytrade() { try { D.info = await X.api('daytrade'); D.at = Date.now(); D.error = ''; if (!D.draft) D.draft = structuredClone(D.info.settings); } catch (e) { D.error = e.message; } }
async function loadReview() { try { D.review = await X.api('daytrade/review'); } catch (e) { D.error = e.message; } }
// 五檔錄製（/api/books）：錄製狀態、換股紀錄、匯出 CSV、設定
const B = { info: null, draft: null, date: '', stocks: null, id: '' };
async function loadBooks() {
  try {
    B.info = await X.api('books'); if (!B.draft) B.draft = structuredClone(B.info.settings);
    const dates = B.info.days.map(x => x.date); if (!dates.includes(B.date)) { B.date = dates[0] || ''; B.stocks = null; }
    if (B.date && !B.stocks) B.stocks = (await X.api('books/stocks?date=' + B.date)).stocks;
  } catch (e) { D.error = e.message; }
}
// 盤中且推播運作時每 3 秒更新；其餘時間 30 秒
setInterval(async () => {
  if (!X || document.hidden || !X.isLive()) return;
  const live = D.info?.feed?.active && MK.isOpen();
  if (!live && Date.now() - D.at < 30e3) return;
  await loadDaytrade(); if (D.tab === 'scan') X.repaint();
  if (D.tab === 'books' && Date.now() - (B.at || 0) > 10e3) { B.at = Date.now(); await loadBooks(); X.repaint(); }
}, 3000);

const PLAN_NAMES = { basic: '基本', developer: '開發者', advanced: '進階' };
const FILTERS = { noDayTrade: '不可當沖', disposition: '處置', suspended: '暫停交易', spread: '價差過大', liquidity: '流動性不足', limitUp: '已漲停' };
const PARTS = [['daily', '日 K', 20, 'var(--amber)'], ['hour', '60 分 K', 25, 'var(--cyan)'], ['five', '5 分 K', 30, 'var(--magenta)'], ['book', '五檔', 25, 'var(--violet)']];
const SIG = { 'dt-breakout': '💥 爆量突破', 'dt-vwap': '📈 VWAP 延續', 'dt-bid': '🟢 五檔增強', 'dt-weak': '⚠️ 多單轉弱', 'dt-risk': '🛑 參考停損' };
const n0 = v => v == null ? '—' : fmt(v, 0), n1 = v => v == null ? '—' : fmt(v, 1), n2 = v => v == null ? '—' : fmt(v, 2);
// 大盤環境紀錄（只記錄，不影響分數、門檻與推播）
const REGIME = { tailwind: '順風', neutral: '中性', headwind: '逆風', none: '未記錄' };
const REGIME_TAG = { tailwind: '大盤順風', neutral: '大盤中性', headwind: '大盤逆風' };
const STRENGTH = { strong: '強於大盤', weak: '弱於大盤', none: '未記錄' };
const INDEX_NAME = { twse: '加權', tpex: '櫃買' };
const MK_REASON = { exchange: '非上市櫃', noIndex: '沒有指數資料', stale: '指數資料過期', warmup: '開盤未滿 15 分鐘' };
function marketLine(mk) {
  if (!mk) return '';
  const one = k => {
    const x = mk[k]; if (!x) return `<span>${INDEX_NAME[k]} <span class="muted">等待指數資料</span></span>`;
    const state = x.stale ? '<b class="warn">資料過期</b>' : x.regime ? `<b>${REGIME[x.regime]}</b>` : '<span class="muted">累積中</span>';
    return `<span title="近 15 分鐘 ${pct(x.r15)} · 日內均價 ${n2(x.avg)}${x.up != null ? ` · 上漲 ${fmt(x.up)}／下跌 ${fmt(x.down)} 家` : ''}">${INDEX_NAME[k]} <b class="mono ${cls(x.chg)}">${pct(x.chg)}</b> · 15 分 <span class="mono ${cls(x.r15)}">${pct(x.r15)}</span>${x.vsAvg == null ? '' : x.vsAvg >= 0 ? ' · 均價之上' : ' · 均價之下'} · ${state}</span>`;
  };
  return `<div class="dt-status"><b>大盤環境（只記錄）</b>${one('twse')}${one('tpex')}</div>`;
}

function feedLine(d) {
  const f = d.feed, plan = PLAN_NAMES[d.plan] || d.plan || '—', lim = d.plans?.[d.plan]?.limit;
  if (!f.window) return '<span>非盤中 · 平日開盤前 10 分鐘自動連線並確認訂閱</span>';
  if (!f.connected) return `<span class="warn">${f.authFailed ? '金鑰無效或方案不支援（10 分鐘後重試）' : f.error ? `即時推播未連線：${esc(f.error === 'no-heartbeat' ? '連線逾時，重新連線中' : f.error)}` : '即時推播連線中…'}</span>`;
  const mode = f.mode === 'full' ? '完整模式：逐筆成交＋1 分 K＋五檔' : '精簡模式：聚合行情';
  // 連線（或斷線重連）後 30 秒內仍在逐批訂閱，顯示「重新訂閱中」；超過 30 秒還不足才是真的訂閱不足
  const short = f.subscribed < f.expected ? (f.since && Date.now() - f.since < 30e3 ? ' <b>重新訂閱中…</b>' : ' <b class="warn">訂閱不足</b>') : '';
  const hm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5), lastDrop = f.drops?.at(-1);
  const drops = f.dropCount ? `<span class="${f.dropCount >= 5 ? 'warn' : ''}" title="${esc((f.drops || []).map(x => `${hm(x.at)} 連線 ${x.conns.join('、') || '—'}：${x.reason === 'no-heartbeat' ? '超過 75 秒沒有訊息' : x.reason === 'close' ? '伺服器關閉連線' : x.reason}`).join(' · '))}">今日斷線重連 ${f.dropCount} 次（最近 ${hm(lastDrop.at)}）</span>` : '';
  return `<span>⚡ ${mode}</span><span>${esc(quoteProviderName(f.provider))}${f.provider==='shioaji'?'':` ${esc(plan)}方案`}${lim ? `（上限 ${fmt(lim)}）` : ''}</span><span>訂閱 <b class="mono">${fmt(f.subscribed)}／${fmt(f.expected)}</b>${f.connections?.length > 1 ? `（${f.connections.length} 條連線）` : ''}${short}</span>${drops}${f.backfill?.busy ? `<span class="warn">斷線補資料中 ${f.backfill.done}／${f.backfill.total}</span>` : ''}${d.fallback ? '<span class="warn">訂閱數不足，今天改用精簡模式</span>' : ''}`;
}
function prepLine(d) {
  const p = d.prep, base = '';
  if (!p) return `<span>盤前資料（可當沖標的、處置股、參考價）於開盤前 30 分鐘取得</span>${base}`;
  return `<span>${p.eligible == null ? '<b class="warn">可當沖清單未取得</b>' : `可當沖 <b class="mono">${fmt(p.eligible)}</b> 檔`}</span><span>處置 <b class="mono">${p.disposition}</b></span><span>暫停交易 <b class="mono">${p.suspended}</b></span><span>暫停先賣後買 <b class="mono">${p.sellFirstOff}</b></span><span>參考價 <b class="mono">${fmt(p.ref)}</b> 檔</span>${p.errors?.length ? `<span class="warn" title="${esc(p.errors.join('\n'))}">部分盤前資料取得失敗</span>` : ''}${base}`;
}
function scoreBar(x) {
  return `<span class="dt-bar" title="${PARTS.map(([k, l, max]) => `${l} ${x.part?.[k] ?? 0}／${max}`).join(' · ')}">${PARTS.map(([k, , , c]) => `<i style="width:${(x.part?.[k] || 0)}%;background:${c}"></i>`).join('')}</span><b class="mono">${n1(x.score)}</b>`;
}
const REASONS = { hourStale: '60 分 K 尚未補齊', eligibility: '尚未取得可當沖資格', history: '30 日歷史不足', fullFeed: '需完整推播', fiveMinute: '等待完整 5 分 K', quoteStale: '成交已過期', vwap: '等待有效 VWAP', bookPending: '等待五檔連續確認', volumeHistory: '同時段歷史量不足', priceBasis: '參考價與歷史口徑待確認', subscription: '超出訂閱範圍', waitingQuote: '等待報價' };
function row(x, i) {
  const c = x.context || {}, d = c.daily || {}, h = c.hour || {}, f = c.five || {}, b = c.book || {};
  const waiting = [...(x.pending ? ['補資料中'] : []), ...(c.reasons || []).map(k => REASONS[k] || k), ...(x.filters || []).map(k => FILTERS[k] || k)];
  const state = waiting.length ? waiting.join('、') : c.conditions && Object.values(c.conditions).some(Boolean) ? '條件確認' : '持續觀察';
  return `<tr data-kbar-row="${esc(x.id)}"><td><b>${esc(x.name)}</b><small class="mono"> ${esc(x.id)}</small></td>
    <td class="mono ${cls(x.change)}">${n2(x.price)}<small> ${pct(x.change)}</small></td>
    <td><span class="${waiting.length ? 'warn' : ''}">${esc(state)}</span><small>${scoreBar(x)}</small></td>
    <td>${d.long ? '偏多' : d.count === 30 ? '未偏多' : '不足'}<small>${d.count || 0}/30 · MA20 ${n2(d.ma20)}</small></td>
    <td>${h.long ? '偏多' : h.count >= 21 ? '未偏多' : '不足'}<small>MA20 ${n2(h.ma20)}</small></td>
    <td class="mono">${n1(f.volumeRatio)}x<small>支撐 ${n2(f.support)} · 壓力 ${n2(f.resistance)}</small></td>
    <td class="mono">${n2(b.obi)}<small>Δ ${n2(b.delta)} · ${b.age == null ? '—' : n1(b.age)}s</small></td>
    <td class="mono">${n2(x.reference?.stop)}<small>VWAP ${n2(x.vwap)}</small></td>
    <td>${x.last ? `${SIG[x.last.type] || esc(x.last.type)}<small>${esc(x.last.t)}</small>` : '—'}</td></tr>`;
}
function scanView(d) {
  const list = [...d.top, ...(d.watched || []).filter(x => !d.top.some(y => y.id === x.id))];
  const hs = d.history || [], ready = hs.filter(x => x.status === 'ready').length;
  return `${marketLine(d.market)}<div class="dt-status"><b>30 日日 K → 60 分 K → 5 分 K → 即時五檔</b><span>歷史就緒 ${ready}/${hs.length}</span><span>${d.scope === 'watchlist' ? '只掃描自選股' : `掃描全部研究族群＋自選 ${fmt(d.total || 0)} 檔（自選優先）`}；新增股票自動準備資料</span>${d.displayMin ? `<span>只顯示 ${d.displayMin} 分以上${d.hidden ? `（未達 ${fmt(d.hidden)} 檔）` : ''}</span>` : ''}</div>
    ${hs.filter(x => x.error).map(x => `<p class="notice warn">${esc(x.id)} · ${esc(x.error)}</p>`).join('')}
    ${list.length ? `<div class="dt-table"><table><tr><th>股票</th><th>現價</th><th>監控狀態／排序分數</th><th>30 日日 K</th><th>60 分 K</th><th>5 分 K 量比／結構</th><th>五檔／變化／秒數</th><th>參考停損</th><th>最近警示</th></tr>${list.map(row).join('')}</table></div>` : `<div class="empty">${d.displayMin && d.total ? `目前沒有 ${d.displayMin} 分以上的股票，達到後會自動出現（每秒更新）。` : '請先將股票加入觀察名單。'}</div>`}
    <p class="dt-foot">做多須通過四層確認；風險提醒不受分數門檻限制。參考停損來自先前訊號的 5 分 K 低點下一檔，不代表實際持倉或已送出委託。</p>
    <p class="dt-foot">只使用已完成 K 棒；五檔連續 30 秒、每筆間隔不超過 10 秒。分數僅供排序，門檻尚未經歷史五檔回放驗證。</p>`;
}
const rv = x => x == null ? '—' : `<span class="${cls(x)}">${x > 0 ? '+' : ''}${fmt(x, 2)}%</span>`;
const statCells = x => `<td class="mono">${x.n}</td><td class="mono">${x.win15 == null ? '—' : x.win15 + '%'}</td><td class="mono">${rv(x.r15)}</td><td class="mono">${rv(x.r30)}</td><td class="mono">${rv(x.rClose)}</td><td class="mono">${rv(x.mfe)}／${rv(x.mae)}</td>`;
// 依訊號當下的大盤環境、相對強弱分組（v2 做多訊號）
function marketReview(r) {
  const mk = r.market; if (!mk?.signals) return '';
  const head = (label) => `<tr><th>${label}</th><th>次數</th><th>15 分鐘勝率</th><th>15 分鐘</th><th>30 分鐘</th><th>持有到收盤</th><th>最大有利／不利</th></tr>`;
  const regimes = `<div class="dt-table"><table>${head('大盤環境')}${mk.regimes.filter(x => x.n || x.key !== 'none').map(x => `<tr><td>${REGIME[x.key]}</td>${statCells(x)}</tr>`).join('')}</table></div>`;
  const strength = `<div class="dt-table"><table>${head('相對強弱')}${mk.strength.filter(x => x.n || x.key !== 'none').map(x => `<tr><td>${STRENGTH[x.key]}</td>${statCells(x)}</tr>`).join('')}</table></div>`;
  const v2 = r.types.filter(x => x.regimes), cell = x => x?.n ? `${x.n} 則 · ${x.win15 == null ? '—' : x.win15 + '%'} · ${rv(x.r15)}` : '—';
  const byType = v2.length ? `<div class="dt-table"><table><tr><th>訊號（次數 · 15 分鐘勝率 · 15 分鐘）</th><th>順風</th><th>中性</th><th>逆風</th></tr>${v2.map(x => `<tr><td>${esc(x.title)}</td><td class="mono">${cell(x.regimes.tailwind)}</td><td class="mono">${cell(x.regimes.neutral)}</td><td class="mono">${cell(x.regimes.headwind)}</td></tr>`).join('')}</table></div>` : '';
  return `<h4 class="dt-sub">依大盤環境分組（只記錄，不影響訊號）</h4>${regimes}${strength}${byType}
    <p class="dt-foot">上市股對照加權指數、上櫃股對照櫃買指數，以訊號當下判斷。順風＝指數在日內均價之上且近 15 分鐘未下跌；逆風＝在均價之下且近 15 分鐘下跌，或近 15 分鐘跌幅達 0.5%；其餘為中性。相對強弱＝個股近 15 分鐘漲跌減指數近 15 分鐘漲跌。</p>
    <p class="dt-foot">${mk.since ? `從 ${esc(mk.since)} 開始記錄，v2 做多訊號 ${mk.signals} 則中有 ${mk.recorded} 則有完整大盤資料` : '尚無大盤紀錄（這個版本之後的訊號才會記錄）'}。各組累積到數十則以上再比較；組間差異不明顯時，不需要加入大盤條件。</p>`;
}
function reviewView() {
  const r = D.review; if (!r) return '<div class="empty"><span class="spinner"></span></div>';
  if (!r.signals) return `<div class="empty"><p>尚無訊號紀錄。每個交易日收盤後，系統會以分 K 檢討當天的當沖訊號。</p></div>`;
  const table = `<div class="dt-table"><table><tr><th>訊號</th><th>次數</th><th>15 分鐘勝率</th><th>5 分鐘</th><th>15 分鐘</th><th>30 分鐘</th><th>持有到收盤</th><th title="30 分鐘內最大有利／不利幅度（未扣成本）">最大有利／不利</th></tr>
    ${r.types.map(x => `<tr><td>${esc(x.title)} <small>v${x.version || 1}</small></td><td class="mono">${x.n}</td><td class="mono">${x.win15 == null ? '—' : x.win15 + '%'}</td><td class="mono">${rv(x.r5)}</td><td class="mono">${rv(x.r15)}</td><td class="mono">${rv(x.r30)}</td><td class="mono">${rv(x.rClose)}</td><td class="mono">${rv(x.mfe)}／${rv(x.mae)}</td></tr>`).join('')}</table></div>`;
  const mkTag = s => s.version !== 2 ? '' : s.regime ? `<span>${REGIME_TAG[s.regime]}</span>${s.market?.rs15 != null ? `<span class="mono">相對大盤 ${pct(s.market.rs15)}</span>` : ''}` : `<span class="muted">${MK_REASON[s.market?.reason] || '大盤未記錄'}</span>`;
  const recent = r.recent.map(d => `<details class="dt-day"><summary>${esc(d.date)} · ${d.signals.length} 則${d.mode === 'lite' ? ' · 精簡模式' : ''}</summary>${d.signals.map(s => `<div class="dt-sig"><span class="mono">${esc(s.t?.slice(0, 5))}</span><b>${esc(s.name)}</b> <small class="mono">${esc(s.id)}</small><span>${SIG[s.type] || esc(s.title)}</span><span class="mono">${n2(s.price)}</span><span class="mono">15 分 ${rv(s.purpose === 'risk' ? null : s.outcome?.r15)}</span><span class="mono">收盤 ${rv(s.outcome?.rClose)}</span>${mkTag(s)}</div>`).join('')}</details>`).join('');
  return `${table}<p class="dt-foot">共 ${r.days} 個交易日、${r.signals} 則訊號。淨報酬以訊號價加滑價買進、到時以收盤價減滑價賣出，已扣除手續費與證交稅（來回約 ${fmt(r.cost, 3)}%）；樣本少時僅供參考。</p>${marketReview(r)}${recent}`;
}
function settingsView(d) {
  const s = D.draft || d.settings, plans = d.plans || {}, need = d.need || {};
  const sel = (key, opts, fmtv = v => v) => `<select data-dtset="${key}">${opts.map(v => `<option value="${v}" ${String(key.split('.').reduce((o, k) => o?.[k], s)) === String(v) ? 'selected' : ''}>${fmtv(v)}</option>`).join('')}</select>`;
  const chk = (key, label) => `<label class="lv-rule"><input type="checkbox" data-dtset="${key}" ${key.split('.').reduce((o, k) => o?.[k], s) ? 'checked' : ''}><span>${label}</span></label>`;
  const advice = `掃描 ${fmt(need.scanned || 0)} 檔（自選 ${need.watched || 0} 檔優先），每檔需要 3 個訂閱；不足時顯示等待，不發做多警示`;
  return `<div class="lv-settings">
    ${chk('enabled', '啟用當沖監控（盤中掃描、當沖訊號推播、收盤檢討）')}
    ${d.feed?.provider==='shioaji'?'<p class="dt-foot">Shioaji 行情轉接：固定精簡模式，每檔 1 個訂閱，上限 200 檔。</p>':`<label class="dt-field"><span>富果方案</span>${sel('plan', ['auto', 'advanced', 'developer', 'basic'], v => ({ auto: '自動判斷', advanced: '進階（2,000 訂閱）', developer: '開發者（300 訂閱）', basic: '基本（5 訂閱）' })[v])}</label>`}
    <p class="dt-foot">${d.feed?.provider==='shioaji'?'目前來源沒有完整多週期歷史，不會因為即時看板有報價就判定當沖條件就緒。':`${advice}。自動判斷時先嘗試完整模式，訂閱不足就當天改用精簡模式。`}</p>
    <label class="dt-field"><span>掃描範圍</span>${sel('scope', ['all', 'watchlist'], v => ({ all: '全部研究族群＋自選', watchlist: '只掃自選' })[v])}</label>
    <p class="dt-foot">${d.feed?.provider==='shioaji'?'Shioaji 行情轉接不提供 30 日歷史或 REST 補資料；缺項維持等待，不發做多確認。':'全部研究族群時，30 日歷史資料每天開盤前首次載入約需 20 分鐘（富果歷史 API 每分鐘 60 次），自選股優先；載入完成前的股票顯示等待，不發做多警示。'}</p>
    <label class="dt-field"><span>顯示前幾名</span>${sel('top', [10, 20, 30])}<span>顯示門檻</span>${sel('displayMin', [0, 50, 60, 70, 80, 90], v => v ? `${v} 分以上` : '全部顯示')}</label>
    <p class="dt-foot">顯示門檻只決定掃描清單顯示哪些股票，不影響訊號與推播（訊號看「訊號分數門檻」）。</p>
    <label class="dt-field"><span>訊號分數門檻</span>${sel('minScore', [40, 50, 60, 70, 80])}</label>
    ${chk('signals.breakout', '💥 多週期突破：日 K、60 分 K 偏多，5 分 K 放量突破，五檔確認')}
    <label class="dt-field sub"><span>前幾分鐘高點</span>${sel('breakoutLookback', [10, 15, 20, 30], v => `${v} 分鐘`)}<span>量倍數</span>${sel('breakoutVolume', [1.5, 2, 3], v => `${v} 倍`)}</label>
    ${chk('signals.vwap', '📈 回測轉強：多週期偏多，5 分 K 回測 VWAP 後突破前棒高點，五檔確認')}
    ${chk('signals.bid', '🟢 五檔增強：多週期偏多，5 分 K 價量向上且委買不平衡持續增加')}
    ${chk('signals.weak', '⚠️ 多單轉弱：5 分 K 跌破支撐與 VWAP，五檔賣壓確認')}
    ${chk('signals.risk', '🛑 參考停損：成交價跌破先前做多訊號的參考停損，即時提醒一次')}
    <label class="dt-field"><span>開盤觀察至</span>${sel('watchFrom', ['09:05', '09:10', '09:15', '09:30'])}<span>停止做多提醒</span>${sel('stopNew', ['12:30', '13:00', '13:10', '13:20'])}</label>
    <label class="dt-field"><span>價差上限</span>${sel('maxSpreadTicks', [2, 3, 5], v => `${v} 檔價位`)}<span>近 20 日均額至少</span>${sel('minDailyAmount', [0, 50e6, 100e6, 300e6, 500e6], v => v ? `${fmt(v / 1e8, 1)} 億` : '不限')}</label>
    <label class="dt-field"><span>手續費折扣</span>${sel('costs.feeDiscount', [1, 0.6, 0.5, 0.38, 0.28, 0.2], v => v === 1 ? '無折扣' : `${+(v * 10).toFixed(1)} 折`)}<span>證交稅</span>${sel('costs.taxRate', [0.0015, 0.003], v => `${fmt(v * 100, 2)}%`)}<span>滑價</span>${sel('costs.slipTicks', [0, 1, 2], v => `${v} 檔價位`)}</label>
    <p class="dt-foot">現股當沖證交稅目前減半為 0.15%（至 2027 年底）；滑價與成本只用於訊號檢討的淨報酬計算。</p>
    <div class="form-actions"><button class="primary" data-dtsave>儲存當沖監控設定</button></div></div>`;
}
function booksView() {
  const b = B.info; if (!b) return '<div class="empty"><span class="spinner"></span></div>';
  const s = B.draft || b.settings, td = b.today, st = b.stats, mb = v => fmt(v / 1048576, 1) + ' MB';
  const status = !s.enabled ? '<span>五檔錄製已關閉</span>' : b.recording && td
    ? `<span>⏺ 錄製中</span><span>推播清單 <b class="mono">${fmt(td.main)}</b> 檔（五檔＋逐筆）</span><span>加錄 <b class="mono">${fmt(td.extras)}</b> 檔（只錄五檔，訂閱 ${fmt(td.subscribed)}／${fmt(td.extras)}）</span>${st ? `<span>五檔變動 <b class="mono">${fmt(st.books)}</b> · 成交 <b class="mono">${fmt(st.trades)}</b> · 原始 ${mb(st.bytes)}</span>` : ''}${td.liquidityDays ? '' : '<span class="warn">時光機沒有紀錄，開盤前無法挑選加錄股票（盤中換股仍會加錄）</span>'}${td.gap ? '<span class="warn">推播曾中斷，收盤後以 REST 補齊逐筆成交</span>' : ''}`
    : `<span>非盤中 · 平日開盤前 10 分鐘隨即時推播開始錄製</span>${b.busy ? `<span class="warn">收盤整理中${td?.fill ? `：補逐筆成交 ${td.fill.done}／${td.fill.total}` : ''}</span>` : ''}`;
  const swaps = td?.swaps?.length ? `<details class="dt-day"><summary>今日換股 ${td.swaps.length} 次（累計錄過 ${fmt(td.ever)} 檔加錄股票）</summary>${td.swaps.map(w => `<div class="dt-sig"><span class="mono">${esc(w.at.slice(0, 5))}</span><span>加錄 <b class="mono">${w.added.length}</b></span><span>移除 <b class="mono">${w.dropped.length}</b></span>${w.sectors.length ? `<span>族群轉強：${w.sectors.map(esc).join('、')}</span>` : ''}<small class="mono">${w.added.slice(0, 12).map(esc).join(' ')}${w.added.length > 12 ? ' …' : ''}</small></div>`).join('')}</details>` : '';
  const opts = (B.stocks || []).map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.main ? '' : '（加錄）'}${x.books != null ? ` · 五檔 ${x.books} · 成交 ${x.trades}` : ''}</option>`).join('');
  const exp = b.days.length ? `<div class="dt-field"><span>匯出日期</span><select data-bkdate>${b.days.map(x => `<option value="${x.date}" ${x.date === B.date ? 'selected' : ''}>${x.date}${x.compacted ? '' : '（整理前）'}</option>`).join('')}</select>
      <span>股票代號</span><input data-bkid list="bk-stocks" value="${esc(B.id)}" placeholder="例如 3406" size="10" autocomplete="off"><datalist id="bk-stocks">${opts}</datalist><button class="primary" data-bkexport>下載 CSV</button></div>
    <p class="dt-foot">每次五檔變動與每筆成交各一列，成交列附上當下的五檔（委買／委賣各 5 檔價格與張數）。整理前（盤中）匯出需逐檔篩選，可能要等數十秒。</p>` : '<div class="empty"><p>尚無錄製紀錄。</p></div>';
  const days = b.days.length ? `<div class="dt-table"><table><tr><th>日期</th><th>狀態</th><th>股票數</th><th>推播清單</th><th>加錄</th><th>換股</th><th>匯出</th></tr>${b.days.map(x => `<tr><td class="mono">${x.date}</td><td>${x.compacted ? '已整理' : '<span class="warn">待整理</span>'}${x.gap ? ' · 曾中斷' : ''}</td><td class="mono">${x.stocks ?? '—'}</td><td class="mono">${fmt(x.main)}</td><td class="mono">${fmt(x.extra)}</td><td class="mono">${x.swaps}</td><td>${x.exported ? `<span title="${esc(x.exported.file)}">✓ ${fmt(x.exported.bytes / 1048576, 0)} MB</span>` : b.exporting === x.date ? '<span class="warn">匯出中…</span>' : x.exportError ? `<span class="warn" title="${esc(x.exportError)}">失敗</span>` : '—'}</td></tr>`).join('')}</table></div>` : '';
  const sel = (key, list, f = v => v) => `<select data-bkset="${key}">${list.map(v => `<option value="${v}" ${s[key] === v ? 'selected' : ''}>${f(v)}</option>`).join('')}</select>`;
  const set = `<details class="dt-day"><summary>錄製設定</summary><div class="lv-settings">
    <label class="lv-rule"><input type="checkbox" data-bkset="enabled" ${s.enabled ? 'checked' : ''}><span>啟用五檔錄製（隨即時推播盤中錄製，收盤後整理）</span></label>
    <label class="dt-field"><span>加錄股票上限</span>${sel('extra', [0, 300, 500, 800, 1000, 1100], v => v ? `${fmt(v)} 檔` : '不加錄')}<span>保留</span>${sel('keepDays', [5, 10, 20, 40, 60], v => `${v} 個交易日`)}</label>
    <label class="lv-rule"><input type="checkbox" data-bkset="swap" ${s.swap ? 'checked' : ''}><span>盤中換股：開盤後 5 分鐘（第一根 5 分 K）起每 30 分鐘，把冷清的加錄股換成爆量、大漲跌或族群轉強的股票</span></label>
    <p class="dt-foot">加錄只用推播剩下的訂閱數（保留 50 個餘裕），每檔只訂閱五檔 1 個；富果進階方案（2,000 訂閱）扣掉推播清單後約可加錄 1,000 檔。加錄股票的逐筆成交於收盤後以 REST 補齊。</p>
    <label class="dt-field"><span>每日匯出資料夾</span><input data-bkdir value="${esc(s.exportDir || '')}" placeholder="例如 C:\\Users\\你的名字\\Dropbox\\TW_trade" style="flex:1;min-width:260px" spellcheck="false"></label>
    <p class="dt-foot">收盤整理完成後，把當天全部錄製股票匯出成「日期_五檔成交.zip」（每檔一個 CSV，格式同上方下載）。放在 Dropbox 等同步資料夾內即可自動上傳；留空＝不匯出。全部錄製約 1,300 檔時每天約 250–300 MB。</p>
    <div class="form-actions"><button class="primary" data-bksave>儲存錄製設定</button></div></div></details>`;
  return `<div class="dt-status">${status}</div>${swaps}${exp}${days}${set}`;
}
export function daytradePanel() {
  const d = D.info; if (!d?.capable) return '';
  const tabs = [['scan', '觀察名單'], ['review', '訊號檢討'], ['books', '五檔錄製'], ['settings', '設定']];
  const body = !d.enabled && D.tab === 'scan' ? '<div class="empty"><p>當沖監控已關閉，可在「設定」開啟。</p></div>' : D.tab === 'scan' ? scanView(d) : D.tab === 'review' ? reviewView() : D.tab === 'books' ? booksView() : settingsView(d);
  return `<section class="panel dt-panel"><div class="panelhead"><div><h2><span class="idx">DT</span>當沖掃描</h2><p>${d.phaseName ? `${esc(d.phaseName)} · ` : ''}觀察名單多週期確認與多單風險監控${d.marketChange != null ? ` · 監控股票平均 ${pct(d.marketChange)}` : ''}</p></div><div class="segmented">${tabs.map(([k, l]) => `<button class="${D.tab === k ? 'selected' : ''}" data-dttab="${k}">${l}</button>`).join('')}</div></div>
    <div class="contentpad"><div class="dt-status">${feedLine(d)}</div><div class="dt-status">${prepLine(d)}</div>${D.error ? `<div class="notice err"><span>${esc(D.error)}</span></div>` : ''}${body}</div></section>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-kbar-row]'); if (!b || !X) return; const ds = b.dataset;
  try {
    if (ds.dttab) { D.tab = ds.dttab; if (D.tab === 'review') { X.repaint(); await loadReview(); } if (D.tab === 'books') { X.repaint(); B.at = Date.now(); await loadBooks(); } return X.repaint(); }
    if (ds.kbarRow) return X.openChart(ds.kbarRow);
    if ('dtsave' in ds && D.draft) { const r = await X.api('daytrade/settings', D.draft); D.draft = structuredClone(r.settings); await loadDaytrade(); X.toast('當沖監控設定已儲存'); return X.repaint(); }
    if ('bksave' in ds && B.draft) { const r = await X.api('books/settings', B.draft); B.info = r.books; B.draft = structuredClone(r.books.settings); X.toast('五檔錄製設定已儲存'); return X.repaint(); }
    if ('bkexport' in ds) {
      const id = (document.querySelector('[data-bkid]')?.value || '').trim().toUpperCase(); B.id = id;
      if (!/^[0-9A-Z]{1,12}$/.test(id) || !B.date) return X.toast('請輸入股票代號');
      // 先確認有資料（沒有時顯示原因），再以連結下載
      b.disabled = true; X.toast('匯出中…');
      try {
        const url = `/api/books/export?date=${B.date}&id=${encodeURIComponent(id)}`, r = await fetch(url);
        if (!r.ok) { const j = await r.json().catch(() => ({})); return X.toast(j.error || `HTTP ${r.status}`); }
        const blob = await r.blob(), a = document.createElement('a'), name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') || '')?.[1] || `${id}-${B.date}.csv`);
        a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
      } finally { b.disabled = false; }
    }
  } catch (err) { X.toast(err.message); }
});
document.addEventListener('change', async e => {
  const t = e.target; if (!X) return;
  if (t.dataset?.bkdate) { B.date = t.value; B.stocks = null; await loadBooks(); return X.repaint(); }
  if ('bkdir' in (t.dataset || {}) && B.draft) { B.draft.exportDir = t.value.trim(); return; }
  if (t.dataset?.bkset && B.draft) { B.draft[t.dataset.bkset] = t.type === 'checkbox' ? t.checked : Number(t.value); return; }
  if (!t.dataset?.dtset || !D.draft) return;
  const keys = t.dataset.dtset.split('.'), v = t.type === 'checkbox' ? t.checked : /^(auto|advanced|developer|basic|all|watchlist|\d{2}:\d{2})$/.test(t.value) ? t.value : Number(t.value);
  keys.slice(0, -1).reduce((o, k) => o[k], D.draft)[keys.at(-1)] = v;
});
