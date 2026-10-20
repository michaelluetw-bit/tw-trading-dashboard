// 法人／期貨籌碼的個股法人備援（證交所 T86＋櫃買中心）：完整性規則、queryFlows 整合、分市場取得與資料源接線
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 接線測試要用隔離的設定資料夾：必須在載入衡析模組之前設定
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equilens-flows-fallback-'));
process.env.EQUITY_DATA_DIR = dir;
process.env.FINMIND_API_TOKEN = 'test-token-only';
const writeConfig = enabled => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, setupDone: true, market: 'TW', language: 'zh-TW', providers: { enabled, prefer: {} } }));
writeConfig(['finmind', 'twse']);
const { queryFlows, checkFallbackStocks, flowCatalog, cacheableFlow, FALLBACK_MIN_COVERAGE } = await import('../lib/flows.mjs');
const { institutionalAllChecked } = await import('../lib/providers/twse.mjs');
const { data } = await import('../lib/providers/index.mjs');
const { resetConfigCache } = await import('../lib/config.mjs');
const useProviders = enabled => { writeConfig(enabled); resetConfigCache(); };
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// 2026-10-20 的真實回應（只留幾檔）
const fx = JSON.parse(fs.readFileSync(new URL('./flows-fallback-fixture.json', import.meta.url), 'utf8'));
const date = '2026-10-20';
const info = [['2330', 'twse'], ['2317', 'twse'], ['6488', 'tpex']].map(([stock_id, type]) => ({ stock_id, type, stock_name: stock_id, industry_category: '半導體業', date }));
const catalog = flowCatalog(info);
const row = (stock_id, name = 'Foreign_Investor', buy = 1000, sell = 0, d = date) => ({ date: d, stock_id, name, buy, sell });
const INVESTORS = ['Foreign_Investor', 'Foreign_Dealer_Self', 'Investment_Trust', 'Dealer_self', 'Dealer_Hedging'];
const allInvestors = (id, net) => INVESTORS.map(n => row(id, n, Math.max(net, 0), Math.max(-net, 0)));
const good = { rows: [...allInvestors('2330', 1000), ...allInvestors('2317', -2000), ...allInvestors('6488', 500), row('00411A')], markets: { twse: { date, count: 2, error: null }, tpex: { date, count: 1, error: null } } };

// FinMind 假回應：info 有資料、stocks 依情境、其他項目回空陣列
function finmind(stocks) {
  const calls = [];
  const requestData = async dataset => {
    calls.push(dataset);
    if (dataset === 'TaiwanStockInfo') return info;
    if (dataset === 'TaiwanStockInstitutionalInvestorsBuySell') { if (stocks instanceof Error) throw stocks; return stocks; }
    return [];
  };
  return { requestData, calls };
}
const planError = Object.assign(new Error('個股法人：FinMind 帳號目前不是 Sponsor 等級，沒有此資料的權限'), { code: 'plan' });

test('checkFallbackStocks: complete data passes; out-of-scope securities are skipped, not counted as bad rows', () => {
  const r = checkFallbackStocks(date, good, catalog);
  assert.equal(r.ok, true, r.problems.join(','));
  assert.deepEqual([...new Set(r.rows.map(x => x.stock_id))], ['2330', '2317', '6488']);
  assert.deepEqual(r.coverage, { twse: { covered: 2, indexed: 2, ratio: 1 }, tpex: { covered: 1, indexed: 1, ratio: 1 } });
});

test('checkFallbackStocks: coverage counts distinct stocks, not the five investor rows', () => {
  const rows = ['Foreign_Investor', 'Foreign_Dealer_Self', 'Investment_Trust', 'Dealer_self', 'Dealer_Hedging'].map(n => row('2330', n)).concat(row('6488'));
  const r = checkFallbackStocks(date, { rows, markets: good.markets }, catalog);
  assert.equal(r.coverage.twse.covered, 1);
  assert.equal(r.ok, FALLBACK_MIN_COVERAGE <= 0.5);
  assert.match(r.problems.join(), /上市：筆數異常偏低（1／2 檔）/);
});

test('checkFallbackStocks: date mismatch, one-side error, empty index market and malformed rows are rejected', () => {
  const wrongDate = checkFallbackStocks(date, { ...good, markets: { ...good.markets, twse: { date: '2026-10-17', count: 2, error: null } } }, catalog);
  assert.deepEqual([wrongDate.ok, wrongDate.problems], [false, ['上市：回傳日期 2026-10-17']]);
  const oneSide = checkFallbackStocks(date, { rows: good.rows.filter(r => r.stock_id !== '6488'), markets: { ...good.markets, tpex: { date: null, count: 0, error: '櫃買中心：資料服務回應 500' } } }, catalog);
  assert.equal(oneSide.ok, false);
  assert.match(oneSide.problems.join(), /上櫃：櫃買中心：資料服務回應 500/);
  const noTpex = checkFallbackStocks(date, good, flowCatalog(info.filter(r => r.type === 'twse')));
  assert.match(noTpex.problems.join(), /上櫃：股票索引沒有此市場/);
  const bad = checkFallbackStocks(date, { ...good, rows: [...good.rows, row('2330', 'Unknown'), { ...row('2317'), buy: Number.NaN }, row('6488', 'Investment_Trust', 1, 0, '2026-10-19')] }, catalog);
  assert.deepEqual([bad.ok, bad.problems], [false, ['格式錯誤 3 列']]);
});

test('checkFallbackStocks: abnormally few stocks with the right date are rejected', () => {
  const big = flowCatalog(Array.from({ length: 10 }, (_, i) => ({ stock_id: String(2301 + i), type: i < 5 ? 'twse' : 'tpex', stock_name: 'x', date })));
  const r = checkFallbackStocks(date, { rows: [row('2301'), row('2306')], markets: good.markets }, big);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['上市：筆數異常偏低（1／5 檔）', '上櫃：筆數異常偏低（1／5 檔）']);
});

test('queryFlows: FinMind plan error → complete TWSE/TPEx fallback builds rankings, marks the source and is cacheable', async () => {
  const fm = finmind(planError);
  let asked = null;
  const r = await queryFlows(date, { requestData: fm.requestData, fallbackStocks: async d => { asked = d; return good; } });
  assert.equal(asked, date);
  assert.equal(r.errors.stocks, undefined);
  assert.equal(r.stocksSource, 'twse');
  assert.equal(r.coverage.withRecords, 3);
  assert.ok(r.sources.some(s => /T86/.test(s.title)) && r.sources.some(s => /櫃買/.test(s.title)));
  assert.ok(r.rankings.every(x => x.covered > 0));
  const complete = { ...r, options: { available: true, contracts: [1] }, summary: { available: true }, futures: { available: true } };
  assert.equal(cacheableFlow(complete), true);
  assert.deepEqual(fm.calls.slice(-3), ['TaiwanFuturesInstitutionalInvestors', 'TaiwanOptionInstitutionalInvestors', 'TaiwanOptionDaily'], 'other components still queried');
});

test('queryFlows: FinMind returns an empty list without error → fallback is used', async () => {
  const r = await queryFlows(date, { requestData: finmind([]).requestData, fallbackStocks: async () => good });
  assert.equal(r.stocksSource, 'twse');
  assert.equal(r.coverage.withRecords, 3);
});

test('queryFlows: FinMind has data → fallback is not called; no fallbackStocks → behaviour unchanged', async () => {
  let called = false;
  const r = await queryFlows(date, { requestData: finmind([row('2330')]).requestData, fallbackStocks: async () => { called = true; return good; } });
  assert.equal(called, false);
  assert.equal(r.stocksSource, undefined);
  const old = await queryFlows(date, { requestData: finmind(planError).requestData });
  assert.equal(old.errors.stocks, planError.message);
  assert.equal(old.stocksSource, undefined);
});

test('queryFlows: partial fallback is not used, keeps both reasons and is not cacheable', async () => {
  const partial = { rows: good.rows.filter(r => r.stock_id !== '6488'), markets: { ...good.markets, tpex: { date, count: 0, error: null } } };
  const r = await queryFlows(date, { requestData: finmind(planError).requestData, fallbackStocks: async () => partial });
  assert.equal(r.stocksSource, undefined);
  assert.equal(r.coverage.withRecords, 0);
  assert.match(r.errors.stocks, /Sponsor/);
  assert.match(r.errors.stocks, /證交所／櫃買備援未採用：上櫃：筆數異常偏低（0／1 檔）/);
  assert.equal(cacheableFlow(r), false);
});

test('queryFlows: market closed on both sides → "非交易日或尚未公布", nothing ranked', async () => {
  const closed = { rows: [], markets: { twse: { date: null, count: 0, error: null }, tpex: { date: '2026-10-18', count: 0, error: null } } };
  const r = await queryFlows('2026-10-18', { requestData: finmind([]).requestData, fallbackStocks: async () => closed });
  assert.match(r.errors.stocks, /FinMind 沒有此日的個股法人資料；證交所／櫃買中心沒有 2026-10-18 的資料（非交易日或尚未公布）/);
  assert.equal(cacheableFlow(r), false);
});

test('queryFlows: a throwing fallback keeps the FinMind error and the other components', async () => {
  const fm = finmind(planError);
  const r = await queryFlows(date, { requestData: fm.requestData, fallbackStocks: async () => { throw new TypeError('boom'); } });
  assert.match(r.errors.stocks, /Sponsor.*；證交所／櫃買備援失敗：boom/);
  assert.equal(Object.keys(r.errors).length, 1);
  assert.ok(fm.calls.includes('TaiwanOptionDaily'));
});

test('queryFlows: no fallback when the stock index itself failed', async () => {
  let called = false;
  const requestData = async dataset => { if (dataset === 'TaiwanStockInfo') throw new Error('index down'); if (dataset === 'TaiwanStockInstitutionalInvestorsBuySell') throw planError; return []; };
  const r = await queryFlows(date, { requestData, fallbackStocks: async () => { called = true; return good; } });
  assert.equal(called, false);
  assert.equal(r.errors.info, 'index down');
});

// 分市場取得：用 2026-10-20 的真實回應樣本（假 fetch）
function stubFetch(byHost) {
  const real = globalThis.fetch, urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    const body = byHost(String(url));
    if (body instanceof Error) return new Response('err', { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { urls, restore: () => { globalThis.fetch = real; } };
}

test('institutionalAllChecked: real sample → both markets dated, counted, and investor sums equal the official total', async () => {
  const f = stubFetch(url => url.includes('twse.com.tw') ? fx.t86 : fx.tpex);
  try {
    const r = await institutionalAllChecked(date, { interval: 0 });
    // 樣本含 ETF 0050、00411A：解析時已排除，只剩普通股
    assert.deepEqual(r.markets, { twse: { date, count: 2, error: null }, tpex: { date, count: 1, error: null } });
    assert.ok(f.urls[0].includes('T86?date=20261020') && f.urls[1].includes('date=2026%2F10%2F20'));
    const officialTotal = new Map([...fx.t86.data.map(x => [x[0].trim(), x[18]]), ...fx.tpex.tables[0].data.map(x => [x[0].trim(), x[23]])].map(([id, v]) => [id, Number(String(v).replace(/,/g, ''))]));
    for (const id of ['2330', '2317', '6488']) {
      const sum = r.rows.filter(x => x.stock_id === id).reduce((a, x) => a + x.buy - x.sell, 0);
      assert.equal(sum, officialTotal.get(id), id);
    }
    // 2330 外資 −9,364,622 股，投信 +1,029,673 股
    const tsmc = r.rows.filter(x => x.stock_id === '2330'), net = n => tsmc.filter(x => x.name === n).reduce((a, x) => a + x.buy - x.sell, 0);
    assert.deepEqual([net('Foreign_Investor') + net('Foreign_Dealer_Self'), net('Investment_Trust')], [-9364622, 1029673]);
    const r2 = checkFallbackStocks(date, r, flowCatalog(info));
    assert.equal(r2.ok, true, r2.problems.join(','));
  } finally { f.restore(); }
});

test('institutionalAllChecked: closed day and one-side HTTP error are reported per market', async () => {
  let f = stubFetch(url => url.includes('twse.com.tw') ? fx.t86Closed : fx.tpexClosed);
  try {
    const r = await institutionalAllChecked('2026-10-18', { interval: 0 });
    assert.deepEqual(r, { rows: [], markets: { twse: { date: null, count: 0, error: null }, tpex: { date: '2026-10-18', count: 0, error: null } } });
  } finally { f.restore(); }
  f = stubFetch(url => url.includes('twse.com.tw') ? fx.t86 : new Error('down'));
  try {
    const r = await institutionalAllChecked(date, { interval: 0 });
    assert.equal(r.markets.twse.count, 2);
    assert.equal(r.markets.tpex.count, 0);
    assert.match(r.markets.tpex.error, /500/);
  } finally { f.restore(); }
});

test('wiring: with FinMind and TWSE both enabled (in either order) the TWSE checked fetch is selected and called', async () => {
  for (const enabled of [['finmind', 'twse'], ['twse', 'finmind']]) {
    useProviders(enabled);
    assert.equal(data.institutionalCheckedSource(), 'twse', enabled.join());
    const f = stubFetch(url => url.includes('twse.com.tw') ? fx.t86 : fx.tpex);
    try {
      const r = await data.institutionalAllChecked(date, { interval: 0 });
      assert.equal(r.markets.twse.count, 2);
      assert.ok(f.urls.some(u => u.includes('twse.com.tw')) && f.urls.some(u => u.includes('tpex.org.tw')));
    } finally { f.restore(); }
  }
  useProviders(['finmind']);
  assert.equal(data.institutionalCheckedSource(), null);
  assert.equal(await data.institutionalAllChecked(date), null);
  useProviders(['finmind', 'twse']);
});
