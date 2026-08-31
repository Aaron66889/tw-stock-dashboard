# V12.4 FINAL R3.18 — Dark UI + 0050 Full 50

- 基於 R3.17 功能，不改 0050 Yahoo 長期回測資料鏈。
- 全站 UI 改為 0050 成分股預覽頁的深色戰情風格。
- 0050 成分股頁維持完整 50 檔官方資料動態渲染，不以 Top 10 冒充。
- 只要 API 回傳 50 檔，熱力圖與完整明細會呈現 50 檔。

# V12.4 FINAL R3.17 — 0050完整50檔成分股雷達

- 沿用R3.16已穩定的0050 Yahoo 2009長期回測與價格尺度QA。
- 0050成分股優先直接解析元大官方持股比重頁；完整50檔才可納入模型。
- 新增「0050成分股」獨立頁：50檔熱力圖、完整明細、等權/權重廣度、台積電/前十大權重。
- 成分不足50檔或行情覆蓋不足時，只顯示資料、不影響三層買點。
- 官方來源：https://www.yuantaetfs.com/product/detail/0050/ratio

# V12.4 FINAL R3.16 — R3.11 stable Yahoo history + 0050 split fix

- Base: R3.11 Yahoo History Fallback (the version that successfully returned 0050 long history on Render).
- 0050 accepts the actually available long daily sample (e.g. 2009 onward); it does not force 2003 coverage.
- UI explicitly shows backtest data start date, end date, and trading-day count.
- 0050 2025-06-18 1:4 split is normalized: all pre-split OHLC are divided by 4.
- Yahoo Adj Close is not used to scale OHLC, avoiding dividend-adjustment factors contaminating MAE/MFE.
- LONG_SAMPLE_READY remains distinct from FULL HISTORY PASS.

# 台股戰情 V12.4 FINAL R3

本版針對實機驗收發現的問題重新修正。

## R3 核心修正
- 導覽列移到頁面最上方；首頁 / 我的持股 / ETF買點 / 夜盤 / 明日環境 / 模型驗證 / 判斷說明 / 問答皆可直接切換。
- 我的持股沿用舊版 `twStockHoldingsV12`；沒有 localStorage 時恢復 V12.3.1 原預設四筆，不再因升級變空白。持股仍只在「我的持股」頁顯示。
- 45項規格頁改成真正驗證中心：PASS / PARTIAL / FAIL / WAIT，有證據、原因與最後狀態；另有3項核心風控驗證。
- 新增 `/api/validation`；「執行完整驗證」會跑四檔 TWSE 上市日至今歷史完整性與企業行動檢查。
- 四檔回測改成 TWSE 官方資料優先：`STOCK_DAY`；早期無OHLC時用 `STOCK_DAY_AVG` 官方收盤資料，明確標示精度。
- 0050 2025-06-18 1拆4依 TWSE 官方 4:1 校正。
- 配息調整使用 TWSE ETF e添富配息清單建立向後調整因子。
- 回測前先驗證：官方掛牌日 vs 實際第一筆、缺口、重複、異常價格、還原後>35%異常跳動；未通過禁止輸出正式績效。
- 「市場參與率」重寫：只在60交易日漲幅>10%的多頭窗口，檢查前30日是否有不晚於起點+8%的合理訊號，不再用「60日內曾有訊號」假裝參與率。
- MAE 顯示最差訊號日期、最低日期、最低價與OHLC/close精度。
- 0050/0056早期若TWSE只提供收盤資料，不假造High/Low；回測標示 close precision。
- 前後端JSON讀取都先檢查回傳內容；來源若回HTML，錯誤會顯示哪個API/host，不再只有 `Unexpected token '<'`。

這個安裝包以 V12.3.1 的核心頁面與資料來源概念為基礎，整合 V12.4 的 45 項規格與後續新增風控。

## 已整合的主要功能
- 大盤首頁、我的持股、明日環境、判斷說明保留。
- 台指夜盤正負號自行重算；相對參考價與距今晚最高點分開。
- 夜盤 1 / 3 / 5 / 15 分鐘動能。
- 08:57–08:59:30 盤前預測與鎖定。
- 0050 / 0056 / 00878 / 00919 四檔獨立三層動態買點。
- 評分制、少數硬 Gate、資料逾時停止判斷。
- 防追高、買點上修限速、慢速重新定錨、買不到/參與率保護、防買點下逃、Hysteresis、快速穿透保護。
- 30 秒模型買點歷史 + 同步實際價格；重複區間折疊並保留維持時間；近 7 日主要買點區。
- ETF 成分引擎、權重式健康度、分歧/背離、熱力格、有效日期版本快照。
- 市場廣度明確標示「上市集中市場」、漲跌平家數與比例。
- Google News RSS 重大事件風險層，且與 SOX / ADR / 夜盤做去重降權。
- 我的持股沿用舊版 `twStockHoldingsV12`；舊版同一瀏覽器已有資料會直接沿用。若該鍵從未建立，恢復 V12.3.1 原預設四筆，且只在『我的持股』頁顯示，不會出現在首頁。
- 行情約 10 秒、買點約 30 秒；回到前景立即完整刷新。
- 全歷史價格核心回測：上市日至今為主，近10/5/2/1年為切片；防追高 A/B；Walk-forward；5/20/60日、MAE、參與率、高位買入率、最長無訊號等。
- 高股息 ETF 回測使用調整後 OHLC，降低正常除息被誤判為暴跌的問題。
- 全站紅漲、綠跌；版本統一 V12.4。

## 成分股完整性原則
V12.4 不允許「抓到前5或前10大就假裝完整成分股」：
- 來源完整度與即時行情權重覆蓋達門檻，健康度才會進模型。
- 不完整時 UI 仍可顯示已抓到的資料，但健康度會標成「不計分」。
- 00878 使用國泰官方 Excel API，可支援指定歷史日期的持股資料。
- 0050 / 0056 / 00919 目前依發行商官方頁面自動解析；若官方伺服器 HTML 只回傳折疊前資料，系統會拒絕把部分名單當完整模型輸入。
- 瀏覽器會把每次讀到的新有效日期保存成版本；歷史缺版本時不拿今天成分倒灌，避免 look-ahead bias。

## 回測範圍
- 0050：約 2003 上市日起
- 0056：約 2007 上市日起
- 00878：約 2020 上市日起
- 00919：約 2022 上市日起

主結果永遠是上市日至今全歷史。近10年、5年、2年、1年只是檢查模型在不同年代是否變質。

## Render 安裝
1. 解壓 ZIP，把所有檔案上傳到 GitHub repository 根目錄。
2. Render Web Service：
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
3. 部署後先開 `/api/health`，確認 `ok: true` 與 `version: "V12.4"`。
4. 再開首頁。

## 重要限制
- Render Free 休眠時無法保證 08:57 背景執行；盤前快照需要服務與瀏覽器當時有被喚醒。若沒有捕捉，系統不會事後偽造盤前版本。
- 公開網站資料格式可能改版；任何來源解析不足時 V12.4 會降級或停用該因子，不會用錯資料硬算。
- 全歷史回測目前是「價格核心」的 no-look-ahead 驗證。只有有真實歷史成分版本覆蓋的日期，才可安全加入成分健康因子。
- 此工具為資訊整理與模型驗證，不構成投資建議，也不保證最低點或獲利。


## R3 重建重點
- `/api/backtest` 不再一次同步抓數百個月份；TWSE全歷史改背景逐月暖機，前端顯示進度並自動重試。
- `/api/validation` 不再因回測/成分/海外單一來源失敗而 HTTP 500；45格各自獨立判定 PASS/PARTIAL/FAIL/WAIT。
- `/api/*` 應用層錯誤一律回結構化 JSON，避免 `Unexpected token '<'`。
- 靜態 HTML/JS/CSS `no-store` + `?v=R3`，避免瀏覽器繼續吃舊版 app.js。
- 四檔歷史以 TWSE STOCK_DAY / STOCK_DAY_AVG 為主，0050 分割校正保留，配息改成「整段範圍優先＋逐年補抓」。
- 0050/0056 成分資料改用元大「持股比重＋PCF」雙來源；不完整時仍顯示已抓資料，但健康分不進模型，不再拖垮整支買點API。
- 00878 繼續用國泰官方 Excel；00919 繼續用群益官方投資組合頁。


## R3 本機驗收
- `node --check server.js`：PASS
- `node --check public/app.js`：PASS
- `/api/health`：HTTP 200，`build=R3`
- `/api/validation`：HTTP 200，回傳 45 項獨立 PASS/PARTIAL/FAIL/WAIT 結果；單一來源失敗不再讓整支 API 500
- `/api/backtest?code=0050`：第一次回 `ready=false / status=WARMING` 與逐月進度，不再同步塞完所有月份造成 HTTP 500
- 靜態資源加入 R3 cache-busting，避免瀏覽器繼續執行舊版 JavaScript

第一次執行四檔全歷史回測/完整驗證時，TWSE 歷史會逐月背景建立。Render Free 若重啟，暫存的背景資料可能需要重新建立；畫面會顯示實際進度，不會把未完成狀態冒充 FAIL 或 PASS。


## R3.1 Render health-check permanent fix
- Render existing service is checking `/health`; the server now responds 200 on `/health`, `/api/health`, `/healthz`, and `/readyz`.
- Health endpoints are deliberately lightweight and never call TWSE/Yahoo/news/constituent sources.
- Server explicitly binds to `0.0.0.0:$PORT`.
- `render.yaml` now uses `healthCheckPath: /health`.
- This prevents a healthy Node process from being marked unhealthy merely because Render retained an older `/health` setting.


## R3.6 Data Resilience Fix
- 即時台股資料改成三層：TWSE MIS → Yahoo Finance 即時備援 → TWSE STOCK_DAY_ALL 盤後備援。
- 非交易時段即使 MIS 不回資料，也會用證交所最近交易日正式資料顯示，不再整頁空白。
- 盤中若只能取得盤後資料，標示「盤後備援」且模型 `dataFresh=false`，不會拿舊盤後價確認買點。
- ETF 成分行情若 MIS 失敗，改用 TWSE STOCK_DAY_ALL 一次取得全上市市場盤後資料，避免完整健康度因單一即時來源掛掉而完全空白。
- 慢速資料改為 Promise.allSettled：市場廣度、TAIEX、NASDAQ/SOX/TSM ADR、新聞互不連坐。
- 夜盤失敗會明確顯示失敗，不再永久停在「讀取中」。
- 前端保存最後一次成功資料；短暫來源失敗時顯示資料年齡，避免畫面全部變成「—」。
- 取消冷啟動同時轟炸所有外部來源，降低 Render Free 啟動時被限流的機率。
- 新增 `/api/diagnostics`，可直接查看目前行情來源、是否即時及各來源錯誤。
- 版本文字統一為 V12.4 FINAL R3.6。


## R3.6 關鍵修正：前端完全不啟動
R3.2 的後端其實正常，`/api/diagnostics` 可顯示 TWSE MIS realtime 且 errors=[]。
真正問題是 `public/app.js` 的初始化順序：
`H=loadHoldings()` 在 `const DEFAULT_H=...` 宣告之前執行，觸發 JavaScript Temporal Dead Zone：
`ReferenceError: Cannot access 'DEFAULT_H' before initialization`。

R3.6：
- 把 `DEFAULT_H` 移到 `loadHoldings()` 首次執行之前。
- 加入 window error / unhandledrejection 顯示保護，未來前端若再崩潰會直接在畫面顯示錯誤，不會只停在「正在載入市場」。
- 靜態 JS/CSS cache-busting 更新為 R3.6。

## R3.6：只修三件事

### 1. 模型實戰成績
ETF買點頁可按「記錄模型買入」，保存實際成交價、股數、第1/2/3層與進場當下完整模型快照。
模型頁新增「我的模型實戰成績」，追蹤：
- 目前損益與報酬
- 5 / 20 / 60交易日總報酬
- MAE / MFE
- 模型分數、防追高、環境、成分健康快照
- 可記錄賣出價格並保留實現損益
資料只存在瀏覽器 localStorage (`v124_model_trades`)，與「我的持股」分離。

### 2. 完整成分股
- 0050：元大官方 `StkWeights` API（fundid 1066）優先。
- 0056：元大官方 `StkWeights` API（fundid 1084）優先。
- 00878：國泰官方完整 Excel 維持。
- 00919：群益官方頁的前十大作驗證，完整公開持股快照作補齊；交叉驗證不足就不計健康度。
- 元大官方API若暫時拒絕Render伺服器，才使用完整公開快照，且必須與元大官方可見持股交叉驗證才可納入健康分。
因此畫面不再把10檔/9檔標成完整成分股。

### 3. TWSE官方全歷史自動建立
- 服務啟動3.5秒後自動開始，不需按回測。
- 0050 / 0056 / 00878 / 00919 全部進背景佇列。
- 月份失敗不再寫成空陣列冒充完成；最多4輪重試。
- 每15分鐘自動重試尚未完成的歷史。
- 模型卡片在官方歷史完成前明確寫「暫用歷史樣本」，並顯示 TWSE 月份進度；只有 fullHistoryPass 才寫「TWSE官方全歷史」。
- 官方完成後買點模型會在下一輪30秒模型刷新自動切換。


## R3.6：全歷史完成條件收斂
四檔歷史不再只靠「月份抓完」就算完成。必須同時通過：
1. 上市日附近第一筆資料驗證。
2. 最新交易日驗證。
3. 日期順序、重複、長缺口、樣本數驗證。
4. 2010 年後 OHLC 覆蓋率驗證；0050/0056 2010 年以前允許使用 TWSE 官方收盤價，因此早期 MAE/盤中觸價精度會標示為 close-only。
5. ETF e添富配息覆蓋驗證。
6. 0050 2025-06-18 1拆4校正後連續性驗證。
7. 調整後序列不得殘留 >35% 的單日異常跳變。

TWSE 每月資料改為 JSON → CSV 雙路徑。JSON 暫時被擋或回非 JSON 時，會自動改抓 TWSE 官方 CSV；月份失敗最多四輪重試。
`/api/history-proof` 可直接查看四檔的第一筆、最後一筆、實際交易日、配息、企業行動與 PASS/FAIL 證據。
只有 `priceHistoryPass && corporateActionPass && backtestPrecisionPass` 全部通過，畫面才允許顯示「TWSE官方全歷史 PASS」。


## R3.6 Proof Fix
- 成分股只接受投信官方網域。0050/0056：元大官方 StkWeights / PCF / 官方下載；00878：國泰官方 Excel；00919：群益官方申購買回清單 / 頁內 JSON / 官方下載。第三方完整快照 fallback 已移除。
- `/api/constituent-proof`：四檔官方來源、檔數、權重覆蓋率逐檔 PASS/FAIL。
- 全歷史只有 `validation.fullHistoryPass === true` 才停止背景任務。舊的 VALIDATION_FAIL ready 檔不再阻止重試。
- 已存月份若只有異常少量交易日，R3.6 會視為缺月並重新抓取，不再因「該月有一筆資料」就冒充月份完成。
- `/api/history-proof` 仍是最終全歷史驗收；四檔 READY 才 `allPass:true`。


## R3.7 三項 BUG 最終驗收規則

### 1. 模型實戰成績
- localStorage key: `v124_model_trades`，不與 `twStockHoldingsV12` 混用。
- 記錄：ETF、第1/2/3層、成交價、股數、成交時間、三層買點快照、模型分數、防追高、環境、成分健康、夜盤/海外快照。
- 追蹤：目前損益、目前報酬、5/20/60交易日總報酬、MAE、MFE、是否後續觸及第2/3層、是否高於第1層上緣進場。
- 可記錄實際賣出並保留實現損益。

### 2. 四檔完整成分股
- 0050/0056：只允許 `*.yuantaetfs.com` 官方來源。
- 00878：只允許 `*.cathaysite.com.tw` 官方 Excel。
- 00919：只允許 `*.capitalfund.com.tw` 官方申購買回清單、內嵌 JSON 或官方下載檔。
- 第三方完整快照 fallback 已移除。
- `/api/constituent-proof` 只有「官方網域 + 實際檔數>=官方預期 + 權重筆數>=官方預期」才 PASS。

### 3. TWSE 全歷史
- 舊 `VALIDATION_FAIL` ready 檔不會卡死；只有 `fullHistoryPass=true` 且資料仍新鮮才停止修復。
- 空月份或異常稀疏月份不算完成，會重新抓。
- 2010年後 close-only 月份會重新抓 `STOCK_DAY` OHLC。
- FAIL 後依上市月、長缺口、調整異常、OHLC 缺失建立 repair keys，12秒後自動再進佇列。
- PASS 超過12小時只刷新最新月份，不從2003重新抓。
- `/api/history-proof` 四檔 `fullHistoryPass=true` 才 `allPass:true`。

### 一次驗收
部署後：
- `/api/constituent-proof`
- `/api/history-proof`
- `/api/core3-proof`

`/api/core3-proof` 將三項狀態合併顯示；其中全歷史仍需等 Render 背景把 TWSE 月資料實際建立完成才可能變成 `allPass:true`。


## R3.7 本機驗收結果
- `node --check server.js`：PASS
- `node --check public/app.js`：PASS
- `/health`：HTTP 200，`build=R3.7`
- 前端同步 Boot VM：PASS（無 TDZ / startup ReferenceError）
- 成分股官方來源離線模擬：
  - 0050 50/50、權重50/50：PASS
  - 0056 50/50、權重50/50：PASS
  - 00878 30/30、權重30/30：PASS
  - 00919 40/40、權重40/40：PASS
  - `/api/constituent-proof allPass=true`
- 舊 `VALIDATION_FAIL` 歷史檔重試測試：PASS（觸發後由 VALIDATION_FAIL → RUNNING，不會被舊 ready 檔卡住）
- 模型實戰 API 模擬：PASS
  - current P/L / return：PASS
  - 5 / 20 / 60交易日：PASS
  - MAE / MFE：PASS
  - reachedLayer2 / reachedLayer3：PASS
  - chaseEntry：PASS

注意：以上成分股測試驗的是「解析與PASS規則」本身；部署後實際官方站是否當下允許 Render 存取，仍由 `/api/constituent-proof` 顯示真實結果。TWSE 全歷史的實際625個月左右資料也必須在 Render 背景跑完，才會由 `/api/history-proof` 客觀變成 `allPass:true`。
\n\n## R3.11-YAHOO-HISTORY-FALLBACK：來源逾時不再把整個頁面卡在「資料檢查中」\n- `/api/market` 最長等待 8.5 秒；外部行情失敗時回結構化 TIMEOUT，前端立即改用最後成功資料或顯示連線失敗，不會無限等待。\n- `/api/buy-model` 的行情、歷史、成分健康全部加入獨立 deadline；完整成分來源失敗只會讓健康度「暫不計分」，不能拖死整個買點模型。\n- 前端所有一般 API fetch 加 12 秒 AbortController；深度驗證/回測另給 30 秒。\n- `/api/constituent-proof` 與 `/api/core3-proof` 四檔改平行驗證，單檔官方來源最長 15 秒；來源故障會明確 FAIL/TIMEOUT，而不是 HTTP 一直掛著。\n- `/api/core3-proof` 的「模型實戰成績」不再硬編 `pass:true`，改為直接檢查部署中的 `app.js` 是否具備 storage key、記錄、5/20/60日、MAE/MFE、第2/3層觸及、追高與賣出追蹤程式。\n- Build 更新為 `R3.11-YAHOO-HISTORY-FALLBACK`，JS/CSS cache-busting 同步更新，避免 iPhone Safari/PWA 繼續載入 R3.7。\n

## R3.10 Goodinfo 0050 fallback
- 0050 全歷史暖機：TWSE STOCK_DAY / STOCK_DAY_AVG 全部失敗後，改抓 Goodinfo 日K頁作為備援。
- Goodinfo 僅為備援，不取代 TWSE 官方主來源。
- Goodinfo 頁面未涵蓋的舊月份仍會標示缺資料，不會偽造完整歷史。
- /api/diagnostics 新增 goodinfo0050 狀態。

## R3.10 — 0050 Goodinfo 長期歷史橋接
- 0050 暖機時優先使用 Goodinfo `ShowK_Chart.asp` 的 POST 歷史查詢模式：`CHT_CAT2=DATE&STEP=DATA&PERIOD=6000`。
- 使用 `PRICE_ADJ=T` 還原權息日K，避免再次套用除息/分割造成雙重調整。
- 一次取得長期日K後按月份寫入本地 history cache，不再為 0050 逐月發出 279 個 Goodinfo request。
- 長期資料硬驗證：至少 3,000 日、至少 10 年、最新資料不超過 30 日、OHLC 覆蓋率 >=97%。
- 若未涵蓋上市首日但達長期樣本門檻，允許回測，狀態為 `LONG_SAMPLE_READY` / PARTIAL；只有涵蓋上市日起才是 `FULL HISTORY PASS`。
- `/api/diagnostics` 顯示 Goodinfo POST mode、實際 period、cachedRows 與錯誤。


## R3.21 issuer source recovery
- Yuanta 0050/0056: XHR headers + explicit recent-date StkWeights retries + cache namespace reset.
- Capital 00919: portfolio + buyback pages, date/queryDate variants, embedded JSON and official download discovery.
- No third-party holdings are used to complete official constituent counts.
- 00878 Cathay path unchanged.


## R3.22
- 今日模型事件新增「清除事件」按鈕。
- 清除 localStorage `v124_events`，後續新事件仍正常記錄。
- 不修改模型、回測與成分股資料邏輯。

## R3.23
- 移除新聞顯示區塊。
- 前端停止請求 `/api/news-risk`。
- 三層模型新聞修正固定為 0，環境分數只使用大盤、台積電、台指夜盤、NASDAQ、SOX、TSM ADR、市場廣度、完整成分健康。
- 45項驗證的新聞兩項改為「海外風險層」與「環境避免偏科」。
- 保留 R3.22 清除模型事件按鈕與 R3.21 成分股來源修復。

## R3.24
- 修正成分股頁快速切換 ETF 時，舊的 00878 非同步回應覆蓋新分頁的 race condition。
- 每次切換都建立新的 request sequence；只有目前選中的 ETF 回應可更新畫面。
- 移除全域 constituentLoading 鎖，允許切換後立即發出正確 ETF 請求。
- 加入 API 回傳 code 與使用者要求 code 一致性檢查，禁止其他 ETF 資料誤顯示。

## R3.25
- 0050/0056：改以元大官方 PCF（申購買回清單）為第一來源，不再把持股比重頁前5檔當主要來源。
- PCF parser 改成逐筆「股票代碼」區塊解析，容忍欄位間距/換行變化；完整50檔後以官方PCF股數 × TWSE即時價估算權重。
- 00919：停止大量序列輪詢，改成 portfolio/buyback 平行限時抓取＋少量官方下載候選平行嘗試，避免18秒前端 timeout。
- 00919 若仍只能取得官方前10檔，會快速顯示10/40且明示不計分，不再整頁擷取失敗。

## R3.26
- 修正 R3.25 元大來源退化：0050/0056 完整來源失敗時，必須保留官方 ratio 頁的 5 檔，不得回傳 0 檔。
- 加入來源診斷 attempts：ratio / PCF / StkWeights 各自顯示 OK/FAIL、解析筆數與錯誤。
- 00919 保持快速回傳官方10/40，不再因找完整來源造成整頁 timeout。
- 完整度不足仍不納入三層模型。

## R3.27
- 0050 / 0056 / 00919：改用使用者指定的口袋證券 fundholding 頁取得完整持股與權重。
- 00878：維持已成功的國泰官方 Excel，不動。
- 口袋證券只提供「成分＋權重」；每檔個股現價/昨收/漲跌幅仍由 dashboard 的 quoteCodes 市場行情模組自行取得。
- 健康度仍要求：完整成分、完整權重、行情權重覆蓋率 >= 75%，否則不進模型。
- 畫面明確標示第三方持股來源，不冒充官方來源。

## R3.28
- 0050 / 0056 / 00919：不再依賴 Pocket 動態頁，改用 MoneyDJ「全部持股」公開 HTML 作為完整成分＋權重來源。
- MoneyDJ parser 解析：股票名稱、股票代號、投資比例、持有股數、資料日期。
- 00878：維持國泰官方 Excel。
- 個股上漲/下跌仍由 dashboard 既有 quoteCodes 行情模組自行取得，MoneyDJ 不負責即時漲跌。
- 完整度 Gate 不變：成分完整、權重完整、行情權重覆蓋率 >=75% 才進成分健康層與三層買點修正。

## R3.43 Recovery Baseline
- 目的只有一個：回到「所有既有模組先能運作」的基準，不再疊加新功能。
- 成分股整體回退到 R3.28 已驗證成功架構：
  - 0050 MoneyDJ 完整50檔
  - 0056 MoneyDJ 完整50檔
  - 00878 國泰官方Excel 30檔
  - 00919 MoneyDJ 完整40檔
- 移除 R3.40~R3.42 的成分來源平行 race、Pocket/官方回復鏈、TPEx/Yahoo單股額外 fallback 等未驗證改動。
- 0050 歷史回退到 R3.16 已在 Render 實際成功的 Yahoo 0050.TW 長歷史路徑 + scale-v2 1拆4尺度QA。
- 0056 / 00878 / 00919 保留後續已驗證成功的 Yahoo Adjusted OHLC 全歷史路徑與 00919 age-aware validation。
- 本版不做新的0050 dividend-adjusted改造；先恢復可回測基準，再於此版本之上單獨處理。

## 台股戰情16.8 — Stability-only
本版只處理 Render 間歇性 502 / Bad Gateway 的伺服器層穩定性，不修改任何模型公式、0050計算、歷史資料算法、成分股算法或45項驗證邏輯。

變更：
- Node HTTP keepAliveTimeout = 120s
- headersTimeout = 125s
- requestTimeout = 30s
- 冷啟動先讓服務可回應；首次 runtime refresh 延後5秒
- 全歷史背景建立延後到45秒，避免與首次行情/模型外部連線同時爆量
- 全歷史自動檢查週期由15分鐘改30分鐘；不改實際歷史建立算法
- /health 原本即為純本機輕量回應，維持不連外
- 網頁名稱：台股戰情16.8

## 16.8.2 — 四檔ETF即時價格專修
- 新增 /api/etf-live 輕量行情端點，只抓 0050 / 0056 / 00878 / 00919。
- 第一順位 TWSE MIS，一次請求四檔；缺檔才對該ETF走 Yahoo 單股備援。
- 前端每5秒獨立更新四檔ETF現價，不再依賴大盤 /api/market 是否完整成功。
- 即時價會更新首頁ETF卡、買點卡、ETF詳細頁與持股現價。
- 完全不修改買點模型、0050計算、歷史、回測、成分股與驗證邏輯。

## 16.8.3 — ETF即時價快取修正
- 找到上一版仍可能不跳價的原因：/api/etf-live 每次使用同一URL，瀏覽器或中介層可能重用相同GET回應。
- 前端每次請求加入時間戳 cache-buster。
- /api/etf-live 明確回傳 Cache-Control: no-store/no-cache。
- 台股盤中每3秒刷新；非盤中每10秒。
- 僅修改四檔ETF即時價傳輸/刷新，不修改模型、歷史、回測、成分股與買點演算法。

## 16.8.4 — ETF現價直接行情修正
- 修正核心問題：TWSE MIS 在盤中若 `z` 為 `-` / 空值，舊 parser 會自動退回 `y`（昨收），因此畫面看似有價格但永遠不跳。
- 現在 parseMis 不再拿昨收冒充現價。
- 盤中 MIS 沒有有效 `z` 時，該ETF立即改用 Yahoo Finance current price。
- 四檔ETF盤中每2秒刷新。
- 現價欄下方顯示行情時間，方便直接驗證是否真的在更新。
- 不修改模型、歷史、回測、成分股或買點演算法。
