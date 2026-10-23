# 衡析 Pocket（手機版）

台股新聞新增科技新報與自由財經 RSS，各每五分鐘讀取，僅納入能明確對應研究名單的文章；各來源健康、重試與去重分開處理。見[新聞推播](../docs/features/news-push.md)。

FinMind 憑證停用與重試狀態由 Nexus 共用管理，手機資料 API 沿用相同閘門；手機設定與資料格式不變。見[說明](../docs/features/finmind-access.md)。

一般報價、自訂提醒與個股日 K 當日補值共用 Shioaji 當日、本次連線且在既有訂閱內的有效行情。斷線或重連等待時清空即時值；當日 K 棒標示暫估，不寫回歷史或取代正式收盤。FinMind 與鉅亨網新聞分別顯示最後成功、最後新文、錯誤與重試時間。

新增提醒表單只用當日、盤中且標示為有效的 quote 顯示「現價」、報價時間與門檻提示；歷史 close 不再預填或標成現價。沒有有效報價時顯示「等待有效即時報價」，既有提醒條件與狀態不變。

「盤中 → 族群排名」與 Shioaji 看板、熱浪共用既有最多 200 檔訂閱，每 30 秒更新排名，顯示來源、秒級報價時間、斷線狀態與涵蓋差異。原公式與收盤紀錄保留；無法確認同範圍時不顯示升降名次。API 失敗、逾時或重連等待時清除即時分數，歷史紀錄仍可查閱。

盤中熱浪圖選用 Shioaji 時沿用既有最多 200 檔訂閱，顯示研究範圍、已確認／計畫訂閱數、有效普通股報價數、報價時間與斷線狀態；不新增訂閱或查詢永豐金快照。全市場盤後及歷史查詢保留，時光機錄製仍需快照來源。

衡析 Nexus 的手機網頁版（PWA）。資料與金鑰都留在你的電腦，手機透過你選擇的通道或反向代理以 https 連回來，並以密碼保護。

```
手機瀏覽器 ──https──▶ 你的網域（Cloudflare Tunnel、ngrok、Tailscale Funnel、Caddy／Nginx…）──▶ 衡析 Pocket (127.0.0.1:4340) ──▶ 衡析 Nexus (127.0.0.1:4330)
```

- Pocket 只綁定 127.0.0.1，不直接開放連接埠；所有資料都向 Nexus 取得（Nexus 是唯一寫入者），兩邊永遠一致。
- 介面語言、研究市場、漲跌配色、連線方式與允許的網域都跟隨 Nexus 的設定。
- **電腦必須開機，且 Nexus 與 Pocket 都在執行**，手機才讀得到。

## 第一次使用

| | Windows | macOS／Linux |
|---|---|---|
| 設定手機密碼（至少 10 個字元） | 雙擊 **設定手機密碼.cmd** | `node scripts/set-password.mjs` |
| 啟動（含 Nexus 與通道） | 雙擊 **啟動衡析手機版.cmd** | `./start.sh` |
| 停止（Nexus 繼續執行） | 雙擊 **停止衡析手機版.cmd** | `./stop.sh` |

1. 在電腦版「資料與設定 → 遠端存取」選擇**連線方式**並填入網域（見下一節）。
2. 啟動手機版，在手機開啟你的網址並輸入密碼登入（可保持 30 天）。
3. iPhone：Safari「分享 → 加入主畫面」；Android：Chrome 選單「加到主畫面」。之後像 App 一樣全螢幕開啟。
4. 在「盤中 → 雷達」按「開啟通知」即可收到雷達異動、自訂提醒、新聞、AI 日報、分點追蹤與大戶週報推播（iPhone 需 iOS 16.4 以上並從主畫面開啟）。自訂提醒在「盤中 → 提醒」或個股頁設定；分點追蹤與大戶排行在「籌碼」分頁。

## 連線方式與網域

在電腦版「資料與設定 → 遠端存取」設定：

| 欄位 | 用途 |
|---|---|
| 連線方式 | 自動、Cloudflare 臨時網址、Cloudflare 固定網域、自行處理、不對外開放 |
| 手機版網址 | 你的主要網址（例如 `https://pocket.example.com`），同時是推播通知的聯絡網址 |
| 其他允許的網域 | 同一個手機版有多個網址時填寫 |
| 推播聯絡信箱 | 沒有手機版網址（例如只用臨時網址）時，推播服務以這個信箱聯絡 |

只有填入的網域可以連線（防 DNS rebinding）；在電腦版新增網域後，手機版會在 15 秒內自動接受，不需重新啟動。
**變更連線方式**後才需要停止再啟動手機版。

### Cloudflare 臨時網址

免帳號、免網域：啟動時自動開啟 `https://xxxx.trycloudflare.com`（需要 `cloudflared`；Windows 啟動時會詢問是否用 winget 安裝，macOS 可用 `brew install cloudflared`）。
網址**每次重新啟動通道都會改變**，舊網址的推播訂閱也會失效。要套用程式更新但不換網址：Windows 執行 **重新啟動衡析（網址不變）.cmd**。

### Cloudflare 固定網域（Named Tunnel）

需要免費 Cloudflare 帳號，以及託管在 Cloudflare 的網域：

```bash
cloudflared tunnel login
cloudflared tunnel create equilens
cloudflared tunnel route dns equilens pocket.example.com
```

在本資料夾的 `.local/cloudflared.yml` 設定：

```yaml
tunnel: equilens
credentials-file: <你的 .cloudflared 資料夾>/<tunnel-id>.json
ingress:
  - hostname: pocket.example.com
    service: http://127.0.0.1:4340
  - service: http_status:404
```

接著在「遠端存取」選「Cloudflare 固定網域」，手機版網址填 `https://pocket.example.com`。啟動腳本會用這個設定檔啟動通道。
加碼防護（選用）：在 Cloudflare Zero Trust → Access 為手機版網址加上 Email 一次性驗證碼。

### 自行處理（任何網域、任何通道或反向代理）

在「遠端存取」選「自行處理」，衡析不會啟動任何通道；由你把 **https** 網址轉到這台電腦的 `http://127.0.0.1:4340`，並把網域填入「手機版網址」。
代理需轉送 `Host`、`X-Forwarded-For` 與 `X-Forwarded-Proto` 標頭（ngrok 與 Caddy 預設會轉送，Nginx 依下方設定；其他工具請確認），手機版據此辨識來源 IP（登入限速）與 https。沒有 `X-Forwarded-For` 時仍可使用，但所有人會共用同一組登入錯誤次數。範例：

```bash
# ngrok（固定網域需先在 ngrok 後台建立）
ngrok http 4340 --url pocket.example.com

# Tailscale Funnel（網址為 https://<電腦名稱>.<tailnet>.ts.net）
tailscale funnel 4340
```

```
# Caddy（自己的網域，自動申請憑證）：Caddyfile
pocket.example.com {
    reverse_proxy 127.0.0.1:4340
}
```

```nginx
# Nginx（自己的網域與憑證）
server {
    listen 443 ssl;
    server_name pocket.example.com;
    # ssl_certificate / ssl_certificate_key …
    location / {
        proxy_pass http://127.0.0.1:4340;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

代理必須跑在這台電腦上（Pocket 只接受 127.0.0.1 的連線），而且對外必須是 https：推播通知與安全 Cookie 都需要。

### 不對外開放

手機版只接受這台電腦本機的連線（例如只在電腦上使用，或暫時關閉手機存取）。

## 其他

- Windows 開機自動啟動：`Install-Autostart.ps1`（取消：`Remove-Autostart.ps1`）。
- 舊版在本資料夾 `.local/config.json` 寫的 `hosts` 與環境變數 `MOBILE_HOSTS` 仍然有效，會與電腦版設定的網域合併。

## 安全設計

- 密碼以 scrypt 雜湊保存（`.local/auth.json`），Session 只保存雜湊；變更密碼會登出所有裝置。
- 同一來源 15 分鐘內錯 5 次即鎖 15 分鐘；全站 1 小時錯 50 次暫停登入 1 小時。
- 來源 IP 與 https 只讀取所選連線方式的標頭：Cloudflare 模式讀 `CF-Connecting-IP`／`CF-Visitor`，自行處理模式讀 `X-Real-IP` 或 `X-Forwarded-For` 最後一筆／`X-Forwarded-Proto`；其他來源的標頭不被採信，無法藉偽造標頭繞過登入限速。
- Cookie：HttpOnly、SameSite=Strict、https 下 Secure；寫入操作需自訂標頭與同源檢查。
- 主機名稱白名單：本機、電腦版設定的網域（Cloudflare 臨時網址模式另允許 `*.trycloudflare.com`）。
- CSP、禁止被嵌入框架、不傳 Referrer；搜尋引擎 noindex。
- 手機端可以閱讀、查詢熱浪圖與法人、加減自選、更新行情與型態資料、調整雷達與新聞推播；資料來源、金鑰、AI 模型、研究族群與遠端存取只能在電腦版設定。

## 檔案

| 路徑 | 用途 |
|---|---|
| `server.mjs` | 手機版伺服器、登入、安全標頭、API 代理、推播轉送 |
| `lib/auth.mjs`／`lib/nexus.mjs`／`lib/push.mjs`／`lib/remote.mjs` | 密碼與 Session、Nexus API 用戶端、Web Push、連線方式與網域白名單 |
| `public/` | 手機介面；`i18n.js`、`market.js`、`insight-ui.js`、`report-card.js`、`flow-cards.js`、`save-image.js`、`intraday.js` 與電腦版共用（保持相同內容） |
| `scripts/set-password.mjs` | 設定密碼 |
| `.local/` | 密碼雜湊、Session、推播訂閱、通道設定、遠端存取設定快取（勿公開） |

```bash
npm test
```

研究資訊，非交易建議。
