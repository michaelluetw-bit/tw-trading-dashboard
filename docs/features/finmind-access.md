# FinMind 憑證與可信還原價

第一階段將憑證狀態、資料權限與限流分開。原始行情仍可使用；缺可信還原價的技術分項、型態篩選及相關綜合排名停止，不補零、不重新分配缺漏分項的權重。

## 在哪裡

資料與設定的 FinMind 卡片顯示憑證狀態及方案。桌機與手機研究結果顯示「缺項・不可比較」，保留可用原始行情與分項。

## 運作方式

- `.local/finmind-access.json` 只保存非機密狀態，與憑證內容分離。狀態包含 missing、unverified、valid、revoked、auth_failed；沒有狀態檔時為 unverified，不自動測舊金鑰。
- revoked／auth_failed 不因重啟、切資料源或清快取而解除；資料、快照與既有金鑰驗證都受同一閘門控制，排隊後送出前再次檢查。
- 未來使用者主動提交新憑證時，候選憑證驗證成功且儲存成功才切換 valid；本次修正沒有產生、設定或測試任何真憑證。
- 官方 user_info 文件僅明示使用量欄位，未核實自動判讀方案的欄位契約。因此不使用數字 level、level_title 或配額猜方案；回應保持 unknown。valid 的 unknown 可用官方明示的基礎資料，付費能力需另外核實 official-account 權限證據；本階段尚未提供設定該證據的介面，不宣稱付費方案已自動開通。
- 明確能力矩陣支援 Free 原始個股日線，Backer 還原價與全市場原始／還原單日，Sponsor 再開分K／快照。未核實的其他籌碼權限不因Sponsor名稱就全開。
- HTTP與業務狀態分別判讀。401及明確400認證錯誤持久標記auth_failed；403只記錄拒絕、不猜訂閱等級；402／429限制進入一小時退避。網路錯誤單次失敗，不在transport內自動重試；既有排程上限仍適用。
- 所有FinMind資料請求共用佇列；快照亦不再繞過。7秒設定下不會因購買高配額自動加速。驗證請求也排入佇列。

## 原始與還原資料

只有adapter實際要求還原資料時附上的來源、資料集、區間、取得時間可作為來源證明。舊 adjustedIsRaw 或無來源證明陣列原封保留，但不作可信還原計算。FinMind原始成功、還原失敗時仍保留原始結果；已有可信舊還原則連同舊來源保留，原日期與錯誤仍可見。

型態更新使用 `verified-v1-` 隔離目錄，避免舊ledger把原始代用資料認證成還原。TWSE全市場原始資料不再自動冒充全市場還原資料。第一階段不改資料來源偏好，不補抓歷史、不批量遷移，也不實作新的全市場共用快取。

## 時間與限制

16:30日報與19:30研究更新時點不變；沒有可信還原時保留可用盤後功能。來源證明表示資料來源與批次取得時間，**不是**官方保證的point-in-time還原版本；跨批次公司行動一致性及共用快取屬後續階段。本專案未找到獨立日線回測入口；需還原的現有研究／型態入口均受檢查，盤中當沖逐筆檢討不受影響。

## 驗證與回復

測試必須使用暫存資料與 `tests/helpers/offline.mjs` 預載，僅允許本機fixture伺服器，阻擋外網與憑證工具。Windows加密測試只在Windows執行。回復程式前保留停用標記；舊程式不認識標記，不可把回復舊程式視為繼續受到保護。舊資料沒有被批量修改。

相關檔案：`lib/finmind-access.mjs`、`lib/adjusted-data.mjs`、`lib/providers/finmind.mjs`、`lib/research.mjs`、`lib/pattern-service.mjs`。

依據：[官方使用量契約](https://finmind.github.io/api_usage_count/)、[價格與權限](https://finmind.github.io/Pricing/)、[技術資料集](https://finmind.github.io/tutor/TaiwanMarket/Technical/)。
