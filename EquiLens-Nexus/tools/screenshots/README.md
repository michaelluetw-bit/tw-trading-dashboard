# README 截圖工具

重新產生 `docs/images/` 的截圖。畫面使用**示意資料**（合成的股價、籌碼與日報內容），不連外、不需要真的金鑰。

需要：Node 22 以上、全域安裝的 [Playwright](https://playwright.dev/)（`npm i -g playwright` 並安裝 Chromium）。

```bash
cd EquiLens-Nexus
D=/tmp/equilens-demo && rm -rf $D && mkdir -p $D
EQUITY_DATA_DIR=$D node tools/screenshots/demo-data.mjs
EQUITY_DATA_DIR=$D node tools/screenshots/demo-data2.mjs
echo '{"version":1,"setupDone":true,"market":"TW","language":"zh-TW","providers":{"enabled":["finmind","fugle","twse"],"prefer":{}}}' > $D/config.json
# 電腦版：時間固定從 2026-10-16（五）21:30 開始，對外請求一律失敗（只用示意資料）
EQUITY_DATA_DIR=$D PORT=4391 FINMIND_API_TOKEN=demo FUGLE_API_KEY=demo ANTHROPIC_API_KEY=demo node --import ./tools/screenshots/clock.mjs server.mjs &
# 手機版：先設定示意密碼 demo-password-123
cd ../EquiLens-Pocket && MOBILE_DATA_DIR=$D-m node -e "import('./lib/auth.mjs').then(a=>a.setPassword('demo-password-123'))"
MOBILE_DATA_DIR=$D-m NEXUS_URL=http://127.0.0.1:4391 PORT=4392 node --import ../EquiLens-Nexus/tools/screenshots/clock.mjs server.mjs &
cd ../EquiLens-Nexus && PLAYWRIGHT=$(npm root -g)/playwright/index.mjs node tools/screenshots/capture.mjs /tmp/equilens-shots   # 輸出 PNG
```

PNG 轉成 WebP（品質 82）後放進 `docs/images/`；手機版六張合成一張 `mobile-overview.webp`。
當沖觀察名單在盤中才有內容，`capture.mjs` 以示意的掃描結果取代 `/api/daytrade` 的回應。

## Shioaji 研究範圍熱浪截圖

沿用上述示意資料目錄，將資料源設為 `shioaji`、關閉每日更新並啟用盤中監控。只在此獨立測試環境使用 `DEMO_TIME=2026-10-22T10:00:00+08:00 SHIOAJI_BRIDGE_TOKEN=offline-test node --import ./tests/helpers/heat-stream-offline.mjs server.mjs`。測試模組會取代 WebSocket 並阻擋對外 HTTP，使用合成報價，絕不連接券商。不要在正式啟動命令載入此模組。

Nexus/Pocket 分別使用 4391/4392，手機示意密碼同上。執行 `PLAYWRIGHT=<playwright/index.mjs> node tools/screenshots/capture-heat-stream.mjs <輸出目錄>`。工具使用 Chrome，驗證兩版正常推播與斷線清圖，另驗證兩版歷史回應逆序、桌面回放板塊點選與手機研究範圍標籤；示意名單為 43 檔，200 檔邊界由 API 自動測試覆蓋。

## main 功能保留檢查

`check-main-preservation.mjs` 使用同一份獨立示意資料與 4391 測試站。將測試設定啟用 `finmind`、關閉 monitor／autoUpdate，並使用 `FINMIND_API_TOKEN=offline-demo DEMO_TIME=2026-10-16T19:00:00+08:00` 及上述離線模組啟動；不使用真實金鑰。執行 `PLAYWRIGHT=<playwright/index.mjs> node tools/screenshots/check-main-preservation.mjs`，驗證權證快取與 API、分點舊日期、儲存設定不跳日及其他日期選擇。只會寫入示意目錄的門檻設定。

## Shioaji 看板與快照警告

使用獨立示意目錄，執行 demo-data 與 demo-data2 後啟用 shioaji、monitor 與 daytrade，關閉 autoUpdate。沿用 heat-stream-offline 模組，時間設為 `2026-10-22T10:00:00+08:00`，Nexus／Pocket 使用 4391／4392，橋接與登入只填示意通行碼。

執行 `PLAYWRIGHT=<playwright/index.mjs> node tools/screenshots/capture-board-stream.mjs <輸出目錄>`。工具使用 Chrome，驗證兩版來源名稱、每卡報價時間、快照錯誤出現與解除、斷線空價、請求失敗與恢復。HTTP／斷線畫面以攔截測試瀏覽器的 API 回應模擬；正常報價來自離線橋接樣本，不接真實券商。

## Shioaji 族群排名

在**獨立示意目錄**先執行 `demo-data.mjs` 與 `demo-data2.mjs`，再執行 `EQUITY_DATA_DIR=<示意目錄> node tools/screenshots/group-rank-demo.mjs`。此工具要求 `demo-meta.json`，寫入合成報價與較少涵蓋的舊收盤檔；不能對正式資料目錄使用。

Nexus 使用 `EQUITY_DATA_DIR=<示意目錄> PORT=4391 DEMO_TIME=2026-10-22T10:00:00+08:00 SHIOAJI_BRIDGE_TOKEN=offline-test FINMIND_API_TOKEN=offline-test node --import ./tests/helpers/group-rank-offline.mjs server.mjs`。Pocket 使用獨立 `MOBILE_DATA_DIR`、`NEXUS_URL=http://127.0.0.1:4391` 與 4392；示意密碼為上面的 `demo-password-123`。兩版不要設定正式金鑰。

執行 `PLAYWRIGHT=<playwright/index.mjs> node tools/screenshots/capture-group-rank-stream.mjs <輸出目錄>`。工具驗證來源／時間／涵蓋、舊檔不顯示升降、斷線清空、API 失敗與 10 秒逾時、跨日延遲回應、恢復與歷史查閱。斷線及 HTTP 失敗使用測試瀏覽器攔截模擬；正常數字來自離線推播。200 檔上限、201 檔部分涵蓋、零成交額與來源切換由 API／單元測試驗證。
