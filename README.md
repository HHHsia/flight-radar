# Flight Price Radar（機票價格雷達）

以 TypeScript 撰寫的服務：用 **SerpApi（Google Flights）** 追蹤指定航線票價、寫入 **Turso / libSQL** 歷史，並在票價進入該航線歷史前三低時透過 **Discord** 通知；另可解析 **RSS** 並用 **LLM** 擷取商務艙 deal。

---

## 目錄

1. [你要改航線／時間時看這裡](#你要改航線時間時看這裡)
2. [本機怎麼跑](#本機怎麼跑)
3. [GitHub Actions：排程與手動執行](#github-actions排程與手動執行)
4. [環境變數與 Secrets](#環境變數與-secrets)
5. [常見指令一覽](#常見指令一覽)
6. [怎麼判斷卡死還在跑](#怎麼判斷卡死還在跑)
7. [給 AI／助理的說明文件](#給-ai助理的說明文件)
8. [截圖與技術棧摘要](#截圖與技術棧摘要)

---

## 你要改航線／時間時看這裡

### 兩個檔案必須一起改

| 檔案 | 用途 |
|------|------|
| [`src/scripts/seed-tracked-destinations.ts`](src/scripts/seed-tracked-destinations.ts) | 本機或手動 **寫入／覆寫** DB 裡的追蹤列（`INSERT OR REPLACE`） |
| [`src/scripts/sync-tracked-destinations.ts`](src/scripts/sync-tracked-destinations.ts) | **CI 與你預期線上資料** 的來源：每次 workflow 會先跑它，把「清單上的航線」同步進 DB，並把**不在清單上的列設為停用** |

若只改 seed、不改 sync：**GitHub Actions 下次跑仍會用舊的 sync 清單蓋回線上**。  
請維持 **`seedRows` 與 `trackedRows` 內容一致**（同一組 `id`、機場、日期、艙等）。

### 機場代碼怎麼寫

- **單一機場**：IATA 三碼，例如 `TPE`、`OKA`。
- **多機場（SerpApi 支援以逗號查詢）**：例如 `TAS,SKD,BHK`（塔什干／撒馬爾罕／布哈拉）。  
  格式須符合程式內驗證：英數與逗號，見 [`src/schemas/domain.ts`](src/schemas/domain.ts) 的 `serpApiLocationIdSchema`。
- **出發地特例**：若未來使用 `LON` 等聚合代碼，job 會展開成多個倫敦機場查詢（見 `src/jobs/normal-fares.ts`）。

### 日期怎麼寫

- 使用 **`YYYY-MM-DD`**（ISO 日曆日）。
- **來回**：`departureDateFrom` / `departureDateTo` 為去程可接受區間；`returnDateFrom` / `returnDateTo` 為回程可接受區間。  
  請確保合理組合下 **回程 ≥ 去程**（例如最晚去程日仍早於最早回程日，或區間有重疊時由 SerpApi 切片邏輯過濾；極窄窗如各兩天亦可）。
- **日期區間與 API 次數**：區間愈寬，SerpApi 會切成愈多 **slice**（每次 HTTP 一組去程＋回程），掃描愈久、點數愈多。窄窗（例如去程兩天、回程兩天）可明顯減少請求與執行時間。

### 其他常用欄位

- `tripType`：`round_trip` 或 `one_way`
- `cabinClass`：`economy` | `premium_economy` | `business` | `first`
- `maxStops`：例如 `1` 表示最多轉機一次（對應 SerpApi `stops` 參數對照在 `src/clients/serpapi.ts`）
- `currencyCode`、`locale`：例如 `TWD`、`zh-TW`（語系須用區域標籤，避免 bare `zh`）

改完後：**`npm run build`**，再 **`npm run sync:tracked-destinations`**（本機有 `.env` 時）或依下節推送後由 CI 同步。

### 順手更新 workflow 註解（建議）

[`.github/workflows/normal-fares.yml`](.github/workflows/normal-fares.yml) 檔頭註解列了目前追蹤摘要，**與程式不同步時不影響執行**，但會誤導閱讀；建議一併更新。

---

## 本機怎麼跑

```bash
npm install
cp .env.example .env
# 編輯 .env：DATABASE_URL、DATABASE_AUTH_TOKEN、SERPAPI_API_KEY、DISCORD_WEBHOOK_URL、RSS_FEED_URLS 等

npm run build
# 若資料庫尚未建表，請依專案內 db/migrations 順序套用
npm run init:database   # 若專案有提供初始化腳本且適用你的環境

# 二選一（或兩者都跑以驗證）
npm run seed:tracked-destinations   # 寫入／更新種子列
npm run sync:tracked-destinations   # 停用全部後，只啟用清單內列（與 CI 一致）

npm run job:normal-fares          # 只跑一般票價掃描一次
npm start                         # 啟動常駐排程（見 .env 的 CRON 與 startup 開關）
```

**`seed` 與 `sync` 差異簡述**

- **seed**：對種子列做 `INSERT OR REPLACE`，**不會**自動把其他 DB 列設為停用。
- **sync**：先把 **`tracked_destinations` 全部 `is_active=0`**，再對清單內每一列 upsert 並設為啟用。與 CI 行為一致。

---

## GitHub Actions：排程與手動執行

### Workflow 檔案

| 名稱（GitHub UI） | 檔案 | 排程（cron 為 UTC） |
|-------------------|------|---------------------|
| **Normal Fares Scanner** | [`.github/workflows/normal-fares.yml`](.github/workflows/normal-fares.yml) | 每 12 小時：`0 0,12 * * *` → 台灣時間約 **08:00、20:00** |
| **Business Deals Scanner** | [`.github/workflows/business-deals.yml`](.github/workflows/business-deals.yml) | 每 45 分鐘：`*/45 * * * *` |

**一般票價 job 順序**：`npm ci` → `npm run build` → **`npm run sync:tracked-destinations`** → **`npm run job:normal-fares`**。  
因此線上 DB 永遠會先被 repo 內的 `sync-tracked-destinations.ts` 清單更新。

### 修改排程

編輯對應 YAML 的 `on.schedule.cron`。GitHub 使用 **UTC**。台灣時間 ≈ UTC+8。

### 手動觸發（本機已安裝 `gh` 並登入）

```bash
gh workflow run "Normal Fares Scanner" --repo <你的帳號>/flight-radar
gh workflow run "Business Deals Scanner" --repo <你的帳號>/flight-radar
```

### Repository Secrets

CI 需要的變數請在 **GitHub → Settings → Secrets and variables → Actions** 設定（名稱需與 workflow `env` 一致），例如：`DATABASE_URL`、`DATABASE_AUTH_TOKEN`、`SERPAPI_API_KEY`、`SCRAPERAPI_KEY`、`DISCORD_WEBHOOK_URL`、`RSS_FEED_URLS`；商務艙 workflow 另需 `OPENAI_API_KEY`。

---

## 環境變數與 Secrets

完整範例見 [`.env.example`](.env.example)。**不要**把含金鑰的 `.env` 提交進 Git。

---

## 常見指令一覽

| 指令 | 說明 |
|------|------|
| `npm run build` | 編譯 TypeScript 至 `dist` |
| `npm test` | 跑測試（需先 build） |
| `npm run seed:tracked-destinations` | 種子追蹤航線 |
| `npm run sync:tracked-destinations` | 與 CI 相同邏輯同步清單 |
| `npm run job:normal-fares` | 單次一般票價掃描 |
| `npm run job:business-deals` | 單次 RSS 商務 deal 流程 |
| `npm start` | 常駐主程式與排程 |

---

## 怎麼判斷卡死還在跑

- Log 前綴：**`[tracked-destinations-sync]`**、**`[normal-fares]`**、**`[serpapi]`**（含多 slice 時的 **`slice i/N`**）、**`[jobs]`**。
- **SerpApi 多 slice** 時會連續發多次 HTTP，**數分鐘沒新行**仍可能是正常；可看是否仍出現 **`slice x/y`** 或 **`serpapi done`**。
- Workflow 有 **timeout**（一般票價 30 分鐘），逾時會失敗而非無限停住。

---

## 給 AI／助理的說明文件

機讀向的結構化說明（路徑不變量、修改檢查清單）請見 **[`README.ai.md`](README.ai.md)**。

---

## 截圖與技術棧摘要

<img width="1426" height="633" alt="image" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" height="633" alt="image" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

- **執行環境**：Node.js（本機建議與 CI 一致 **22**；`package.json` 相容 20+）
- **資料庫**：Turso / libSQL  
- **票價來源**：SerpApi `google_flights`  
- **通知**：Discord Webhook  
- **商務 deal**：RSS + OpenAI 相容 API  

更細的英文專案背景可參考 git 歷史中的舊版 README 段落；維運與改設定以**本檔中文章節**為準。
