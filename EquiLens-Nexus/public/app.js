import { renderFlowCards, downloadFlowCard } from './flow-cards.js';
import { initHeatmap, heatPage, mountHeatmap } from './heatmap.js';
import { initBriefing, briefPage, mountBriefing } from './briefing.js';
import { getPrefs, setPrefs, prefsPanel, DEFAULTS as PREF_DEFAULTS } from './prefs.js';
import { initGroupRank, groupRankPage, enterGroupRank } from './grouprank.js';
import { initLive, livePage, enterLive, detailExtrasShell, fillDetailExtras, reportPanel, claudeSettings, newsSettings, openChart } from './live.js';
import { initSetup, setupWizard, systemSettings } from './setup.js';
import { initChipwatch, chipPage, enterChips } from './chipwatch.js';
import { setLanguage } from './i18n.js';
import * as MK from './market.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, n = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 2)}%`;
const cls = v => v == null ? 'muted' : v > 0 ? 'up' : v < 0 ? 'down' : 'muted';
const factorNames = { technical: '技術', chips: '籌碼', topic: '話題', industry: '行業趨勢' };
const factorColors = ['#22e6ff', '#9b8cff', '#ffc34d', '#ff4fd8'];
const C = { up: '#ff3d5a', down: '#16e38b', grid: '#16263d', text: '#6b84a6', ma20: '#ffc34d', ma60: '#9b8cff', ma120: '#22e6ff', vol: '#28405f' };

const PAGES = {
  home: { title: '今日焦點', eyebrow: 'Morning Brief · Pre-market', sub: '開盤前先看這裡：昨日台股收盤後到今晨美股收盤的焦點新聞，以及本周經濟數據與科技財報行程。' },
  heatmap: { title: '資金熱浪', eyebrow: 'Market Pulse · Sector Heatmap', sub: '當日資金流向：面積為成交金額、顏色為漲跌幅，依產業別切分板塊（資料源沒有全市場行情時以研究族群為範圍）。' },
  grouprank: { title: '族群排名', eyebrow: 'Sector Strength Ranking', sub: '研究總覽各族群的盤中漲幅排名：排除低量個股並以 √成交金額加權，避免冷門股或單一權值股造成失真；隔日標示名次變動。' },
  live: { title: '盤中雷達', eyebrow: 'Intraday Radar · Live Board', sub: '盤中定時掃描即時行情：族群與自選股即時走勢、爆量與急拉急殺、漲跌停與型態進場提醒，手機同步推播。' },
  overview: { title: '研究總覽', eyebrow: 'Research Matrix', sub: '從趨勢到證據，找到值得深入研究的公司。' },
  sectors: { title: '市場族群', eyebrow: 'Custom Groups', sub: '依你的族群分類研究，保留檔案順序與跨族群歸屬。' },
  patterns: { title: '型態選股', eyebrow: 'Pattern Scanner · 90 Sessions', sub: '90 個交易日，看見價格結構、確認訊號與風險邊界。' },
  chips: { title: '籌碼追蹤', eyebrow: 'Broker Branches · Big Holders', sub: '追蹤指定券商分點每日盤後的進出，並依每週股權分散表排出千張大戶集中與渙散的股票。' },
  flows: { title: '法人／期貨籌碼', eyebrow: 'Institutional Flow', sub: '指定日期，檢視法人現貨流向與台指期權部位。僅在按下查詢後更新。' },
  topics: { title: '話題追蹤', eyebrow: 'Catalyst Evidence', sub: '追蹤事件的進展，讓市場敘事回到可檢查的證據。' },
  watchlist: { title: '自選追蹤', eyebrow: 'Watchlist', sub: '持續觀察關注公司，掌握分數與研究假設的變化。' },
  method: { title: '評分方法', eyebrow: 'Model Spec', sub: '每一個分數，都能回到資料與計算依據。' },
  settings: { title: '資料與設定', eyebrow: 'System Config', sub: '管理研究市場、資料來源、推理模型、更新排程與研究偏好。' },
};
const ICONS = {
  home: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  heatmap: '<rect x="3" y="3" width="10" height="11"/><rect x="15" y="3" width="6" height="6"/><rect x="15" y="11" width="6" height="10"/><rect x="3" y="16" width="10" height="5"/>',
  grouprank: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="M15 5l3-2 3 2"/>',
  live: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-4"/>',
  overview: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  sectors: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/>',
  patterns: '<path d="M3 17l5-6 4 3 4-8 5 5"/><path d="M3 21h18"/>',
  flows: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  chips: '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="15" r="5"/><path d="M9 7v4M7 9h4"/>',
  topics: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  watchlist: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  method: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
// 只有部分市場或資料源才有的頁面（法人／期貨籌碼目前只有台股 FinMind）
const navAllowed = k => (k !== 'flows' || !!state?.capabilities?.flows) && (k !== 'chips' || !!state?.capabilities?.brokers);
const PROVIDER_NAMES = { finmind: 'FinMind', twse: 'TWSE / TPEx', fugle: 'Fugle', shioaji: 'Shioaji', twelvedata: 'Twelve Data', alphavantage: 'Alpha Vantage' };
const dataSources = () => [...new Set(Object.values(state.capabilities || {}).filter(Boolean))].map(id => PROVIDER_NAMES[id] || id).join(' / ') || '—';
const NAV = [['TODAY', ['home']], ['MARKET', ['heatmap', 'live', 'grouprank']], ['RESEARCH', ['overview', 'sectors', 'patterns', 'flows', 'chips', 'topics', 'watchlist']], ['SYSTEM', ['method', 'settings']]];
// 衡析標誌：圓角六角形＋上升折線（深色主題：電光青六角形、深墨折線；淺色主題反轉，見 hud.css 的 --mark-hex／--mark-line）
const BRAND = `<svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><polygon class="mk-hex" points="50,10 84.64,30 84.64,70 50,90 15.36,70 15.36,30" stroke-width="10" stroke-linejoin="round"/><polyline class="mk-line" points="28,67 44,50 56,60 74,34" fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// 開啟時的頁面依「介面與使用偏好」（預設今日焦點）。
let state, page = PAGES[getPrefs().start] ? getPrefs().start : 'home', query = '', marketFilter = '全部', sectorFilter = '', scoreFilter = '', completeOnly = false, sort = 'score', index = 0, timer, selectedId;
const perPage = 12;
const formDrafts = new Map();
function saveDrafts() { for (const id of ['evidence-form', 'settings-form']) { const form = document.getElementById(id); if (form) formDrafts.set(id, [...form.elements].filter(e => e.name).map(e => ({ name: e.name, value: e.value, checked: e.checked }))); } }
function restoreDrafts() { for (const [id, values] of formDrafts) { const form = document.getElementById(id); if (!form) continue; for (const item of values) { const el = form.elements.namedItem(item.name); if (el) { el.value = item.value; if (el.type === 'checkbox') el.checked = item.checked; } } } }

async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || '讀取資料失敗'); return result;
}
function toast(message) { const p = getPrefs(); if (!p.toast) return; $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('#toast').classList.remove('show'), p.toastSec * 1000); }
function applyState(next) { state = next; MK.setMarket(state.marketProfile, state.upColor, state.config?.language); Object.assign(C, MK.upColors()); }
async function load(render = true) { applyState(await api('state')); if (render) draw(); }
const inScope = id => !!state?.stocks.some(s => s.id === id);
initHeatmap({ api, toast, state: () => state, inScope, openStock: id => openChart(id, 'live'), redraw: () => { if (page === 'heatmap') draw(); } });
initBriefing({ esc, toast, state: () => state });
initGroupRank({ api, toast, redraw: () => draw(), page: () => page, openStock: id => openChart(id, 'live'), inScope, esc });
initLive({ api, toast, state: () => state, redraw: () => draw(), page: () => page, openStock: id => openStock(id), inScope, setPage: p => setPage(p), reload: () => load() });
initChipwatch({ api, toast, page: () => page });
initSetup({ api, toast, state: () => state, reload: () => load(), redraw: () => draw(), page: () => page, esc });

function setPage(p) { if (['settings', 'topics'].includes(page)) saveDrafts(); page = p; index = 0; $('.sidebar')?.classList.remove('open'); draw(); window.scrollTo(0, 0); if (p === 'patterns') loadPatterns(); if (p === 'live') enterLive(); if (p === 'grouprank') enterGroupRank(); if (p === 'chips') enterChips(); }

/* ---------- market clock ---------- */
function twNow() { return MK.parts(); }
function marketStatus() {
  return MK.status();


}
function tick() { const c = $('#clock'); if (!c) return; const p = twNow(); c.textContent = `${p.hour}:${p.minute}:${p.second}`; const [label, k] = marketStatus(); const m = $('#mkt'); if (m && m.dataset.v !== label) { m.dataset.v = label; m.innerHTML = `<span class="pulse ${k}"></span> ${label}`; } }
setInterval(tick, 1000);

/* ---------- shell ---------- */
function draw() {
  if (!state.config?.setupDone) { $('#app').innerHTML = setupWizard(); return; }
  if (!navAllowed(page)) page = 'home';
  const active = document.activeElement, activeId = active?.id, selection = active?.selectionStart;
  const info = PAGES[page], latest = state.stocks.map(s => s.asOf).filter(Boolean).sort().at(-1);
  const [mkt, mk] = marketStatus();
  $('#app').innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand">${BRAND}<div><strong>衡析</strong><span>EQUILENS</span></div></div>
  ${NAV.map(([label, keys]) => [label, keys.filter(navAllowed)]).map(([label, keys]) => `<div class="nav-label">${label}</div><nav class="nav" aria-label="${label}">${keys.map(k => `<button data-page="${k}" class="${page === k ? 'active' : ''}" ${page === k ? 'aria-current="page"' : ''} title="${PAGES[k].title}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span class="txt">${PAGES[k].title}</span>${k === 'watchlist' ? `<span class="badge">${state.watchlist.length}</span>` : k === 'live' ? `<span class="badge hot">${state.monitor?.window && state.monitor?.enabled ? 'LIVE' : 'NEW'}</span>` : ''}</button>`).join('')}</nav>`).join('')}
  <div class="side-bottom"><div class="sys-card"><div><span>DATA</span><b><span class="pulse ${state.dataConfigured ? '' : 'off'}"></span> ${state.dataConfigured ? 'LINKED' : 'OFFLINE'}</b></div><div><span>MARKET</span><b translate="no">${esc(state.marketProfile?.id || 'TW')}</b></div><div><span>SCOPE</span><b>${state.stocks.length} / ${state.groups.length}G</b></div><div><span>AUTO</span><b>${state.settings.autoUpdate ? state.settings.updateTime : 'OFF'}</b></div><div><span>BUILD</span><b>v${esc(state.appVersion || '2.0.0')}</b></div></div></div></aside>
  <div class="workspace"><header class="topbar"><button class="menu-toggle ghost" data-action="menu" aria-label="開啟選單">☰</button><div class="ticker"><span><span translate="no">${esc(state.marketProfile?.id || 'TW')}</span> <b class="clock" id="clock">--:--:--</b></span><span class="sep"></span><span id="mkt" data-v="${mkt}"><span class="pulse ${mk}"></span> ${mkt}</span><span class="sep opt"></span><span class="opt">行情 <b>${latest || '未更新'}</b></span><span class="sep opt"></span><span class="opt">任務 <b>${state.job.running ? `<i class="spinner"></i>${state.job.done}/${state.job.total}` : 'IDLE'}</b></span></div>
  <div class="top-tools"><label class="searchbox"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="search" type="search" placeholder="搜尋研究名單代碼或名稱" aria-label="搜尋股票代碼或名稱" value="${esc(query)}"><kbd>/</kbd></label><button class="ghost" data-live="pip" aria-label="浮動雷達視窗" title="浮動雷達視窗（永遠置頂）">📡</button><button class="ghost" data-page="settings" aria-label="設定" title="資料與設定">⚙</button></div></header>
  <main class="main" id="main"><div class="pagehead"><div><p class="eyebrow">${info.eyebrow}</p><h1>${info.title}</h1><p class="subtitle">${info.sub}</p></div><div class="actions">${page === 'overview' ? '<button data-action="new-group">＋ 新增族群</button>' : ''}${page === 'overview' || page === 'watchlist' ? `<button data-action="export">↓ 匯出清單</button><button class="primary" data-action="update" ${state.job.running ? 'disabled' : ''}>⟳ 更新${page === 'watchlist' ? '自選' : '資料'}</button>` : ''}</div></div>
  ${jobBanner()}${page !== 'settings' && !state.dataConfigured ? `<div class="notice warn"><span>尚未設定資料來源。目前僅顯示已取得的資料。</span><button data-page="settings">設定資料來源 →</button></div>` : ''}${state.scopeError ? `<div class="notice warn"><span>${esc(state.scopeError)}</span></div>` : ''}
  <div id="pagecontent">${({ home: () => reportPanel() + briefPage(), heatmap: heatPage, live: livePage, grouprank: groupRankPage, flows: flowPage, chips: chipPage, patterns: patternPage, overview, watchlist: overview, sectors: groupPage, topics, settings, method })[page]()}</div>
  <footer class="footer"><span>DATA · <span translate="no">${esc(dataSources())}</span> · 各欄位以原始日期為準 · MODEL v${esc(state.version)} · APP v${esc(state.appVersion || '2.0.0')}</span><span>研究排序工具 · 分數不等於報酬率或合理股價 · 非交易建議</span></footer></main></div></div>`;
  restoreDrafts(); tick();
  if (activeId) { const el = document.getElementById(activeId); if (el && el !== document.body && ['search', 'heat-search', 'pattern-search'].includes(activeId)) { el.focus(); try { el.setSelectionRange(selection, selection); } catch { } } }
  if (page === 'heatmap') mountHeatmap();
  if (page === 'home') mountBriefing();
}
function jobBanner() { const j = state.job; return j.running ? `<div class="jobline"><span><i class="spinner"></i>${esc(j.message)} <small>${esc(j.dataset || '')}</small></span>${j.total ? `<span class="bar"><i style="width:${j.done / j.total * 100}%"></i></span>` : ''}<button data-action="cancel">停止</button></div>` : j.finishedAt ? `<div class="jobline"><span>${esc(j.message)} <small>· ${MK.dateTime(j.finishedAt)}</small></span>${j.errors?.length ? '<button data-page="settings">查看狀態</button>' : ''}</div>` : ''; }
function mini(values, color = '#22e6ff') { if (!values?.length) return '<span class="muted">—</span>'; const min = Math.min(...values), max = Math.max(...values), range = max - min || 1; const p = values.map((v, i) => `${2 + i / (values.length - 1 || 1) * 74},${26 - (v - min) / range * 22}`).join(' '); const last = values.at(-1) >= values[0]; return `<svg class="spark" viewBox="0 0 78 30" role="img" aria-label="近 30 日還原價格趨勢"><polyline points="${p}" fill="none" stroke="${last ? C.up : C.down}" stroke-width="1.5" style="filter:drop-shadow(0 0 3px ${last ? C.up : C.down})"/></svg>`; }
function scoreCell(v) { return v == null ? '<span class="muted">—</span>' : `<span class="score">${fmt(v, 0)}<span class="scorebar"><i style="width:${v}%"></i></span></span>`; }
function tag(s) { return `<span class="rating ${s.score == null || s.score >= 40 && s.score < 75 ? 'neutral' : s.score < 40 ? 'weak' : ''}">${esc(s.rating)}</span>`; }

/* ---------- 自選分組 ---------- */
let watchGroupFilter = '', groupEditOpen = false;
const wg = () => state.watchGroups || { groups: [], assign: {} };
const inWatchGroup = id => !watchGroupFilter || (watchGroupFilter === 'none' ? !wg().assign[id] : wg().assign[id] === watchGroupFilter);
const watchCount = gid => state.watchlist.filter(id => gid === 'none' ? !wg().assign[id] : wg().assign[id] === gid).length;
// 加到自選／變更分組／移除的下拉選單（研究總覽、自選追蹤、個股診斷、型態選股共用）。
// 另列出還沒包含這檔股票的研究族群：選了會同時加入該研究族群（開始評分與每日更新）並加到自選
function watchSelect(id, name = '') {
  const g = wg(), on = state.watchlist.includes(id), cur = g.assign[id] || '';
  const opts = on ? [...g.groups.map(x => [`g:${x.id}`, `★ ${x.name}`, cur === x.id]), ['g:', '★ 未分組', !cur], ['remove', '✕ 移除自選', false]]
    : [['', '☆ 加到自選', true], ...g.groups.map(x => [`g:${x.id}`, `加到「${x.name}」`, false]), ['g:', g.groups.length ? '加到「未分組」' : '加入自選', false]];
  const research = (state.groups || []).filter(x => !x.stockIds?.includes(id));
  const opt = ([v, l, sel]) => `<option value="${v}" ${sel ? 'selected' : ''} ${v === '' ? 'disabled' : ''}>${esc(l)}</option>`;
  const rg = research.length ? `<optgroup label="${on ? '也加入研究族群' : '加到自選並加入研究族群'}">${research.map(x => opt([`r:${x.id}`, `${on ? '＋' : '☆'} 研究族群「${x.name}」`, false])).join('')}</optgroup>` : '';
  return `<select class="watchsel ${on ? 'on' : ''}" data-watch-set="${id}" data-watch-name="${esc(name)}" aria-label="${on ? '變更自選分組' : '加到自選'} ${esc(name)}"><optgroup label="自選分組">${opts.map(opt).join('')}</optgroup>${rg}</select>`;
}
// 加入研究族群：加入後沒有行情資料時，沒有其他更新在跑就立即下載這檔
async function joinResearchGroup(id, groupId) {
  const r = await api('group-stocks', { groupId, stockId: id });
  if (r.needsUpdate && !state.job?.running) { try { await api('update', { scope: 'selected', ids: [id] }); r.updating = true; } catch { } }
  return r;
}
function watchGroupBar() {
  if (watchGroupFilter && watchGroupFilter !== 'none' && !wg().groups.some(g => g.id === watchGroupFilter)) watchGroupFilter = '';
  return `<select id="watch-group-filter" aria-label="自選分組"><option value="">全部自選（${state.watchlist.length}）</option>${wg().groups.map(g => `<option value="${g.id}" ${watchGroupFilter === g.id ? 'selected' : ''}>${esc(g.name)}（${watchCount(g.id)}）</option>`).join('')}<option value="none" ${watchGroupFilter === 'none' ? 'selected' : ''}>未分組（${watchCount('none')}）</option></select><button data-action="watch-groups" aria-expanded="${groupEditOpen}">${groupEditOpen ? '收起分組管理' : '⚙ 管理分組'}</button>`;
}
function watchGroupEditor() {
  if (!groupEditOpen) return '';
  return `<div class="wg-editor"><p class="fine">自訂分組名稱（最多 30 組，每組 1–20 字）。刪除分組後，裡面的股票會移到「未分組」；要把股票放進分組，請用表格最右邊的下拉選單。</p><div class="wg-list" id="wg-list">${wg().groups.map(g => wgRow(g.id, g.name, watchCount(g.id))).join('') || '<p class="fine" id="wg-empty">尚未建立分組。</p>'}</div>
    <div class="wg-add"><input id="wg-new" maxlength="20" placeholder="新分組名稱，例如：核心持股"><button data-wg="add">＋ 新增分組</button></div><div class="form-actions"><button class="primary" data-wg="save">儲存分組</button><button data-action="watch-groups">取消</button></div></div>`;
}
const wgRow = (id, name, n) => `<div class="wg-row" data-wg-id="${id}"><input value="${esc(name)}" maxlength="20" aria-label="分組名稱"><span class="muted">${n == null ? '新分組' : `${n} 檔`}</span><button class="textbtn" data-wg="up" title="往上移">↑</button><button class="textbtn" data-wg="del">刪除</button></div>`;
// 研究名單以外的自選股（例如型態選股加入的）：沒有四維評分，提供最新價、型態訊號與 K 線
function watchExtraTable() {
  const rows = (state.watchExtra || []).filter(s => inWatchGroup(s.id) && (!query || `${s.id} ${s.name}`.includes(query)));
  if (!rows.length) return '';
  return `<div class="panelhead wx-head"><div><h2><span class="idx">01b</span>研究名單以外的自選股 <span class="tag">${rows.length}</span></h2><p>沒有四維評分 · 點名稱看日 K／5 分 K · 加入研究族群後才會下載完整資料與評分</p></div></div><div class="tablewrap"><table><thead><tr><th style="text-align:left">公司 / 產業</th><th>收盤 / 漲跌</th><th style="text-align:left">型態訊號</th><th>分組</th></tr></thead><tbody>${rows.map(s => `<tr><td class="stockcell"><button class="stocklink" data-kbar="${s.id}"><strong>${esc(s.name)}<span class="stockcode">${s.id}</span></strong><small>${esc(s.sector || '—')} · ${esc(s.market || '—')}</small></button></td><td class="num">${fmt(s.price, 2)}<small class="${cls(s.change)}" style="display:block;margin-top:4px">${s.change == null ? (s.asOf ? s.asOf.slice(5) : '—') : pct(s.change)}</small></td><td>${s.patterns.map(p => `<button class="textbtn" data-pattern-stock="${s.id}" data-pattern-id="${esc(p.id)}">${esc(p.name)} · ${esc(p.status)}</button>`).join('<br>') || '<span class="muted">目前無型態訊號</span>'}</td><td>${watchSelect(s.id, s.name)}</td></tr>`).join('')}</tbody></table></div>`;
}

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'watch-group-filter') { watchGroupFilter = t.value; index = 0; draw(); return; }
  if (!t.matches?.('[data-watch-set]')) return;
  const id = t.dataset.watchSet, name = t.dataset.watchName || id, v = t.value; t.disabled = true;
  try {
    // 研究族群：先加入族群，再加到自選（已在自選時保留原本的自選分組）
    const research = v.startsWith('r:') ? state.groups.find(x => x.id === v.slice(2)) : null, joined = research ? await joinResearchGroup(id, research.id) : null;
    const r = await api('watch/set', v === 'remove' ? { id, on: false } : research ? { id, on: true } : { id, on: true, group: v.slice(2) });
    const g = r.watchGroups.groups.find(x => x.id === r.watchGroups.assign[id]);
    await load(); // 重新取得清單（含研究名單以外自選股的報價與型態）並重繪
    document.querySelectorAll(`[data-watch-set="${id}"]`).forEach(el => { el.outerHTML = watchSelect(id, name); }); // 對話框內的選單也同步
    toast(v === 'remove' ? `已將 ${name} 移出自選` : research ? `${name} 已加入研究族群「${research.name}」並加到自選${joined.updating ? '，正在下載行情' : joined.needsUpdate ? '，請更新此股以取得行情' : ''}` : `${name} 已加到自選${g ? `「${g.name}」` : '（未分組）'}`);
  } catch (err) { toast(err.message); t.outerHTML = watchSelect(id, name); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-wg]'); if (!b) return;
  const list = $('#wg-list'), act = b.dataset.wg, row = b.closest('.wg-row');
  if (act === 'del') return row.remove();
  if (act === 'up') { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); return; }
  if (act === 'add') { const inp = $('#wg-new'), name = inp.value.trim(); if (!name) return inp.focus(); $('#wg-empty')?.remove(); list.insertAdjacentHTML('beforeend', wgRow('', name)); inp.value = ''; return inp.focus(); }
  if (act === 'save') {
    const pending = $('#wg-new').value.trim(), groups = [...list.querySelectorAll('.wg-row')].map(r => ({ id: r.dataset.wgId || undefined, name: r.querySelector('input').value.trim() }));
    if (pending) groups.push({ name: pending });
    b.disabled = true;
    try { const r = await api('watch/groups', { groups }); state.watchGroups = r.watchGroups; groupEditOpen = false; draw(); toast(`自選分組已儲存（${r.watchGroups.groups.length} 組）`); }
    catch (err) { toast(err.message); b.disabled = false; }
  }
});

/* ---------- overview ---------- */
function filtered() {
  let rows = state.stocks.filter(s => (page !== 'watchlist' || state.watchlist.includes(s.id)) && (!query || `${s.id} ${s.name}`.includes(query)) && (page === 'watchlist' ? inWatchGroup(s.id) : marketFilter === '全部' || s.market === marketFilter) && (!sectorFilter || s.groupIds?.includes(sectorFilter)) && (!completeOnly || s.complete) && (!scoreFilter || s.score != null && s.score >= Number(scoreFilter)));
  if (sort === 'group') { const order = sectorFilter ? state.groups.find(g => g.id === sectorFilter)?.stockIds || [] : [...new Set(state.groups.flatMap(g => g.stockIds))]; rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); }
  else if (sort === 'change') rows.sort((a, b) => (b.change ?? -999) - (a.change ?? -999));
  else if (sort === 'coverage') rows.sort((a, b) => b.coverage - a.coverage || (b.score ?? -1) - (a.score ?? -1));
  else if (sort === 'code') rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}
function overview() {
  const available = state.stocks.filter(s => s.score != null), strong = available.filter(s => s.complete && s.score >= 75), validIndustry = state.sectors.filter(s => s.score != null), cover = state.stocks.length ? available.length / state.stocks.length * 100 : 0;
  return `<section class="stats" aria-label="資料摘要">
  <article class="stat"><span class="label">名單研究範圍 <i>SCOPE</i></span><div class="value glow">${fmt(state.stocks.length)}<span class="unit">檔</span></div><p>${state.groups.length} 個自訂族群 · 名單外不研究</p><div class="minibar"><i style="width:100%"></i></div></article>
  <article class="stat"><span class="label">已有可用評分 <i>SCORED</i></span><div class="value">${fmt(available.length)}<span class="unit">檔 / ${fmt(cover, 1)}%</span></div><p>含暫評；未更新股票不納入強弱統計</p><div class="minibar"><i style="width:${cover}%"></i></div></article>
  <article class="stat"><span class="label">完整評分 · 強勢 <i>STRONG</i></span><div class="value amber">${fmt(strong.length)}<span class="unit">檔</span></div><p>四維資料齊備 · 綜合分數 ≥ 75</p><div class="minibar"><i style="width:${strong.length / (available.length || 1) * 100}%;background:var(--amber);box-shadow:0 0 8px var(--amber)"></i></div></article>
  <article class="stat"><span class="label">族群資料達標 <i>GROUPS</i></span><div class="value">${validIndustry.length}<span class="unit">/ ${state.sectors.length} 族群</span></div><p>覆蓋率 ≥ 50% 且達最低樣本數</p><div class="minibar"><i style="width:${validIndustry.length / (state.sectors.length || 1) * 100}%;background:var(--violet);box-shadow:0 0 8px var(--violet)"></i></div></article></section>
  <div class="overview-grid"><section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>${page === 'watchlist' ? '我的觀察清單' : '個股研究排序'}</h2><p>${page === 'watchlist' ? '依自訂分組檢視 · 最右欄可加入分組或移除 · 紅漲綠跌' : '僅研究族群成員 · 紅漲綠跌 · 跨族群股票不重複計數'}</p></div><div class="actions">${sectorFilter ? `<button data-add-stock="${esc(sectorFilter)}">＋ 新增個股</button>` : ''}<button class="textbtn" data-page="method">評分依據 ↗</button></div></div>
  <div class="filters">${page === 'watchlist' ? watchGroupBar() : `<div class="segmented" aria-label="市場篩選">${['全部', ...new Set(state.stocks.map(s => s.market).filter(Boolean))].map(m => `<button data-market="${m}" class="${marketFilter === m ? 'selected' : ''}" aria-pressed="${marketFilter === m}">${m}</button>`).join('')}</div>`}<select id="sector-filter" aria-label="族群篩選"><option value="">所有族群</option>${state.sectors.map(s => `<option value="${esc(s.id)}" ${sectorFilter === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><select id="sort-filter" aria-label="排序方式">${[['group', '族群原始順序'], ['score', '綜合分數 ↓'], ['coverage', '資料完整度 ↓'], ['change', '日漲跌幅 ↓'], ['code', '股票代碼 ↑']].map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="score-filter" aria-label="最低綜合分數"><option value="">所有分數</option>${[75, 55, 40].map(n => `<option value="${n}" ${scoreFilter == n ? 'selected' : ''}>≥ ${n} 分</option>`).join('')}</select><label class="checkbox"><input type="checkbox" id="complete-filter" ${completeOnly ? 'checked' : ''}>僅完整評分</label>${sectorFilter || query || scoreFilter || completeOnly || (page === 'watchlist' && watchGroupFilter) ? '<button class="textbtn" data-action="clear">清除</button>' : ''}</div>${page === 'watchlist' ? watchGroupEditor() : ''}<div id="stocktable">${stockTable()}</div></section>
  <aside class="rightcol"><section class="panel"><div class="panelhead"><h2><span class="idx">02</span>族群脈動</h2><button class="textbtn" data-page="sectors">全部 ↗</button></div><div class="sector-list">${state.sectors.slice(0, 6).map(s => `<div class="sector-item"><div class="sector-top"><span>${esc(s.name)}</span><small>${s.score == null ? '累積中' : fmt(s.score)}</small></div><div class="sector-bar"><i style="width:${s.score ?? s.coverage}%"></i></div><div class="sector-meta"><span>${s.covered}/${s.count} 檔達門檻</span><span>${s.coverage}%</span></div></div>`).join('') || '<div class="empty">先更新股票清單</div>'}</div></section>
  <section class="panel"><div class="panelhead"><h2><span class="idx">03</span>四維評估</h2><span class="tag cyan">1–3 個月</span></div><div class="method-preview"><div class="weight-stack">${Object.entries(state.weights).map(([k, w], i) => `<i style="width:${w}%;background:${factorColors[i]};box-shadow:0 0 8px ${factorColors[i]}"></i>`).join('')}</div>${Object.entries(state.weights).map(([k, w], i) => `<div class="weight-row"><span class="weight-key"><i class="weight-dot" style="background:${factorColors[i]}"></i>${factorNames[k]}</span><b>${w}%</b></div>`).join('')}<p class="fine">綜合分數衡量目前條件的強弱。缺少因子時顯示「暫評」，並公開有效權重。</p><button class="textbtn" style="margin-top:10px" data-page="method">了解模型與限制 →</button></div></section>
  ${heatCard()}</aside></div>`;
}
function heatCard() {
  const h = state.heatSummary;
  const body = h ? `<div class="sector-list">${h.top.map(s => `<div class="sector-item"><div class="sector-top"><span>${esc(s.name)}</span><small class="${cls(s.change)}">${pct(s.change)}</small></div><div class="sector-bar"><i style="width:${Math.max(2, s.share / (h.top[0].share || 1) * 100)}%"></i></div><div class="sector-meta"><span>成交占比 ${fmt(s.share, 1)}%</span><span class="${cls(s.moneyChange)}">${s.moneyChange == null ? '' : 'Δ' + fmt(s.moneyChange, 0) + '%'}</span></div></div>`).join('')}</div><p class="fine" style="padding:0 18px 16px">${h.date} · 總成交 ${fmt(h.total.money / 1e8, 0)} 億 · 漲 <span class="up">${h.total.up}</span> / 跌 <span class="down">${h.total.down}</span> · 漲停 ${h.total.limitUp}</p>` : '<div class="contentpad" style="padding-top:12px"><p class="fine">以證交所產業別呈現全市場成交金額與漲跌幅，一眼看出資金集中與退潮的板塊。尚無紀錄，開啟頁面即可查詢。</p></div>';
  return `<section class="panel"><div class="panelhead"><h2><span class="idx">04</span>資金熱浪</h2><button class="textbtn" data-page="heatmap">開啟 ↗</button></div>${body}</section>`;
}
function stockTable() {
  const rows = filtered(); index = Math.min(index, Math.max(0, Math.ceil(rows.length / perPage) - 1)); const subset = rows.slice(index * perPage, (index + 1) * perPage);
  return `<div class="tablewrap"><table><thead><tr><th>#</th><th style="text-align:left">公司 / 族群</th><th>收盤 / 漲跌</th><th>綜合</th><th>技術</th><th>籌碼</th><th>話題</th><th>行業</th><th>30D</th><th>評級 / 完整度</th><th>追蹤</th></tr></thead><tbody>${subset.map((s, i) => `<tr><td class="rank">${String(index * perPage + i + 1).padStart(2, '0')}</td><td class="stockcell"><button class="stocklink" data-stock="${s.id}"><strong>${esc(s.name)}<span class="stockcode">${s.id}</span></strong><small>${esc(s.groupNames?.join('、') || s.sector)} · ${s.market}</small></button></td><td class="num">${fmt(s.price, 2)}<small class="${cls(s.change)}" style="display:block;margin-top:4px">${pct(s.change)}</small></td><td>${scoreCell(s.score)}</td>${Object.keys(factorNames).map(k => `<td><span class="factor-pill ${s[k].score >= 75 ? 'hi' : ''}">${fmt(s[k].score)}</span></td>`).join('')}<td>${mini(s.spark)}</td><td>${tag(s)}<small class="muted num" style="display:block;margin-top:5px">${s.coverage}% · ${s.asOf?.slice(5) || '未更新'}</small></td><td>${watchSelect(s.id, s.name)}</td></tr>`).join('') || `<tr><td colspan="11"><div class="empty"><h3>${page === 'watchlist' ? (watchGroupFilter ? '這個分組在研究名單內沒有自選股' : '研究名單內尚無自選股') : '沒有符合條件的股票'}</h3><p>${page === 'watchlist' ? '研究名單以外的自選股列在下方；也可以在「型態選股」或研究總覽加入自選。' : '試著清除篩選條件，或更新股票清單與行情資料。'}</p><button data-action="clear">清除篩選</button></div></td></tr>`}</tbody></table></div><div class="tablefoot"><span>TOTAL ${fmt(rows.length)} · ${rows.length ? index * perPage + 1 : 0}–${Math.min((index + 1) * perPage, rows.length)}</span><div class="pagination"><button data-action="prev" aria-label="上一頁" ${index === 0 ? 'disabled' : ''}>‹</button><span style="padding:5px">${index + 1} / ${Math.max(1, Math.ceil(rows.length / perPage))}</span><button data-action="next" aria-label="下一頁" ${(index + 1) * perPage >= rows.length ? 'disabled' : ''}>›</button></div></div>${page === 'watchlist' ? watchExtraTable() : ''}`;
}

/* ---------- topics ---------- */
function topics() {
  const events = state.stocks.flatMap(s => s.topic.evidence.map(e => ({ ...e, name: s.name }))).sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="topic-layout"><div><section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>事件研究紀錄</h2><p>保留來源、判讀方向與實現階段 · 90 天內納入評分</p></div><span class="tag">${events.length} 件</span></div>${events.length ? events.map(e => eventCard(e, true)).join('') : `<div class="empty"><h3>讓話題從標題，走向證據</h3><p>選擇公司、附上原文來源，記錄事件是否已確認。<br>未完成判讀前，話題分數保持缺值。</p></div>`}</section>${newsFeed()}</div>
  <section class="panel contentpad"><h2>新增事件判讀</h2><p>由你判斷事件對未來 1–3 個月的影響，系統按實現程度與日期衰減計分。</p><form id="evidence-form"><div class="formgrid"><label class="field full">股票代碼<input name="stockId" placeholder="例如 2330" required pattern="[1-9][0-9]{3}" list="stocks-list"><datalist id="stocks-list">${state.stocks.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</datalist></label><label class="field full">事件摘要<input name="title" required minlength="3" maxlength="180" placeholder="例如：法說會確認產能開出時程"></label><label class="field full">原文來源<input name="url" type="url" required placeholder="https://..."></label><label class="field full">事件日期<input name="date" type="date" required max="${state.cutoff}" value="${state.cutoff}"></label><label class="field">影響方向<select name="direction"><option value="positive">正面</option><option value="neutral">中性</option><option value="negative">負面</option></select></label><label class="field">證據進度<select name="stage"><option value="watch">待驗證</option><option value="confirmed">已確認</option><option value="realized">已實現</option></select></label></div><div class="form-actions"><button type="submit" class="primary">儲存判讀</button></div></form></section></div>`;
}
function eventCard(e, removable = false) { return `<article class="event-card"><div class="event-top"><span><button class="textbtn" data-stock="${e.stockId}">${esc(e.stockId)} ${esc(e.name || '')}</button> · ${esc(e.date)}</span><span class="${e.direction === 'positive' ? 'up' : e.direction === 'negative' ? 'down' : 'muted'}">${({ positive: '正面', neutral: '中性', negative: '負面' })[e.direction]}</span></div><h3>${esc(e.title)}</h3><div class="event-bottom"><span class="tag">${({ watch: '待驗證', confirmed: '已確認', realized: '已實現' })[e.stage]}</span><a href="${safeLink(e.url)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>${removable ? `<button class="textbtn" data-delete-event="${e.id}" style="margin-left:auto">刪除</button>` : ''}</div></article>`; }
function newsFeed() { const news = state.headlines || []; return `<section class="panel" style="margin-top:16px"><div class="panelhead"><div><h2><span class="idx">02</span>新聞線索</h2><p>含新聞與社群線索 · 請先核實原文 · 不自動計分</p></div></div>${news.length ? news.map((n, i) => `<article class="event-card"><div class="event-top"><span>${esc(n.stockId)} ${esc(n.name)} · ${esc(n.source)}</span><span>${esc(n.date)}</span></div><h3><a href="${safeLink(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title || '閱讀新聞原文')} ↗</a></h3><div class="event-bottom"><button data-review-news="${i}">建立事件判讀 →</button></div></article>`).join('') : '<div class="empty"><p>可在研究名單內的個股診斷取得近三日新聞。</p></div>'}</section>`; }

/* ---------- settings / method ---------- */
function settings() {
  const s = state.settings;
  return `<div class="settings-system">${systemSettings()}</div>${prefsPanel(esc)}<div class="section-grid"><div class="settings-stack">
  <section class="panel contentpad"><h2>資料更新</h2><p>初次下載會建立歷史資料。更新支援停止與續傳；同一天已成功取得的資料會略過。</p><div class="actions" style="margin-top:14px"><button class="primary" data-action="update-watch" ${state.job.running ? 'disabled' : ''}>更新自選 ${state.watchlist.length} 檔</button><button data-action="update-all" ${state.job.running ? 'disabled' : ''}>更新全部研究個股</button><button data-action="update-universe" ${state.job.running ? 'disabled' : ''}>更新股票基本資料</button></div><p class="fine">行情逐檔更新研究名單內的股票。資金熱浪圖使用全市場單日行情（資料源支援時），自動更新時會一併執行。</p><div class="status-grid"><span>目前狀態</span><span>${state.job.running ? 'RUNNING' : 'IDLE'}</span><span>本次完成 / 排隊</span><span>${state.job.done} / ${state.job.total}</span><span>已下載價格</span><span>${state.stocks.filter(s => s.price != null).length} / ${state.stocks.length}</span><span>熱浪圖紀錄</span><span>${(state.heatDates || []).length} 日</span><span>已記錄事件</span><span>${state.evidenceCount} 件</span></div>${state.job.errors?.length ? `<details style="margin-top:16px"><summary>本次資料異常（${state.job.errors.length}）</summary><ul class="bullet-list">${state.job.errors.slice(-30).map(e => `<li>${esc(e.id || '')} ${esc(e.dataset || '')}：${esc(e.message)}</li>`).join('')}</ul></details>` : ''}</section>${newsSettings()}${claudeSettings()}</div>
  <form id="settings-form" class="panel contentpad"><h2>更新與評分偏好</h2><p>以研究市場的當地時間執行。啟用後需讓本機服務保持運作；電腦關機或休眠時不會更新。</p><div class="formgrid"><label class="field">平日更新時間<input type="time" name="updateTime" value="${s.updateTime}" required></label><label class="field">自動更新範圍<select name="autoScope"><option value="watchlist" ${s.autoScope === 'watchlist' ? 'selected' : ''}>自選股票</option><option value="all" ${s.autoScope === 'all' ? 'selected' : ''}>全部研究個股</option></select></label><label class="field full">FinMind 請求間隔<select name="interval">${[[13000, '13 秒 · 約 276 次 / 小時'], [7000, '7 秒 · 約 514 次 / 小時'], [3000, '3 秒 · 約 1,200 次 / 小時'], [1000, '1 秒 · 約 3,600 次 / 小時']].map(([n, l]) => `<option value="${n}" ${s.interval === n ? 'selected' : ''}>${l}</option>`).join('')}</select><small>請依你的 FinMind 方案選擇；不會自動假設有高額度權限。</small></label><label class="checkbox field full" style="flex-direction:row"><input type="checkbox" name="autoUpdate" ${s.autoUpdate ? 'checked' : ''}>啟用平日收盤後自動更新（熱浪圖 → 族群研究 → 型態資料）</label></div><h3 style="margin-top:24px">四維評分權重</h3><div class="weights">${Object.entries(s.weights).map(([k, v]) => `<label class="field">${factorNames[k]} %<input name="${k}" type="number" min="0" max="100" step="1" required value="${v}"></label>`).join('')}</div><p class="fine">合計必須為 100%。這是可解釋的研究模型，尚未經歷史回測驗證，不提供勝率宣稱。</p><div class="form-actions"><button type="submit" class="primary">儲存設定</button></div></form></div>`;
}
function method() {
  return `<div class="notice"><span>分數是目前資料條件的研究排序，不是買進訊號。估值獨立顯示，不因趨勢強勢就判定便宜。</span></div><div class="method-grid">${[
    ['技術結構', 'TECHNICAL · 30%', '40% 均線結構 + 25% 60 日動能 + 20% 季線斜率 + 15% 回撤／乖離', ['使用還原價格，至少 140 個交易日；20／60／120 日均線檢查中期排列。', '60 日動能分數 = 限制於 0–100 的（50 + 報酬率百分數 × 2）。', '季線斜率 = 現在 MA60 相對 20 日前 MA60 的變化；斜率分數 = 50 + 斜率百分數 × 5。', '穩定性分數 = 100 + 距 60 日高點回撤百分數 × 4 − 超過 15% 的月線正乖離 × 3，限制於 0–100。']],
    ['籌碼持續性', 'INSTITUTIONAL · 30%', '60% 標準化法人淨流向 + 40% 淨買進日比率', ['近 20 日法人淨買賣占成交量比率，轉為 50 + 比率百分數 × 5，限制於 0–100。', '淨買進日比率使用近 20 個交易日，資料至少覆蓋 18 日。', '法人原始單位為股，顯示張數除以 1,000；避免重複計入自營商合計與子項。', '第一版採法人流向，不宣稱已涵蓋券商分點、融資或大戶集中度。']],
    ['話題證據', 'CATALYST EVIDENCE · 15%', '50 + Σ（方向 × 實現係數 × 時間係數 × 25）', ['人工記錄正面／負面／中性事件，附上原文與事件日期。', '已實現 1、已確認 0.65、待驗證 0.25；時間係數為 max(0.1, 1 − 經過日數 / 100)。', '僅納入 90 天內事件，結果限制於 0–100；沒有事件時為缺值，不預設中性。', '新聞每次查近 3 個日曆日，只供閱讀；標題或新聞數量不自動視為利多。']],
    ['行業量化趨勢', 'INDUSTRY PROXY · 25%', '40% 季線廣度 + 40% 營收年增 + 20% 60 日動能', ['依你建立的研究族群成員聚合；名稱、順序與跨族群歸屬保留。', '取可用公司近三個月合計營收年增率的中位數；營收分數 = 50 + 年增百分數，限制於 0–100。', '至少 5 檔且覆蓋率 ≥50%；小於 5 檔的族群須全部取得。行情須在 7 日內，營收公布日在 65 日內。', '跨族群股票的行業分數取可用族群分數等權平均，不代表全市場產業動能。']],
    ['資金熱浪圖', 'SECTOR HEATMAP · 不計分', '面積 = 成交金額；顏色 = 漲跌幅；板塊漲跌 = Σ(漲跌 × 成交金額) ÷ Σ成交金額', ['全市場上市櫃四位數普通股，依證交所／櫃買產業別分板塊；上市與上櫃同名產業合併。', '資金增減只比較兩個交易日都有成交的同一批股票，避免新增或停牌股造成失真。', '顏色在 ±7% 達最飽和；≥ 9.5% 標記漲停、≤ −9.5% 標記跌停。', '成交金額代表交投熱度，不等於資金淨流入；不納入四維評分。']],
  ].map(([title, label, formula, items]) => `<section class="panel contentpad"><p class="eyebrow">${label}</p><h2>${title}</h2><div class="formula">${formula}</div><ul class="bullet-list">${items.map(t => `<li>${t}</li>`).join('')}</ul></section>`).join('')}<section class="panel contentpad"><p class="eyebrow">RULES</p><h2>缺值、日期與比較規則</h2><ul class="bullet-list"><li>缺漏因子排除後，按剩餘權重重新標準化；有效權重與「暫評」一併顯示。</li><li>完整分數才納入強勢統計；用「僅完整評分」可避免不同覆蓋率混比。</li><li>行情超過 7 個日曆日，綜合分數停止顯示。不同資料頻率以各自日期為準。</li><li>75 分以上強勢，55–74 中性偏強，40–54 中性偏弱，低於 40 弱勢。門檻屬設計規則，未經回測校準。</li></ul><div class="sources"><a href="https://finmind.github.io/tutor/TaiwanMarket/Technical/" target="_blank" rel="noopener noreferrer">日行情、還原價格與 PER／PBR ↗</a><a href="https://finmind.github.io/tutor/TaiwanMarket/Chip/" target="_blank" rel="noopener noreferrer">法人籌碼資料與欄位 ↗</a><a href="https://finmind.github.io/tutor/TaiwanMarket/Fundamental/" target="_blank" rel="noopener noreferrer">月營收、公告日期與單位 ↗</a></div></section></div>`;
}
function safeLink(url) { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } }

/* ---------- stock detail ---------- */
function candleChart(rows) {
  if (!rows?.length) return '<div class="empty">尚無還原價格資料</div>';
  const p = rows.slice(-90), all = rows, off = all.length - p.length;
  const avg = n => p.map((r, j) => { const idx = off + j; return idx >= n - 1 ? all.slice(idx - n + 1, idx + 1).reduce((s, r) => s + r.close, 0) / n : null; });
  const mas = { 20: avg(20), 60: avg(60), 120: avg(120) }, vals = Object.values(mas).flat().filter(v => v != null);
  const high = Math.max(...p.map(r => r.max ?? r.close), ...vals), low = Math.min(...p.map(r => r.min ?? r.close), ...vals), range = high - low || 1;
  const W = 900, Hh = 300, left = 10, right = 64, top = 16, bottom = 40, cw = (W - left - right) / p.length, px = v => top + (high - v) / range * (Hh - top - bottom), x = i => left + (i + .5) * cw;
  let svg = `<defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#22e6ff" stop-opacity=".08"/><stop offset="1" stop-color="#22e6ff" stop-opacity="0"/></linearGradient></defs><rect x="${left}" y="${top}" width="${W - left - right}" height="${Hh - top - bottom}" fill="url(#cg)"/>`;
  for (let i = 0; i < 5; i++) { const v = low + range * i / 4, y = px(v); svg += `<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="${C.grid}" stroke-dasharray="2 4"/><text x="${W - right + 8}" y="${y + 4}" fill="${C.text}" font-size="11" font-family="Consolas,monospace">${fmt(v, v < 100 ? 1 : 0)}</text>`; }
  p.forEach((r, i) => { const color = r.close >= (r.open ?? r.close) ? C.up : C.down; svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${px(r.max ?? r.close)}" y2="${px(r.min ?? r.close)}" stroke="${color}"/><rect x="${x(i) - cw * .3}" y="${px(Math.max(r.open ?? r.close, r.close))}" width="${Math.max(1, cw * .6)}" height="${Math.max(1, Math.abs(px(r.open ?? r.close) - px(r.close)))}" fill="${color}"/>`; });
  [[20, C.ma20], [60, C.ma60], [120, C.ma120]].forEach(([n, c]) => { const pts = mas[n].map((v, j) => v == null ? null : `${x(j)},${px(v)}`).filter(Boolean); if (pts.length) svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1.5" style="filter:drop-shadow(0 0 3px ${c})"/>`; });
  [0, Math.floor(p.length / 2), p.length - 1].forEach(i => svg += `<text x="${x(i)}" y="${Hh - 14}" fill="${C.text}" font-size="11" font-family="Consolas,monospace" text-anchor="${i === 0 ? 'start' : i === p.length - 1 ? 'end' : 'middle'}">${p[i].date}</text>`);
  return `<svg class="pricechart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="近 90 個交易日還原價格 K 線與 20、60、120 日均線">${svg}</svg>`;
}
async function openStock(id) { selectedId = id; const dialog = $('#detail-dialog'); if (!dialog.open) dialog.showModal(); $('#detail').innerHTML = '<div class="contentpad"><button data-action="close-detail" style="float:right">關閉</button><p><i class="spinner"></i>讀取個股診斷…</p></div>'; try { const s = await api(`detail?id=${id}`); if (selectedId !== id) return; renderDetail(s); fillDetailExtras(id, () => selectedId); } catch (e) { $('#detail').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><button data-action="close-detail">關閉</button></div>`; } }
function renderDetail(s) {
  $('#detail').innerHTML = `<div class="detailtop"><div><p class="eyebrow">Company Research / ${s.id}</p><h2>${esc(s.name)} <span class="stockcode">${s.market} · ${esc(s.groupNames?.join('、') || s.sector)}</span></h2><div class="price">${fmt(s.price, 2)} <span class="${cls(s.change)}" style="font-size:1rem">${pct(s.change)}</span></div><p>收盤日期 ${s.asOf || '尚未取得'} · 成交量 ${fmt(s.volume)} ${MK.unit()} · 產業 ${esc(s.sector)}</p></div><div class="actions">${watchSelect(s.id, s.name)}<button data-chart-live="${s.id}">走勢／五檔</button><button class="close" data-action="close-detail" aria-label="關閉個股診斷">×</button></div></div>
  <div class="detailbody"><div class="summaryband"><div class="bigscore">${fmt(s.score)}<small> /100</small></div><div class="summarytext"><strong>${esc(s.rating)} <span class="tag cyan">有效權重 ${s.coverage}%</span></strong><p>${s.complete ? '四維資料完整，可進一步檢視風險與估值。' : '部分因子仍待補齊；分數僅反映目前可用資料。'}<br>觀察期間 1–3 個月 · 不代表預測報酬或合理價值</p></div><button style="margin-left:auto" data-update-stock="${s.id}" ${state.job.running ? 'disabled' : ''}>⟳ 更新</button></div>
  <div class="factorcards">${Object.entries(factorNames).map(([k, l]) => `<div class="factorcard"><h3>${l} <small>${state.weights[k]}%</small></h3><b>${fmt(s[k].score)}</b><small>${s[k].date || '資料不足'}</small></div>`).join('')}</div>
  <section class="chartpanel"><div class="charttitle"><h3>中期價格結構</h3><div class="chartlegend"><span style="color:${C.ma20}">— MA20 ${fmt(s.technical.ma20, 1)}</span><span style="color:${C.ma60}">— MA60 ${fmt(s.technical.ma60, 1)}</span><span style="color:${C.ma120}">— MA120 ${fmt(s.technical.ma120, 1)}</span></div></div>${candleChart(s.adjustedBars)}<p class="chartcaption">${s.adjustedIsRaw ? '資料源沒有還原股價，K 線及均線使用原始價格；除權息前後可能失真。' : 'K 線及均線使用還原價格；上方收盤為原始成交價，除權息期間兩者可能不同。'}</p></section>
  <section class="panel"><div class="panelhead"><h3>估值與營運快照</h3><span class="fine">獨立呈現，不計入強弱分數</span></div><div class="tablewrap"><table><thead><tr><th>本益比 PER</th><th>股價淨值比 PBR</th><th>殖利率</th><th>近三月營收年增</th></tr></thead><tbody><tr><td class="num">${fmt(s.valuation.pe, 2)} 倍</td><td class="num">${fmt(s.valuation.pb, 2)} 倍</td><td class="num">${fmt(s.valuation.yield, 2)}%</td><td class="num ${cls(s.revenue.yoy)}">${pct(s.revenue.yoy)}</td></tr></tbody></table></div><div class="tablefoot">估值 ${s.valuation.date || '缺值'} · 營收期間 ${s.revenue.period || '缺值'} · 公布 ${s.revenue.date || '缺值'}</div></section>
  ${detailExtrasShell({ id: s.id, name: s.name, close: s.price })}
  <section class="diagnosis"><h3>分項診斷與證據</h3><table><tbody>${Object.entries(factorNames).map(([k, l]) => `<tr><td>${l}</td><td>${s[k].reasons.map(r => esc(r)).join('<br>')}</td></tr>`).join('')}</tbody></table></section>
  ${s.risks.length ? `<section class="riskbox"><h3>需要留意的條件</h3><ul class="bullet-list">${s.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}${Object.keys(s.errors).length ? `<details style="margin-top:18px"><summary>資料來源狀態</summary><ul class="bullet-list">${Object.entries(s.errors).map(([k, v]) => `<li>${esc(k)}：${esc(v)}</li>`).join('')}</ul></details>` : ''}
  <section class="detail-news"><div class="charttitle"><h3>事件與相關新聞</h3><div class="actions"><button data-action="add-evidence">新增事件判讀</button><button data-news-stock="${s.id}" ${state.job.running ? 'disabled' : ''}>取得近三日新聞</button></div></div>${s.evidence.map(e => eventCard(e)).join('')}${s.news.length ? s.news.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map(n => `<article class="event-card"><div class="event-top"><span>${esc(n.source)}</span><span>${esc(n.date)}</span></div><h3><a href="${safeLink(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title || '閱讀新聞原文')} ↗</a></h3></article>`).join('') : '<p class="fine">尚未取得新聞。新聞不自動計分；可在閱讀原文後新增事件判讀。</p>'}</section></div>`;
}

/* ---------- events (core) ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return; try {
    if (b.dataset.page) { setPage(b.dataset.page); return; }
    if (b.dataset.stock) { await openChart(b.dataset.stock, 'live'); return; }
    if (b.dataset.stockDetail) { await openStock(b.dataset.stockDetail); return; }
    if (b.dataset.sector) { sectorFilter = b.dataset.sector; query = ''; marketFilter = '全部'; scoreFilter = ''; completeOnly = false; sort = 'group'; page = 'overview'; index = 0; draw(); return; }
    if (b.dataset.market) { marketFilter = b.dataset.market; index = 0; draw(); return; }
    if (b.dataset.watch) { const id = b.dataset.watch; await api('watchlist', { ids: state.watchlist.includes(id) ? state.watchlist.filter(v => v !== id) : [...state.watchlist, id] }); await load(); if ($('#detail-dialog').open) await openStock(selectedId); return; }
    if (b.dataset.updateStock) { await startUpdate('selected', [b.dataset.updateStock]); return; }
    if (b.dataset.newsStock) { await api('news', { id: b.dataset.newsStock }); toast('正在取得近三個日曆日新聞'); await load(); return; }
    if (b.dataset.deleteEvent) { await api('evidence', { deleteId: b.dataset.deleteEvent }); await load(); toast('事件已移除，分數已重新計算'); return; }
    if (b.dataset.reviewNews !== undefined) { const n = state.headlines[Number(b.dataset.reviewNews)]; const f = $('#evidence-form'); if (n && f) { f.elements.stockId.value = n.stockId; f.elements.title.value = (n.title || '').slice(0, 180); f.elements.url.value = n.url; f.elements.date.value = n.date.slice(0, 10); f.elements.direction.value = 'neutral'; f.elements.stage.value = 'watch'; f.elements.title.focus(); toast('已帶入新聞來源，請閱讀原文並選擇影響方向與證據進度'); } return; }
    const action = b.dataset.action;
    if (action === 'menu') { $('.sidebar').classList.toggle('open'); return; }
    if (action === 'close-detail') { $('#detail-dialog').close(); selectedId = null; return; }
    if (action === 'add-evidence') { const id = selectedId; $('#detail-dialog').close(); setPage('topics'); $('#evidence-form [name=stockId]').value = id; $('#evidence-form [name=title]').focus(); return; }
    if (action === 'update' || action === 'update-watch') { await startUpdate(action === 'update-watch' || page === 'watchlist' ? 'watchlist' : 'all'); return; }
    if (action === 'update-all') { await startUpdate('all'); return; }
    if (action === 'update-universe') { await startUpdate('universe'); return; }
    if (action === 'cancel') { await api('cancel', {}); toast('已要求停止，已取得資料將保留'); return; }
    if (action === 'clear') { query = ''; sectorFilter = ''; scoreFilter = ''; completeOnly = false; marketFilter = '全部'; watchGroupFilter = ''; index = 0; draw(); return; }
    if (action === 'watch-groups') { groupEditOpen = !groupEditOpen; draw(); if (groupEditOpen) $('#wg-new')?.focus(); return; }
    if (action === 'next') { index++; $('#stocktable').innerHTML = stockTable(); return; }
    if (action === 'prev') { index = Math.max(0, index - 1); $('#stocktable').innerHTML = stockTable(); return; }
    if (action === 'remove-token') { await api('token', { remove: true }); await load(); toast('本專案保存的金鑰已移除'); return; }
    if (action === 'export') { exportCSV(); return; }
  } catch (err) { toast(err.message); }
});
async function startUpdate(scope, ids = []) { await api('update', { scope, ids }); await load(); toast(scope === 'all' ? '研究名單已加入更新佇列；可隨時停止與續傳' : '已開始更新，完成後分數會重新計算'); }
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); $('#search')?.focus(); } });
document.addEventListener('input', e => { if (e.target.id === 'search') { query = e.target.value.trim(); index = 0; if (page === 'patterns') { patternSearch = query; patternPageIndex = 0; $('#pattern-results').innerHTML = patternTable(); return; } if (!['overview', 'watchlist'].includes(page)) { page = 'overview'; draw(); } else $('#stocktable').innerHTML = stockTable(); } });
document.addEventListener('change', e => { const id = e.target.id; if (id === 'sector-filter') { sectorFilter = e.target.value; sort = sectorFilter ? 'group' : 'score'; draw(); return; } else if (id === 'sort-filter') sort = e.target.value; else if (id === 'score-filter') scoreFilter = e.target.value; else if (id === 'complete-filter') completeOnly = e.target.checked; else return; index = 0; $('#stocktable').innerHTML = stockTable(); });
document.addEventListener('submit', async e => {
  const f = e.target; if (!['token-form', 'settings-form', 'evidence-form'].includes(f.id)) return; e.preventDefault(); const data = Object.fromEntries(new FormData(f)), submit = f.querySelector('button[type=submit]'); submit.disabled = true; try {
    if (f.id === 'token-form') { await api('token', { token: data.token.trim() }); f.reset(); toast('FinMind 金鑰已驗證並加密儲存'); }
    else if (f.id === 'settings-form') { await api('settings', { weights: Object.fromEntries(Object.keys(factorNames).map(k => [k, Number(data[k])])), interval: Number(data.interval), autoScope: data.autoScope, autoUpdate: data.autoUpdate === 'on', updateTime: data.updateTime }); formDrafts.delete(f.id); toast('設定已儲存'); }
    else if (f.id === 'evidence-form') { await api('evidence', data); formDrafts.delete(f.id); toast('事件判讀已儲存，評分已更新'); }
    await load();
  } catch (err) { toast(err.message); submit.disabled = false; }
});
function exportCSV() { const rows = filtered(), columns = ['代碼', '名稱', '市場', '產業', '收盤日期', '收盤', '漲跌%', '綜合分數', '技術', '籌碼', '話題', '行業', '有效權重%', '評級']; const safe = v => `"${String(v ?? '').replace(/^[=+@\-]/, "'$&").replace(/"/g, '""')}"`; const lines = [columns, ...rows.map(s => [s.id, s.name, s.market, s.sector, s.asOf, s.price, s.change, s.score, s.technical.score, s.chips.score, s.topic.score, s.industry.score, s.coverage, s.rating])].map(r => r.map(safe).join(',')); const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = `Nexus-${state.cutoff}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`已匯出 ${rows.length} 檔股票`); }
$('#detail-dialog').addEventListener('click', e => { if (e.target === $('#detail-dialog')) { $('#detail-dialog').close(); selectedId = null; } });
$('#detail-dialog').addEventListener('close', () => { selectedId = null; });

/* ---------- groups ---------- */
function groupPage() {
  return `<div class="notice"><span>依「${esc(state.scopeSource?.name || '自訂名單')}」順序顯示 ${state.groups.length} 個族群、${state.scopeEntries} 筆成員，共 ${state.stocks.length} 檔不重複股票。跨族群成員保留，研究總表只計一次。</span><button class="primary" data-action="new-group">＋ 新增族群</button></div><div class="sectorgrid">${state.sectors.map((g, i) => `<article class="panel sector-card"><div class="sector-top"><h2>${esc(g.name)}</h2><span class="tag">${String(i + 1).padStart(2, '0')}</span></div><div class="number">${fmt(g.score)} <small class="soft">/ 100</small></div><div class="sector-bar"><i style="width:${g.score ?? 0}%"></i></div><div class="meta" style="margin-top:12px">站上季線比率 <span class="num">${fmt(g.breadth)}%</span><br>近三月營收年增中位數 <span class="num ${cls(g.growth)}">${pct(g.growth)}</span><br>資料覆蓋 <span class="num">${g.covered} / ${g.count} 檔（${g.coverage}%）</span></div><div class="group-members">${g.stockIds.slice(0, 6).map(id => { const s = state.stocks.find(s => s.id === id); return `<button class="member-chip" data-stock="${id}">${id} ${esc(s?.name || id)}</button>`; }).join('')}${g.stockIds.length > 6 ? `<span class="fine">另 ${g.stockIds.length - 6} 檔</span>` : ''}${!g.count ? '<span class="fine">尚無個股，新增後即納入研究範圍。</span>' : ''}</div><div class="group-actions"><button data-sector="${esc(g.id)}">查看個股 →</button><button data-add-stock="${esc(g.id)}">＋ 新增個股</button></div></article>`).join('')}</div>`;
}
let pickerChoice = null, pickerSequence = 0, pickerTimer, pickerResults = [];
function showGroupEditor(kind, groupId) {
  const dialog = $('#group-dialog'); pickerChoice = null; pickerSequence++;
  if (kind === 'group') $('#group-editor').innerHTML = `<div class="detailtop"><div><p class="eyebrow">Research Groups</p><h2>新增族群</h2><p>新族群會接在現有族群後方，原有名稱與順序保留。</p></div><button data-close-group aria-label="關閉">×</button></div><form id="group-form" class="contentpad"><label class="field">族群名稱<input name="name" required maxlength="40" placeholder="例如：先進封裝" autocomplete="off"></label><p id="group-error" class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">建立族群</button><button type="button" data-close-group>取消</button></div></form>`;
  else { const g = state.groups.find(g => g.id === groupId); if (!g) return; $('#group-editor').innerHTML = `<div class="detailtop"><div><p class="eyebrow">${esc(g.name)}</p><h2>新增個股</h2><p>確認加入後，該股票才會納入本專案研究與更新。</p></div><button data-close-group aria-label="關閉">×</button></div><form id="group-stock-form" class="contentpad"><input name="groupId" type="hidden" value="${esc(g.id)}"><label class="field">搜尋股票代碼或名稱<input id="stock-picker-search" autocomplete="off" placeholder="例如 2330、台積電"></label><div id="picker-results" class="picker-results" aria-live="polite"><p class="fine">查詢股票基本資料不會下載或分析名單外行情。</p></div><div id="picker-choice"></div><p id="group-error" class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit" id="confirm-add-stock" disabled>加入族群</button><button type="button" data-close-group>取消</button></div></form>`; }
  if (!dialog.open) dialog.showModal(); dialog.querySelector('input:not([type=hidden])')?.focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.action === 'new-group') showGroupEditor('group');
  if (b.dataset.addStock) showGroupEditor('stock', b.dataset.addStock);
  if (b.hasAttribute('data-close-group')) { $('#group-dialog').close(); pickerSequence++; }
  if (b.dataset.pickStock) { const s = pickerResults.find(s => s.id === b.dataset.pickStock); if (!s) return; pickerChoice = s; $('#confirm-add-stock').disabled = false; $('#picker-choice').innerHTML = `<div class="notice" style="margin:14px 0 0"><span>已選擇 <strong>${esc(s.id)} ${esc(s.name)}</strong> · ${esc(s.market)}${s.listingNote ? `<br>${esc(s.listingNote)}` : ''}</span></div>`; }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'stock-picker-search') return;
  const q = e.target.value.trim(), sequence = ++pickerSequence; pickerChoice = null; $('#confirm-add-stock').disabled = true; $('#picker-choice').innerHTML = ''; clearTimeout(pickerTimer);
  if (!q) { $('#picker-results').innerHTML = '<p class="fine">輸入股票代碼或名稱開始查詢。</p>'; return; }
  $('#picker-results').innerHTML = '<p class="fine"><i class="spinner"></i>查詢中…</p>';
  pickerTimer = setTimeout(async () => { try { const data = await api(`catalog?q=${encodeURIComponent(q)}`); if (sequence !== pickerSequence || !$('#group-dialog').open) return; pickerResults = data.stocks; const group = state.groups.find(g => g.id === $('#group-stock-form [name=groupId]').value); $('#picker-results').innerHTML = pickerResults.length ? pickerResults.map(s => `<button type="button" class="picker-row" data-pick-stock="${s.id}" ${group.stockIds.includes(s.id) ? 'disabled' : ''}><span><strong>${s.id} ${esc(s.name)}</strong><small>${esc(s.market)}${s.listingNote ? ' · 狀態須留意' : ''}</small></span><span class="tag">${group.stockIds.includes(s.id) ? '已在此族群' : s.inScope ? '已在其他族群' : '加入後開始研究'}</span></button>`).join('') : '<p class="fine">查無符合的股票。可在「資料與設定」更新股票基本資料後重試。</p>'; } catch (err) { if (sequence === pickerSequence && $('#picker-results')) $('#picker-results').textContent = err.message; } }, 180);
});
document.addEventListener('submit', async e => {
  const form = e.target; if (!['group-form', 'group-stock-form'].includes(form.id)) return; e.preventDefault();
  const submit = form.querySelector('[type=submit]'); submit.disabled = true; $('#group-error').textContent = '';
  try {
    if (form.id === 'group-form') { const result = await api('groups', { name: form.elements.name.value }); await load(false); page = 'sectors'; draw(); showGroupEditor('stock', result.group.id); toast('族群已建立，可以接著新增個股'); }
    else { if (!pickerChoice) throw new Error('請先從查詢結果選擇股票'); const result = await api('group-stocks', { groupId: form.elements.groupId.value, stockId: pickerChoice.id }); $('#group-dialog').close(); pickerSequence++; await load(); toast(result.added ? (result.needsUpdate ? '已加入研究範圍，請更新此股以取得行情' : '已加入族群，已套用現有行情重新評分') : '此股已在族群內，未重複新增'); }
  } catch (err) { $('#group-error').textContent = err.message; submit.disabled = false; }
});
$('#group-dialog').addEventListener('close', () => { pickerChoice = null; pickerSequence++; clearTimeout(pickerTimer); });

/* ---------- patterns ---------- */
let patternState = null, patternType = '', patternCategory = '', patternStatus = '', patternSector = '', patternSort = 'category', patternPageIndex = 0, patternSearch = '', patternError = '';
async function loadPatterns() { try { patternState = await api('patterns'); patternError = ''; } catch (e) { patternError = e.message; } if (page === 'patterns') draw(); }
function patternRows() { if (!patternState) return []; let rows = patternState.stocks.flatMap(s => s.matches.map(m => ({ ...s, ...m, stockId: s.id, patternId: m.id, name: s.name, patternName: m.name }))).filter(s => (!patternType || s.patternId === patternType) && (!patternCategory || s.category === patternCategory) && (!patternStatus || s.status === patternStatus) && (!patternSector || s.sector === patternSector) && (!patternSearch || `${s.stockId} ${s.name}`.includes(patternSearch))); rows.sort((a, b) => (patternSort === 'category' ? a.category.localeCompare(b.category, 'zh-TW') || a.patternId.localeCompare(b.patternId) : patternSort === 'sector' ? a.sector.localeCompare(b.sector, 'zh-TW') : 0) || b.score - a.score || a.stockId.localeCompare(b.stockId)); return rows; }
function patternPage() {
  if (!patternState) return `<section class="panel empty">${patternError ? esc(patternError) : '<i class="spinner"></i>正在掃描全市場 90 日型態…'}<div style="margin-top:14px"><button data-pattern-action="reload">重新掃描</button></div></section>`;
  const s = patternState, rows = patternRows(); patternPageIndex = Math.min(patternPageIndex, Math.max(0, Math.ceil(rows.length / 12) - 1));
  return `<div class="notice"><span>${s.scope === 'local' ? '研究名單與自選股篩選（資料源沒有全市場單日行情）' : '獨立全市場篩選'} · <span class="mono">${s.from || '—'} → ${s.asOf || '—'}</span> · 90 個交易日 · 五日均量 ≥ ${fmt(s.minVolume)}${MK.unit() ? ' ' + MK.unit() : ''}<small style="display:block;margin-top:4px">${s.snapshotCompletedAt ? '完整快照發布：' + MK.dateTime(s.snapshotCompletedAt) : '沿用既有價量快取；行情日期以上方標示為準'}</small></span><button class="primary" data-pattern-action="update" ${state.job.running ? 'disabled' : ''}>⟳ 更新型態資料</button></div>
  <section class="stats">${[['普通股索引', s.universe, '股票清單中的普通股', 'UNIVERSE'], ['產業條件通過', s.industryEligible, s.excludedIndustries?.length ? '排除指定產業' : '排除 ETF、基金等', 'FILTER'], ['資料及流動性通過', s.eligible, '90 日完整且五日均量達標', 'LIQUIDITY'], ['符合型態', s.matched, `${s.patternCount} 筆型態 · 同股可多型態`, 'MATCHED']].map(([a, b, c, k], i) => `<article class="stat"><span class="label">${a} <i>${k}</i></span><div class="value ${i === 3 ? 'glow' : ''}">${fmt(b)}</div><p>${c}</p></article>`).join('')}</section>
  <section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>型態機會清單</h2><p>依類別與強弱排序 · 分數為規則吻合程度，不是勝率 · 不改動研究族群</p></div><button data-pattern-action="reload">重新掃描快取</button></div>
  <div class="filters"><input id="pattern-search" aria-label="型態股票搜尋" placeholder="代碼／名稱" value="${esc(patternSearch)}" style="max-width:150px"><select id="pattern-category" aria-label="型態類別"><option value="">所有類別</option>${['反轉型', '延續型', '整理突破型'].map(x => `<option ${patternCategory === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select id="pattern-type" aria-label="型態名稱"><option value="">全部 10 種型態</option>${s.types.map(x => `<option value="${x.id}" ${patternType === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}</select><select id="pattern-status" aria-label="確認狀態"><option value="">所有確認狀態</option>${['量價確認', '突破待次日確認', '突破待量確認', '接近突破'].map(x => `<option ${patternStatus === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select id="pattern-sector" aria-label="型態產業"><option value="">所有產業</option>${[...new Set(s.stocks.map(x => x.sector))].sort().map(x => `<option ${patternSector === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><select id="pattern-sort" aria-label="型態排序">${[['category', '類別／型態 → 強弱'], ['score', '全部依強弱'], ['sector', '產業 → 強弱']].map(([v, l]) => `<option value="${v}" ${patternSort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div id="pattern-results">${patternTable(rows)}</div></section>
  <details class="panel contentpad" style="margin-top:16px"><summary>辨識方法、限制與未納入清單（${s.exclusions.length} 檔）</summary><p>排除：${s.excludedIndustries.join('、')}。交易日期：${s.calendarSource}。偵測使用還原 OHLC，再按最新原始／還原收盤比換算為目前價格尺度；成交量使用未還原實際股數。</p><p>強度 = 結構吻合（最多 40）＋突破確認（8／18／30）＋量比（最多 20）＋站上 20 日均價（10）。量價確認需收盤超過頸線 0.15 ATR，突破日量 ≥ 前 20 日均量 1.3 倍，並未跌回頸線下 0.35 ATR。</p><p>進場帶為頸線 + 0.2～0.75 ATR，防守為結構支撐 − 0.25 ATR；價格按一般股票跳動單位取整。量度目標為頸線 + 型態高度。這些門檻是透明的工程規則，尚未回測校準。</p><div class="pattern-audit">${s.exclusions.map(x => `<div>${esc(x.id)} ${esc(x.name)} · ${esc(x.sector)} · ${esc(x.reason)}${x.avg5 != null ? `（${fmt(x.avg5, 2)} 張）` : ''}</div>`).join('')}</div><p>另有 ${s.unmatched.length} 檔通過基本條件但未符合本次型態規則。</p></details>`;
}
function patternTable(rows = patternRows()) { const part = rows.slice(patternPageIndex * 12, (patternPageIndex + 1) * 12); return `<div class="tablewrap"><table><thead><tr><th>公司／產業</th><th>型態／類別</th><th>強度</th><th>確認狀態</th><th>五日均量</th><th>條件進場帶</th><th>結構防守</th><th>自選</th><th>檢視</th></tr></thead><tbody>${part.map(s => `<tr><td class="stockcell"><strong>${esc(s.name)} <span class="stockcode">${s.stockId}</span></strong><small class="soft" style="display:block;margin-top:4px">${esc(s.sector)} · ${s.market}</small></td><td>${s.patternName}<small class="soft" style="display:block">${s.category}</small></td><td>${scoreCell(s.score)}</td><td><span class="tag ${s.status === '量價確認' ? 'up' : 'cyan'}">${s.status}</span><small class="soft" style="display:block;margin-top:4px">${esc(s.plan.action)}</small></td><td class="num">${fmt(s.avg5)} 張</td><td class="num">${fmt(s.plan.entry, 2)}–${fmt(s.plan.entryMax, 2)}</td><td class="num down">${fmt(s.plan.stop, 2)}</td><td>${watchSelect(s.stockId, s.name)}</td><td><button data-pattern-stock="${s.stockId}" data-pattern-id="${s.patternId}">圖形與計畫 ↗</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">沒有符合目前條件的型態；可放寬篩選或更新資料。</td></tr>'}</tbody></table></div><div class="tablefoot"><span>${rows.length} PATTERNS（同股可有多筆）</span><div class="pagination"><button data-pattern-action="prev" ${patternPageIndex === 0 ? 'disabled' : ''}>‹</button><span>${patternPageIndex + 1} / ${Math.max(1, Math.ceil(rows.length / 12))}</span><button data-pattern-action="next" ${(patternPageIndex + 1) * 12 >= rows.length ? 'disabled' : ''}>›</button></div></div>`; }
function patternChart(s, m) {
  const p = s.bars, w = 960, h = 340, left = 50, right = 870, top = 24, bottom = 258; const lo = Math.min(...p.map(x => x.min), m.plan.stop), hi = Math.max(...p.map(x => x.max), m.resistance); const x = i => left + i / 89 * (right - left), y = v => bottom - (v - lo) / (hi - lo || 1) * (bottom - top); const vol = Math.max(...p.map(x => x.volume));
  const si = p.findIndex(r => r.date === m.start), ei = p.findIndex(r => r.date === m.end);
  return `<svg viewBox="0 0 ${w} ${h}" class="pattern-chart" role="img" aria-label="${esc(s.name)} 90 日 K 線與 ${m.name} 壓力支撐"><rect x="${x(si)}" y="18" width="${x(ei) - x(si)}" height="245" fill="#22e6ff" opacity=".06" stroke="#22e6ff" stroke-opacity=".25" stroke-dasharray="3 4"/>${Array.from({ length: 5 }, (_, i) => { const v = lo + (hi - lo) * i / 4; return `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="880" y="${y(v) + 4}" fill="${C.text}" font-size="11" font-family="Consolas,monospace">${fmt(v, 2)}</text>`; }).join('')}${p.map((r, i) => `<line x1="${x(i)}" x2="${x(i)}" y1="${y(r.max)}" y2="${y(r.min)}" stroke="${r.close >= r.open ? C.up : C.down}"/><rect x="${x(i) - 2.5}" y="${Math.min(y(r.open), y(r.close))}" width="5" height="${Math.max(1, Math.abs(y(r.open) - y(r.close)))}" fill="${r.close >= r.open ? C.up : C.down}"/><rect x="${x(i) - 2.5}" y="${318 - r.volume / vol * 42}" width="5" height="${r.volume / vol * 42}" fill="${C.vol}"/>`).join('')}${m.lines.map((l, i) => `<line x1="${x(l.from)}" x2="${x(l.to)}" y1="${y(l.a)}" y2="${y(l.b)}" stroke="${i ? C.down : C.ma20}" stroke-width="2" stroke-dasharray="6 4"/><text x="${x(l.from) + 3}" y="${y(l.a) - 6}" fill="${i ? C.down : C.ma20}" font-size="11">${l.label}</text>`).join('')}${m.anchors.map(a => `<circle cx="${x(a.index)}" cy="${y(a.price)}" r="3.5" fill="#22e6ff" style="filter:drop-shadow(0 0 4px #22e6ff)"><title>${esc(a.label)} ${a.date} ${a.price}</title></circle>`).join('')}<text x="50" y="338" fill="${C.text}" font-size="11">${p[0].date} · 成交量（張）</text><text x="800" y="338" fill="${C.text}" font-size="11">${s.asOf}</text></svg>`;
}
async function openPattern(id, type) {
  const s = await api('pattern-detail?id=' + id), m = s.matches.find(x => x.id === type); if (!m) throw new Error('型態已改變，請重新掃描'); const p = m.plan;
  $('#pattern-detail').innerHTML = `<div class="detailtop"><div><p class="eyebrow">90 Session Pattern Study</p><h2>${esc(s.name)} <span class="stockcode">${s.id}</span> · ${m.name}</h2><p>${esc(s.sector)} · ${s.asOf} 收盤 ${fmt(s.price, 2)} · 五日均量 ${fmt(s.avg5)} ${MK.unit()}</p></div><div class="actions">${watchSelect(s.id, s.name)}<button data-pattern-action="close" aria-label="關閉型態明細">×</button></div></div><div class="detailbody"><div class="summaryband"><div class="bigscore">${m.score}<small>/100</small></div><div class="summarytext"><strong>${m.status} · ${m.category}</strong><p>${esc(m.description)}</p><p>區間 ${m.start} → ${m.end} · ${m.breakoutDate ? '首次突破 ' + m.breakoutDate : '尚未突破'} · 量比 ${fmt(m.volumeRatio, 2)} 倍</p></div></div><section class="chartpanel">${patternChart(s, m)}<p class="chartcaption">90 日還原 K 線按最新收盤換算為目前價格尺度；琥珀線為頸線／壓力、綠線為結構支撐、青色圓點為辨識轉折。ATR14 ${fmt(m.atr, 2)}。</p></section><section class="panel contentpad"><h3>為何判定此型態</h3><p>${esc(m.description)}</p><p>${m.anchors.map(a => `${esc(a.label)} ${a.date}：${fmt(a.price, 2)}`).join('；') || '依區段均價與通道斜率判斷。'}</p><p>結構 ${m.scoreParts.geometry} + 確認 ${m.scoreParts.confirmation} + 量能 ${m.scoreParts.volume} + 均線 ${m.scoreParts.trend}；分數非勝率。</p></section><section class="panel contentpad" style="margin-top:14px"><h3>條件式進場與防守 · ${esc(p.action)}</h3><div class="factorcards" style="margin-top:12px">${[['進場帶', `${fmt(p.entry, 2)}–${fmt(p.entryMax, 2)}`], ['結構防守', fmt(p.stop, 2)], ['量度觀察位', fmt(p.target, 2)], ['估算淨 R/R', fmt(p.rr, 2)]].map(([a, b]) => `<div class="factorcard"><h3>${a}</h3><b>${b}</b></div>`).join('')}</div><p>${esc(p.confirmation)}</p><p>${esc(p.defense)}</p><p>${esc(p.targetBasis)} 以進場帶上緣估算價格風險 ${p.riskPercent}%；淨 R/R 假設往返成本及滑價 0.6%。</p><p>${esc(p.timing)}</p><p>${esc(p.missing)}</p></section><section class="riskbox"><h3>失效與誤判提醒</h3><ul class="bullet-list">${m.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></section></div>`;
  $('#pattern-dialog').showModal();
}
document.addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return; try { if (b.dataset.patternStock) { await openPattern(b.dataset.patternStock, b.dataset.patternId); return; } const a = b.dataset.patternAction; if (!a) return; if (a === 'close') { $('#pattern-dialog').close(); return; } if (a === 'reload') { await loadPatterns(); return; } if (a === 'update') { await api('pattern-update', {}); await load(); toast('型態全市場更新已啟動，可隨時停止'); return; } if (a === 'prev' || a === 'next') { patternPageIndex += a === 'next' ? 1 : -1; $('#pattern-results').innerHTML = patternTable(); } } catch (e) { toast(e.message); } });
document.addEventListener('change', e => { const map = { 'pattern-category': v => patternCategory = v, 'pattern-type': v => patternType = v, 'pattern-status': v => patternStatus = v, 'pattern-sector': v => patternSector = v, 'pattern-sort': v => patternSort = v }; if (map[e.target.id]) { map[e.target.id](e.target.value); patternPageIndex = 0; draw(); } });
document.addEventListener('input', e => { if (e.target.id === 'pattern-search') { patternSearch = e.target.value.trim(); patternPageIndex = 0; $('#pattern-results').innerHTML = patternTable(); } });

/* ---------- flows ---------- */
let flowContract, flowStrikePage = 0, flowDate = '', flowData = null, flowLoading = false, flowError = '', flowCached = false;
const flowToday = () => MK.today();
function flowPage() {
  const d = flowData;
  return `<section class="panel contentpad"><form id="flow-form" class="flow-controls"><label class="field">交易日期<input id="flow-date" type="date" min="2018-06-05" max="${flowToday()}" value="${flowDate || flowToday()}" required ${flowLoading ? 'disabled' : ''}></label><button class="primary" type="submit" ${flowLoading ? 'disabled' : ''}>${flowLoading ? '<i class="spinner"></i>查詢中…' : '⟳ 查詢 FinMind'}</button><button type="button" data-flow-cache ${flowLoading ? 'disabled' : ''}>讀取此日本機紀錄</button></form><p>手動查詢 · 不加入每日排程 · 全市場普通股排行，不受自訂族群與型態選股的產業排除限制。圖卡維持白底 9:16，方便手機閱讀與分享。</p><p class="form-error" role="alert">${esc(flowError)}</p>${flowLoading ? '<p role="status">正在依序取得股票索引、個股法人、現貨彙總與期貨部位，可切換頁面等待。</p>' : ''}</section>
  ${!d ? '<section class="panel empty" style="margin-top:16px">選擇日期後按下查詢。休市或尚未公布時會顯示缺資料。</section>' : `<div class="notice" style="margin-top:16px"><span><strong class="mono">${esc(d.date)}</strong> · ${flowCached ? '本機紀錄' : '本次查詢'} · 取得時間 ${esc(MK.dateTime(d.retrievedAt))}<br>普通股索引 ${fmt(d.coverage.indexed)} 檔，當日有法人紀錄 ${fmt(d.coverage.withRecords)} 檔。</span><button data-flow-export>↓ 排行 CSV</button></div>${d.stocksSource === 'twse' ? '<p class="notice">全市場個股法人資料改用證交所／櫃買中心公開資料（FinMind 免費方案不支援全市場批次查詢）。</p>' : ''}${Object.entries(d.errors).map(([k, v]) => `<p class="notice err" role="alert">${esc(({ info: '股票索引', stocks: '個股法人', total: '現貨彙總', futures: '期貨部位', options: '選擇權法人', optionDaily: '選擇權履約價' })[k])}：${esc(v)}</p>`).join('')}${renderFlowCards(d, { contract: flowContract, page: flowStrikePage })}<details class="panel contentpad"><summary>資料口徑與限制</summary><p>外資含 Foreign_Investor 與 Foreign_Dealer_Self；投信為 Investment_Trust。排行依未四捨五入股數排序，顯示至 0.001 張。買超及賣超各取最多 20 檔，不以 0 或空資料補足名次。</p><p>依 FinMind 股票索引辨認上市／上櫃四位數普通股，排除 ETF、ETN、權證與牛熊等商品；歷史查詢仍採最新可用股票分類。缺漏值顯示 —，不當作 0。</p><p>FinMind 沒有全市場個股法人資料時，改用證交所 T86 與櫃買中心三大法人買賣明細；上市、上櫃都必須是查詢日期且有足夠檔數才採用，否則顯示錯誤、不產生排行。</p><p>${d.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ')}</p></details>`}`;
}
document.addEventListener('change', e => { if (e.target.id === 'flow-date') { flowDate = e.target.value; flowData = null; flowError = ''; draw(); } });
async function runFlow(cached = false) { if (flowLoading) return; flowDate = $('#flow-date')?.value || flowDate || flowToday(); flowLoading = true; flowError = ''; flowData = null; draw(); try { const r = await api(cached ? 'flows?date=' + encodeURIComponent(flowDate) : 'flows/query', cached ? undefined : { date: flowDate }); flowData = r.data; flowContract = flowData?.options?.defaultContract; const c = flowData?.options?.contracts?.find(c => c.contract === flowContract); flowStrikePage = Math.max(0, Math.floor((c?.strikes.findIndex(r => r.strike === c.callPeak) || 0) / 20)); flowCached = cached; if (!flowData) flowError = '此日沒有本機紀錄，請按「查詢 FinMind」。'; } catch (e) { flowError = e.message; } finally { flowLoading = false; if (page === 'flows') draw(); } }
document.addEventListener('submit', e => { if (e.target.id === 'flow-form') { e.preventDefault(); runFlow(); } });
document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.hasAttribute('data-flow-cache')) runFlow(true); if (b.hasAttribute('data-flow-export') && flowData) { const cell = v => '"' + String(v).replaceAll('"', '""') + '"'; const rows = [['日期', '市場', '法人', '方向', '名次', '代碼', '名稱', '買賣超股數', '買賣超張數']]; for (const r of flowData.rankings) for (const [key, label] of [['buy', '買超'], ['sell', '賣超']]) r[key].forEach((s, i) => rows.push([flowData.date, r.market, ({ foreign: '外資', trust: '投信', dealer: '自營商', total: '三大法人合計' })[r.investor], label, i + 1, s.id, s.name, s.netShares, s.netLots])); const url = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'Nexus-法人排行-' + flowData.date + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } });
document.addEventListener('click', async e => { const b = e.target.closest('[data-flow-image]'); if (!b || !flowData) return; b.disabled = true; try { await downloadFlowCard(b, flowData.date); } catch (e) { toast(e.message); } finally { b.disabled = false; } });
document.addEventListener('change', e => { if (e.target.id === 'flow-contract') { flowContract = e.target.value; const c = flowData?.options?.contracts.find(c => c.contract === flowContract); flowStrikePage = Math.max(0, Math.floor((c?.strikes.findIndex(r => r.strike === c.callPeak) || 0) / 20)); } else if (e.target.id === 'flow-strikes') flowStrikePage = Number(e.target.value); else return; const grid = document.querySelector('.flow-image-grid'); if (grid) grid.outerHTML = renderFlowCards(flowData, { contract: flowContract, page: flowStrikePage }); });

/* ---------- boot & polling ---------- */
/* ---------- 介面與使用偏好 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pref],[data-pref-reset]'); if (!b) return;
  if (b.hasAttribute('data-pref-reset')) { setPrefs({ ...PREF_DEFAULTS }); draw(); toast('已恢復預設介面設定'); return; }
  const key = b.dataset.pref, raw = b.dataset.value, value = raw === 'true' ? true : raw === 'false' ? false : /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  setPrefs({ [key]: value }); const y = window.scrollY; draw(); window.scrollTo(0, y);
});
document.addEventListener('change', e => { const k = e.target.dataset?.prefSelect; if (k) { setPrefs({ [k]: e.target.value }); toast('下次開啟衡析時生效'); } });

try { applyState(await api('state')); await setLanguage(state.config?.language || 'zh-TW'); draw(); if (page === 'patterns') loadPatterns(); if (page === 'live') enterLive(); if (page === 'grouprank') enterGroupRank(); if (page === 'chips') enterChips(); } catch (e) { $('#app').innerHTML = `<div class="boot"><b>NEXUS OFFLINE</b><p>暫時無法連接本機服務：${esc(e.message)}。請重新啟動衡析 Nexus 後重新整理。</p></div>`; }
let pollBusy = false;
setInterval(async () => { if (!state || document.hidden || pollBusy) return; pollBusy = true; try { const previous = state.job.running; await load(false); if (previous && !state.job.running && page === 'patterns') await loadPatterns(); if (previous || state.job.running) { if (['settings', 'topics', 'flows', 'heatmap'].includes(page) || document.querySelector('dialog[open]')) return; draw(); if (previous && !state.job.running && $('#detail-dialog').open && selectedId) await openStock(selectedId); } } catch { } finally { pollBusy = false; } }, 5000);
