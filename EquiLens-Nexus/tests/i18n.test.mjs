// 多語系：每個畫面字串都有英文翻譯、參數一致；畫面翻譯能處理樣板句、分段與數量單位；電腦版與手機版共用檔一致
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allKeys } from '../tools/i18n-keys.mjs';
import { t as serverT } from '../lib/i18n.mjs';
import { useDictionary, tx, t } from '../public/i18n.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'public', 'locales', 'en.json'), 'utf8'));
const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('every interface string has an English translation with the same placeholders', () => {
  const missing = allKeys().filter(k => !(k in en));
  assert.deepEqual(missing.slice(0, 20), [], `missing ${missing.length} translations; run: node tools/i18n-keys.mjs --missing en`);
  const bad = Object.entries(en).filter(([k, v]) => typeof v !== 'string' || !v.trim() || ph(k) !== ph(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
  assert.ok(Object.values(en).every(v => !/[一-鿿]/.test(v.replace(/億|萬|繁體中文|\S*\.cmd/g, ''))), 'English values contain no Chinese except unit markers');
});
test('server messages translate with parameters', () => {
  assert.equal(serverT('股票代碼格式錯誤', null, 'en'), 'Invalid stock symbol');
  assert.equal(serverT('更新 {id}，{done}/{total}', { id: 'AAPL', done: 3, total: 10 }, 'en'), 'Updating AAPL, 3/10');
  assert.equal(serverT('股票代碼格式錯誤', null, 'zh-TW'), '股票代碼格式錯誤');
});
test('screen translation: exact, template, segmented and unit conversion', () => {
  useDictionary('en', en);
  assert.equal(tx('研究總覽'), 'Research Overview');
  assert.equal(tx('更新 2330，3/10'), 'Updating 2330, 3/10');
  assert.equal(tx('成交 1,234.5 億'), 'Turnover 123B');
  assert.equal(tx('研究排序工具 · 分數不等於報酬率或合理股價 · 非交易建議'), 'Research ranking tool · scores are not returns or fair prices · not trading advice');
  assert.equal(tx('台積電'), '台積電', 'data such as company names stays as is');
  assert.equal(t('已加入 {n} 檔', { n: 5 }), 'Added 5');
  useDictionary('zh-TW');
  assert.equal(tx('研究總覽'), '研究總覽');
});
test('shared front-end modules are identical in Nexus and Pocket', () => {
  const pocket = path.join(root, '..', 'EquiLens-Pocket', 'public');
  if (!fs.existsSync(pocket)) return;
  for (const f of ['i18n.js', 'market.js', 'insight-ui.js', 'report-card.js', 'flow-cards.js', 'save-image.js', 'intraday.js', 'history-ui.js', 'history.css'])
    assert.equal(fs.readFileSync(path.join(pocket, f), 'utf8').replace(/\r/g, ''), fs.readFileSync(path.join(root, 'public', f), 'utf8').replace(/\r/g, ''), `${f} differs; copy EquiLens-Nexus/public/${f} to EquiLens-Pocket/public/`);
});
