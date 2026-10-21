// 衡析 Nexus：首次設定精靈，以及「資料與設定」頁的系統設定（介面語言、研究市場、資料來源與金鑰、推理模型、研究族群、設定檔匯出入）。
// 所有設定與金鑰只存在這台電腦；金鑰由作業系統的金鑰保管機制加密保存，頁面不會讀回。
import { t, setLanguage } from './i18n.js';

let C = null;
const S = { step: 0, cfg: null, loading: null, models: {}, llmDraft: null, groupsOpen: {}, template: undefined };
export function initSetup(ctx) { C = ctx; }
const esc = s => C.esc(s);
async function loadConfig(force = false) {
  if (S.cfg && !force) return S.cfg;
  if (!S.loading) S.loading = C.api('config').then(c => { S.cfg = c; return c; }).finally(() => { S.loading = null; });
  return S.loading;
}
const lang = () => S.cfg?.config.language || C.state()?.config?.language || 'zh-TW';
const nameOf = n => typeof n === 'string' ? n : n?.[lang()] || n?.en || '';

// 資料源說明（繁中原文，畫面自動翻譯）
const PROVIDER_NOTES = {
  finmind: '台股資料最完整：日 K、還原股價、法人、營收、本益比、新聞、股權分散、期貨；Sponsor 方案另有盤中即時快照、分 K、全市場單日資料、券商分點，以及當沖監控用的可當沖標的、暫停交易與參考價。',
  twse: '證交所與櫃買中心的官方開放資料，免金鑰：股票清單、交易日曆、日 K、全市場單日行情、法人（全市場逐日）、本益比、月營收。沒有盤中即時資料與還原股價。',
  fugle: '富果行情 API：台股日 K（含還原股價）、分 K，以及盤中雷達與當沖監控用的 WebSocket 即時推播。訂閱數（1 檔 × 1 個頻道）：基本 5、開發者 300、進階 2,000；當沖完整模式每檔訂閱逐筆成交、分 K、五檔 3 個頻道，訂閱不足時改用聚合行情（每檔 1 個，自選股優先）。付費方案另有全市場即時快照。啟用後熱浪圖、時光機等其他資料仍依原本的資料源。',
  shioaji: '永豐金 Shioaji 即時行情：經這台電腦上的行情轉接服務（sj-trading 的 sj-quote-bridge），提供盤中雷達、即時看板與自訂提醒用的即時推播。只有精簡模式（每檔 1 個訂閱，上限 200 檔），沒有日 K、分 K 與快照；當沖監控只有精簡模式，五檔錄製器不加錄。轉接服務使用只有行情權限的永豐金金鑰，不能下單。這裡填的是轉接服務的本機通行碼，不是永豐金金鑰。',
  twelvedata: '涵蓋全球多數市場：股票清單、日 K、即時報價、分 K（免費方案每分鐘 8 次、每日 800 次）。',
  alphavantage: '以美股為主（另支援英、加、德、印）：日 K、報價、新聞情緒、本益比、季營收（免費方案每日 25 次）。',
};
const LLM_NOTES = {
  anthropic: 'Claude（Anthropic）：預設 Claude Opus 5.5。',
  openai: 'OpenAI：使用帳號可用的 GPT 系列模型。',
  gemini: 'Google Gemini：使用 AI Studio 的 API 金鑰。',
  compatible: 'OpenAI 相容端點：OpenRouter、Groq、本機的 Ollama／LM Studio 等；本機模型可不設金鑰。',
};
// 功能 → 需要的資料能力（設定精靈的「目前可用功能」清單）
const FEATURES = [
  ['研究評分與日 K', ['daily']], ['盤中雷達與即時看板', ['snapshot']], ['盤中雷達即時推播', ['stream']], ['當沖監控（逐筆、分 K、五檔）', ['stream']], ['當沖資格與參考價', ['dayTrade']], ['資金熱浪（全市場）', ['dailyAll']], ['型態選股（全市場）', ['dailyAll']],
  ['5 分 K', ['intraday']], ['法人籌碼分數', ['institutional']], ['營收成長', ['revenue']], ['本益比', ['valuation']], ['新聞推播', ['marketNews']],
  ['券商分點', ['brokers']], ['法人／期貨籌碼總覽', ['flows']],
];

/* ---------- 共用元件 ---------- */
function capChips(p, labels) { return p.caps.length ? p.caps.map(c => `<span class="tag">${esc(labels[c] || c)}</span>`).join(' ') : `<span class="muted">${esc(t('目前市場不適用'))}</span>`; }
function providerCard(p, cfg) {
  const labels = cfg.capabilityLabels, keyless = p.key === 'none';
  const status = p.id==='finmind' ? `<span class="tag amber">憑證狀態：${esc(p.credential||'unverified')}</span> <span class="tag">${esc(p.entitlement==='unknown'?'方案未確認':p.entitlement||'方案未確認')}</span>` : keyless ? '<span class="tag cyan">免金鑰</span>' : p.configured ? `<span class="tag cyan">已設定</span>${p.plan?.plan ? ` <span class="tag">${esc(p.plan.plan)}</span>` : ''}` : '<span class="tag amber">未設定金鑰</span>';
  return `<article class="setup-provider ${p.enabled ? 'on' : ''}"><div class="sp-head"><label class="checkbox" style="flex-direction:row"><input type="checkbox" data-setup-enable="${p.id}" ${p.enabled ? 'checked' : ''}><b translate="no">${esc(p.name)}</b></label>${status}<a class="sp-link" href="${esc(p.site)}" target="_blank" rel="noopener noreferrer">官網 ↗</a></div>
  <p class="fine">${esc(PROVIDER_NOTES[p.id] || '')}</p><div class="sp-caps">${capChips(p, labels)}</div>
  ${keyless ? '' : `<form class="sp-key" data-setup-key="${p.id}"><input name="key" type="password" autocomplete="off" placeholder="${esc(p.configured ? '輸入新金鑰以更換' : '貼上 API 金鑰')}" required><button class="primary" type="submit">驗證並儲存</button>${p.configured ? `<button type="button" data-setup-recheck="${p.id}" title="重新讀取方案等級（例如升級或續訂後）">重新驗證</button><button type="button" data-setup-unkey="${p.id}">移除金鑰</button>` : ''}</form>`}</article>`;
}
function providerList(cfg) {
  const list = cfg.providers.filter(p => p.supportsMarket);
  return list.length ? list.map(p => providerCard(p, cfg)).join('') : `<div class="empty"><p>目前沒有支援此市場的資料源</p></div>`;
}
function featureList(cfg) {
  const caps = cfg.capabilities, local = cfg.market.local || [];
  return `<ul class="setup-features">${FEATURES.filter(([, need]) => !need.some(c => ['brokers', 'flows'].includes(c)) || local.includes(need[0])).map(([name, need]) => { const src = need.map(c => caps[c]).find(Boolean); return `<li class="${src ? 'ok' : 'no'}"><span>${src ? '✓' : '—'}</span>${esc(name)}${src ? ` <small class="muted" translate="no">${esc(cfg.providers.find(p => p.id === src)?.name || src)}</small>` : ''}</li>`; }).join('')}</ul>`;
}
function preferPanel(cfg) {
  const enabled = cfg.providers.filter(p => p.enabled && p.supportsMarket);
  const rows = Object.entries(cfg.capabilityLabels).map(([cap, label]) => { const opts = enabled.filter(p => p.caps.includes(cap)); if (opts.length < 2) return ''; const cur = cfg.config.providers.prefer[cap] || ''; return `<label class="field">${esc(label)}<select data-setup-prefer="${cap}"><option value="">依啟用順序</option>${opts.map(p => `<option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`; }).filter(Boolean);
  return rows.length ? `<details class="setup-adv"><summary>進階：指定各項資料的來源</summary><div class="formgrid">${rows.join('')}</div></details>` : '';
}
function llmPanel(cfg) {
  const l = cfg.llm, d = S.llmDraft || { provider: l.provider }, info = l.providers.find(p => p.id === d.provider) || l.providers[0];
  const models = S.models[info.id] || (info.suggested?.length ? info.suggested : []), cur = d.provider === l.provider ? l.model || info.defaultModel : info.defaultModel;
  return `<form id="setup-llm" class="setup-llm"><div class="formgrid">
    <label class="field">服務<select name="provider" data-llm-provider>${l.providers.map(p => `<option value="${p.id}" ${p.id === info.id ? 'selected' : ''}>${esc(p.name)}${p.configured ? ' ✓' : ''}</option>`).join('')}</select><small>${esc(LLM_NOTES[info.id] || '')}</small></label>
    ${info.needsBaseUrl ? `<label class="field">端點網址<input name="baseUrl" type="url" placeholder="http://127.0.0.1:11434/v1" value="${esc(d.provider === l.provider ? l.baseUrl : '')}"></label>` : ''}
    <label class="field">API 金鑰${info.keyOptional ? '（可留空）' : ''}<input name="key" type="password" autocomplete="off" placeholder="${esc(info.configured ? '已設定；輸入新金鑰以更換' : '貼上 API 金鑰')}"></label>
    <label class="field">模型${models.length ? `<select name="model">${[...new Set([cur, ...models].filter(Boolean))].map(m => `<option ${m === cur ? 'selected' : ''} translate="no">${esc(m)}</option>`).join('')}</select>` : `<input name="model" value="${esc(cur || '')}" placeholder="驗證金鑰後可從清單選擇">`}</label>
    <label class="field">思考深度<select name="effort">${[['medium', '一般'], ['high', '深入（預設）'], ['xhigh', '更深入']].map(([v, n]) => `<option value="${v}" ${l.effort === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <div class="form-actions"><button class="primary" type="submit">驗證並儲存</button>${info.configured ? `<button type="button" data-setup-unllm="${info.id}">移除金鑰</button>` : ''}<span class="tag ${l.configured ? 'cyan' : 'amber'}">${l.configured ? `使用中：${esc(l.providers.find(p => p.id === l.provider)?.name || l.provider)}` : '未設定'}</span></div>
    <p class="fine">驗證時只讀取模型清單，不產生費用。產生日報時依各服務的定價計費；本機模型不需費用。</p></form>`;
}
function groupForm() {
  const m = C.state().marketProfile || {};
  return `<form id="setup-group" class="setup-group"><div class="formgrid"><label class="field">族群名稱<input name="name" maxlength="40" required placeholder="例如：AI 伺服器"></label><label class="field full">股票代號（以逗號或空白分隔）<textarea name="ids" rows="2" placeholder="${esc(m.sample || '')}"></textarea></label></div><div class="form-actions"><button class="primary" type="submit">新增族群</button></div></form>`;
}
function groupManager() {
  const st = C.state(), groups = st.groups || [], names = new Map((st.stocks || []).map(s => [s.id, s.name]));
  if (!groups.length) return '<div class="empty"><p>尚未建立研究族群</p></div>';
  return `<div class="setup-groups">${groups.map((g, i) => `<div class="sg-row" data-sg="${esc(g.id)}"><div class="sg-head"><input value="${esc(g.name)}" maxlength="40" aria-label="族群名稱" data-sg-name translate="no"><span class="muted">${g.stockIds.length} 檔</span><button class="textbtn" data-sg-act="toggle">${S.groupsOpen[g.id] ? '收合' : '成分股'}</button><button class="textbtn" data-sg-act="up" ${i ? '' : 'disabled'} title="往上移">↑</button><button class="textbtn" data-sg-act="del">刪除</button></div>${S.groupsOpen[g.id] ? `<div class="sg-stocks">${g.stockIds.map(id => `<span class="chip" translate="no">${esc(id)} ${esc(names.get(id) || '')}<button class="textbtn" data-sg-rm="${esc(id)}" aria-label="移除">×</button></span>`).join('') || '<span class="muted">尚無成分股</span>'}<form class="sg-add" data-sg-add="${esc(g.id)}"><input name="ids" placeholder="加入代號（可多個）"><button type="submit">加入</button></form></div>` : ''}</div>`).join('')}</div>`;
}

/* ---------- 首次設定精靈 ---------- */
const STEPS = ['語言與市場', '資料來源', '推理模型', '研究族群'];
export function setupWizard() {
  const cfg = S.cfg;
  if (!cfg) { loadConfig().then(() => C.redraw()).catch(e => C.toast(e.message)); return '<div class="boot"><b>EQUILENS</b><p><i class="spinner"></i></p></div>'; }
  const body = [stepMarket, stepData, stepLlm, stepGroups][S.step](cfg);
  return `<div class="setup"><div class="setup-card"><div class="setup-brand"><strong>衡析</strong><span>NEXUS · SETUP</span></div>
  <ol class="setup-steps">${STEPS.map((s, i) => `<li class="${i === S.step ? 'on' : i < S.step ? 'done' : ''}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>
  <div class="setup-body">${body}</div>
  <div class="setup-nav">${S.step ? '<button data-setup-step="-1">← 上一步</button>' : '<span></span>'}${S.step < STEPS.length - 1 ? `<button class="primary" data-setup-step="1">下一步 →</button>` : '<button class="primary" data-setup-finish>完成設定，開始使用 →</button>'}</div>
  <p class="fine setup-foot">所有設定與金鑰只保存在這台電腦。之後都可以在「資料與設定」修改。</p></div></div>`;
}
function stepMarket(cfg) {
  return `<h2>介面語言</h2><div class="setup-choice">${[['zh-TW', '繁體中文'], ['en', 'English']].map(([v, n]) => `<button class="${cfg.config.language === v ? 'on' : ''}" data-setup-lang="${v}" translate="no">${n}</button>`).join('')}</div>
  <h2>研究市場</h2><p class="fine">一套衡析研究一個市場（交易時間、價格規則與資料源依市場而定）。之後切換市場時，各市場的資料會分開保存。</p>
  <div class="setup-markets">${cfg.markets.map(m => `<button class="${cfg.config.market === m.id ? 'on' : ''}" data-setup-market="${m.id}"><b>${esc(nameOf(m.name))}</b><small translate="no">${esc(m.id)} · ${esc(m.currency)} · ${esc(m.tz)}</small><small>${m.providers.length} 個資料源</small></button>`).join('')}</div>`;
}
function stepData(cfg) {
  return `<h2>資料來源</h2><p class="fine">勾選要使用的資料源並設定金鑰（金鑰由作業系統加密保存在這台電腦）。同一項資料有多個來源時，依勾選順序使用，也可在下方指定。</p>
  <div class="setup-providers">${providerList(cfg)}</div>${preferPanel(cfg)}<h3>目前可用的功能</h3>${featureList(cfg)}`;
}
function stepLlm(cfg) {
  return `<h2>推理模型（AI 盤後日報）</h2><p class="fine">選擇用來撰寫盤後日報的模型服務；不設定也能使用其他功能。</p>${llmPanel(cfg)}`;
}
function stepGroups(cfg) {
  const st = C.state();
  if (S.template === undefined) { S.template = null; C.api('template').then(r => { S.template = r.template; C.redraw(); }).catch(() => { }); }
  return `<h2>研究族群</h2><p class="fine">把想研究的公司分成族群（例如產業鏈或題材）。評分、族群排名與即時看板都以研究族群為範圍。</p>
  ${groupForm()}<div class="form-actions" style="margin:6px 0 16px">${S.template ? `<button data-setup-template>載入範例族群（${esc(S.template.groups.length)} 組）</button>` : ''}<label class="filebtn"><input type="file" accept="application/json,.json" data-setup-import hidden>匯入設定檔…</label></div>
  ${st.groups?.length ? groupManager() : ''}`;
}

/* ---------- 遠端存取：手機版的連線方式與網域、推播聯絡信箱、電腦版遠端存取（Cloudflare Access） ---------- */
const TUNNELS = [
  ['auto', '自動（有 Cloudflare 固定網域設定檔時用固定網域，否則用臨時網址）'],
  ['cloudflare-quick', 'Cloudflare 臨時網址（免帳號，每次重新啟動網址會變）'],
  ['cloudflare-named', 'Cloudflare 固定網域（Named Tunnel）'],
  ['custom', '自行處理（ngrok、Tailscale Funnel、自架 Caddy／Nginx 等）'],
  ['off', '不對外開放（只在這台電腦使用）'],
];
const TUNNEL_HINTS = {
  auto: '手機版資料夾有 .local/cloudflared.yml 時使用 Cloudflare 固定網域，否則自動開啟 https://xxxx.trycloudflare.com 臨時網址。',
  'cloudflare-quick': '啟動手機版時自動開啟 https://xxxx.trycloudflare.com 臨時網址（需安裝 cloudflared）。',
  'cloudflare-named': '在手機版資料夾的 .local/cloudflared.yml 設定 Named Tunnel（見手機版說明），並把網域填在下方的手機版網址。',
  custom: '用你自己的通道或反向代理，把 https 網址轉到這台電腦的 http://127.0.0.1:4340，並轉送 X-Forwarded-For 與 X-Forwarded-Proto 標頭；網域填在下方。衡析不會啟動任何通道。',
  off: '手機版只接受這台電腦本機的連線。',
};
function remotePanel(cfg) {
  const r = cfg.remote, a = r.access;
  return `<section class="panel contentpad"><h2>遠端存取</h2><p class="fine">手機版透過你選擇的通道或反向代理連回這台電腦，並以密碼保護；只有下方列出的網域可以連線。</p>
  <form id="setup-remote"><h3>手機版（Pocket）</h3><div class="formgrid">
    <label class="field full">連線方式<select name="tunnel" data-remote-tunnel>${TUNNELS.map(([v, n]) => `<option value="${v}" ${r.tunnel === v ? 'selected' : ''}>${n}</option>`).join('')}</select><small id="remote-hint">${esc(TUNNEL_HINTS[r.tunnel] || '')}</small></label>
    <label class="field">手機版網址<input name="publicUrl" type="url" placeholder="https://pocket.example.com" value="${esc(r.publicUrl || '')}"><small>你的固定網址，也作為推播通知的聯絡網址；使用臨時網址時可留空。</small></label>
    <label class="field">其他允許的網域<input name="pocketHosts" placeholder="m.example.com" value="${esc(r.pocketHosts.join(' '))}"><small>以空白或逗號分隔；同一個手機版有多個網址時填寫。</small></label>
    <label class="field">推播聯絡信箱（選填）<input name="contact" type="email" placeholder="you@example.com" value="${esc(r.contact)}"><small>沒有手機版網址時，推播服務（例如 Apple）以這個信箱作為聯絡方式。</small></label></div>
    <h3 style="margin-top:22px">電腦版（遠端使用完整功能）</h3><p class="fine">電腦版可以變更金鑰與所有設定，因此只接受經 Cloudflare Access 驗證的遠端連線；三項都填好才會啟用，本機使用不受影響。</p><div class="formgrid">
    <label class="field">允許的網域<input name="accessHosts" placeholder="nexus.example.com" value="${esc(a.hosts.join(' '))}"></label>
    <label class="field">Team domain<input name="teamDomain" placeholder="your-team.cloudflareaccess.com" value="${esc(a.teamDomain)}" translate="no"></label>
    <label class="field full">Application Audience (AUD) Tag<input name="aud" value="${esc(a.aud)}" autocomplete="off" translate="no"></label></div>
    <div class="form-actions"><button class="primary" type="submit">儲存遠端存取設定</button><span class="tag ${a.ready ? 'cyan' : 'amber'}">${a.ready ? '電腦版遠端存取：已啟用' : '電腦版遠端存取：未啟用'}</span></div>
    <p class="fine">變更連線方式後，請停止再重新啟動手機版（Windows：停止衡析手機版.cmd → 啟動衡析手機版.cmd；macOS／Linux：EquiLens-Pocket/stop.sh → start.sh）。網域與信箱的變更會自動生效。</p></form></section>`;
}

/* ---------- 「資料與設定」頁：系統設定 ---------- */
export function systemSettings() {
  const cfg = S.cfg;
  if (!cfg) { loadConfig().then(() => C.page() === 'settings' && C.redraw()).catch(e => C.toast(e.message)); return '<section class="panel contentpad"><p><i class="spinner"></i></p></section>'; }
  const c = cfg.config, m = cfg.market;
  return `<section class="panel contentpad"><h2>市場與語言</h2><div class="formgrid">
    <label class="field">介面語言<select data-setup-cfg="language">${[['zh-TW', '繁體中文'], ['en', 'English']].map(([v, n]) => `<option value="${v}" ${c.language === v ? 'selected' : ''} translate="no">${n}</option>`).join('')}</select></label>
    <label class="field">研究市場<select data-setup-cfg="market">${cfg.markets.map(x => `<option value="${x.id}" ${c.market === x.id ? 'selected' : ''}>${esc(nameOf(x.name))} (${x.id})</option>`).join('')}</select><small>切換後，目前市場的族群、自選與紀錄會收起來保存，切回時恢復。</small></label>
    <label class="field">漲跌配色<select data-setup-cfg="upColor"><option value="" ${!c.upColor ? 'selected' : ''}>依市場慣例（${m.upColor === 'green' ? '綠漲紅跌' : '紅漲綠跌'}）</option><option value="red" ${c.upColor === 'red' ? 'selected' : ''}>紅漲綠跌</option><option value="green" ${c.upColor === 'green' ? 'selected' : ''}>綠漲紅跌</option></select></label></div></section>
  ${remotePanel(cfg)}
  <section class="panel contentpad"><h2>資料來源</h2><p class="fine">金鑰由作業系統加密保存在這台電腦（${esc({ dpapi: 'Windows DPAPI', keychain: 'macOS 鑰匙圈', 'secret-tool': 'Secret Service', file: '僅限本人讀取的檔案' }[cfg.secretBackend] || cfg.secretBackend)}），頁面不會讀回或顯示。</p>
    <div class="setup-providers">${providerList(cfg)}</div>${preferPanel(cfg)}<h3>目前可用的功能</h3>${featureList(cfg)}</section>
  <section class="panel contentpad"><h2>推理模型（AI 盤後日報）</h2>${llmPanel(cfg)}</section>
  <section class="panel contentpad"><h2>研究族群管理</h2>${groupManager()}<h3 style="margin-top:16px">新增族群</h3>${groupForm()}</section>
  <section class="panel contentpad"><h2>設定檔</h2><p class="fine">匯出研究族群、自選、雷達與評分設定、資料源與模型選擇（不含任何金鑰），可在另一台電腦匯入。</p>
    <div class="form-actions"><button data-setup-export>↓ 匯出設定檔</button><label class="filebtn"><input type="file" accept="application/json,.json" data-setup-import hidden>匯入設定檔…</label></div></section>`;
}

/* ---------- 動作 ---------- */
async function refresh(full = true) { await loadConfig(true); if (full) await C.reload(); else C.redraw(); }
const splitIds = s => [...new Set(String(s || '').toUpperCase().split(/[\s,，、;；]+/).map(x => x.trim()).filter(Boolean))];
// 研究族群代號：台股等純數字市場不轉大寫也一樣；英文代號一律大寫
function download(name, value) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
async function importFile(file) {
  if (!file) return; if (file.size > 900000) throw new Error(t('設定檔過大'));
  const bundle = JSON.parse(await file.text());
  const r = await C.api('import', { bundle });
  await refresh();
  const g = r.result.groups; C.toast(g?.skipped ? g.reason : t('設定檔已匯入{detail}', { detail: g ? t('（族群新增 {n} 檔，略過 {s} 個代號）', { n: g.added, s: g.skipped }) : '' }));
}
async function changeConfig(key, value) {
  if (key === 'market' && !confirm(t('切換研究市場？目前市場的族群、自選與紀錄會收起來保存，切回時恢復。'))) { C.redraw(); return; }
  const r = await C.api('config', { [key]: value }); S.cfg = r; S.template = undefined; S.models = {};
  if (key === 'language') await setLanguage(value);
  await C.reload(); C.toast(t('設定已儲存'));
}
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !C) return; const ds = b.dataset;
  try {
    if (ds.setupStep) { S.step = Math.max(0, Math.min(STEPS.length - 1, S.step + Number(ds.setupStep))); if (S.step === 1 || S.step === 2) await loadConfig(true); C.redraw(); return; }
    if ('setupFinish' in ds) { await C.api('config', { setupDone: true }); await refresh(); const st = C.state(); if (st.groups?.length && st.capabilities?.daily && confirm(t('開始下載研究族群的歷史資料？（可隨時停止，下次續傳）'))) await C.api('update', { scope: 'all', ids: [] }); await C.reload(); C.toast(t('設定完成')); return; }
    if (ds.setupLang) { await changeConfig('language', ds.setupLang); return; }
    if (ds.setupMarket) { if (ds.setupMarket === S.cfg?.config.market) return; const r = await C.api('config', { market: ds.setupMarket }); S.cfg = r; S.template = undefined; await C.reload(); return; }
    if (ds.setupRecheck) { b.disabled = true; S.cfg = await C.api('provider-check', { id: ds.setupRecheck }); await C.reload(); C.toast(t('已重新驗證金鑰與方案')); return; }
    if (ds.setupUnkey) { if (!confirm(t('移除這個資料源的金鑰？'))) return; S.cfg = await C.api('provider-key', { id: ds.setupUnkey, remove: true }); await C.reload(); C.toast(t('金鑰已移除')); return; }
    if (ds.setupUnllm) { if (!confirm(t('移除這個服務的金鑰？'))) return; await C.api('llm-key', { provider: ds.setupUnllm, remove: true }); await refresh(); C.toast(t('金鑰已移除')); return; }
    if ('setupExport' in ds) { const bundle = await C.api('export'); download(`equilens-settings-${bundle.market}-${bundle.exportedAt.slice(0, 10)}.json`, bundle); return; }
    if ('setupTemplate' in ds) { const r = await C.api('groups/import', { groups: S.template.groups, stocks: S.template.stocks || [] }); await C.reload(); C.toast(t('已載入範例族群（新增 {n} 檔）', { n: r.added })); return; }
    const row = b.closest('[data-sg]'); if (row) {
      const id = row.dataset.sg, act = ds.sgAct;
      if (act === 'toggle') { S.groupsOpen[id] = !S.groupsOpen[id]; C.redraw(); return; }
      if (act === 'del') { if (!confirm(t('刪除這個族群？成分股的歷史資料會保留。'))) return; await C.api('groups/delete', { groupId: id }); await C.reload(); return; }
      if (act === 'up') { const ids = C.state().groups.map(g => g.id), i = ids.indexOf(id); if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await C.api('groups/order', { ids }); await C.reload(); } return; }
      if (ds.sgRm) { await C.api('group-stocks', { groupId: id, stockId: ds.sgRm, remove: true }); await C.reload(); return; }
    }
  } catch (err) { C.toast(err.message); b.disabled = false; }
});
document.addEventListener('change', async e => {
  const el = e.target; if (!C) return; const ds = el.dataset;
  try {
    if (ds.setupEnable) { const cfg = await loadConfig(), on = el.checked, cur = cfg.config.providers.enabled.filter(x => x !== ds.setupEnable); S.cfg = await C.api('providers', { enabled: on ? [...cur, ds.setupEnable] : cur, prefer: cfg.config.providers.prefer }); await C.reload(); return; }
    if (ds.setupPrefer) { const cfg = await loadConfig(), prefer = { ...cfg.config.providers.prefer }; if (el.value) prefer[ds.setupPrefer] = el.value; else delete prefer[ds.setupPrefer]; S.cfg = await C.api('providers', { enabled: cfg.config.providers.enabled, prefer }); await C.reload(); return; }
    if (ds.setupCfg) { await changeConfig(ds.setupCfg, el.value); return; }
    if ('llmProvider' in ds) { S.llmDraft = { provider: el.value }; C.redraw(); return; }
    if ('remoteTunnel' in ds) { const h = document.getElementById('remote-hint'); if (h) h.textContent = t(TUNNEL_HINTS[el.value] || ''); return; }
    if ('setupImport' in ds) { await importFile(el.files?.[0]); el.value = ''; return; }
    if ('sgName' in ds) { const id = el.closest('[data-sg]').dataset.sg; await C.api('groups/rename', { groupId: id, name: el.value }); await C.reload(); C.toast(t('族群名稱已更新')); return; }
  } catch (err) { C.toast(err.message); if (ds.setupEnable) el.checked = !el.checked; }
});
document.addEventListener('submit', async e => {
  const f = e.target; if (!C) return;
  const key = f.dataset.setupKey, add = f.dataset.sgAdd;
  if (!key && !add && !['setup-llm', 'setup-group', 'setup-remote'].includes(f.id)) return;
  e.preventDefault(); const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (key) { S.cfg = await C.api('provider-key', { id: key, key: f.elements.key.value.trim() }); f.reset(); await C.reload(); C.toast(t('金鑰已驗證並加密儲存')); }
    else if (add) { const st = C.state(); let n = 0, bad = []; for (const id of splitIds(f.elements.ids.value)) { try { const r = await C.api('group-stocks', { groupId: add, stockId: id }); if (r.added) n++; } catch (err) { bad.push(id); } } await C.reload(); C.toast(bad.length ? t('已加入 {n} 檔；無法加入：{ids}', { n, ids: bad.join(', ') }) : t('已加入 {n} 檔', { n })); void st; }
    else if (f.id === 'setup-remote') {
      const v = Object.fromEntries(new FormData(f)), list = s => String(s || '').split(/[\s,，、;；]+/).map(x => x.trim()).filter(Boolean);
      const r = await C.api('remote', { tunnel: v.tunnel, publicUrl: v.publicUrl.trim(), pocketHosts: list(v.pocketHosts), contact: v.contact.trim(), access: { hosts: list(v.accessHosts), teamDomain: v.teamDomain.trim(), aud: v.aud.trim() } });
      S.cfg = { ...S.cfg, remote: r.remote, config: { ...S.cfg.config, publicUrl: r.remote.publicUrl } }; await C.reload(); C.toast(t('遠端存取設定已儲存'));
    }
    else if (f.id === 'setup-group') { const ids = splitIds(f.elements.ids.value), r = await C.api('groups/import', { groups: [{ name: f.elements.name.value.trim(), stockIds: ids }] }); f.reset(); await C.reload(); C.toast(r.skipped ? t('族群已建立；{n} 個代號格式不符目前市場，已略過', { n: r.skipped }) : t('族群已建立')); }
    else if (f.id === 'setup-llm') {
      const v = Object.fromEntries(new FormData(f)), info = S.cfg.llm.providers.find(p => p.id === v.provider);
      if (v.key || (info.keyOptional && info.needsBaseUrl) || !info.configured) { const r = await C.api('llm-key', { provider: v.provider, key: v.key || '', baseUrl: v.baseUrl }); S.models[v.provider] = r.models; }
      await C.api('llm', { provider: v.provider, ...(v.model ? { model: v.model } : {}), effort: v.effort, ...(v.baseUrl !== undefined ? { baseUrl: v.baseUrl } : {}) });
      S.llmDraft = null; f.reset(); await refresh(); C.toast(t('推理模型設定已儲存'));
    }
  } catch (err) { C.toast(err.message); } finally { if (btn) btn.disabled = false; }
});
