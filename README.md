# 世足分析預測

免費可部署的世足賽事分析預測模組。網站會優先嘗試免費資料源，抓不到資料時自動使用 `mockWorldCupPredictions`，因此 Render 沒有設定任何足球 API Key 也能正常啟動。

## 功能

- `GET /api/worldcup/predictions`
- `GET /api/worldcup/news?matchId=...`
- 世足預測 tabs：今日賽事、明日賽事、熱門對戰、高信心推薦、冷門風險提醒
- 每場賽事顯示台灣時間、預測比分、三組比分機率、勝率條、推薦方向、信心等級、風險等級、AI 摘要分析
- 展開更多可查看評分拆解、資料欄位與資料來源標籤
- 免費來源優先：football-data.org、openfootball / football.json style static JSON
- fallback 來源：內建 `mockWorldCupPredictions`

## 評分模型

總分 100：

- 近期狀態 25%
- 攻擊火力 20%
- 防守穩定 15%
- 世界排名 / Elo 15%
- 陣容完整度 10%
- 歷史對戰 5%
- 新聞 / 網路情緒 10%

API 回傳格式仍保留原本的 `scoreBreakdown.odds` 欄位名稱，以維持前端合約相容；UI 會顯示為「世界排名 / Elo」。

若免費來源缺少真實戰績、傷停、xG 或新聞資料，系統會使用合理 fallback 值，並在 `sources` 或摘要中標註「部分資料為模擬估算」。

## 本機啟動

```bash
npm install
npm start
```

預設網址：

```text
http://127.0.0.1:5173
```

如果 5173 被占用，server 會自動嘗試下一個 port。

## 環境變數

可參考 `.env.example`：

```text
FOOTBALL_DATA_PROVIDER=free
FOOTBALL_DATA_API_KEY=
FOOTBALL_SEASON=2026
OPENFOOTBALL_FIXTURES_URL=
```

### 免費模式

不設定任何環境變數也能跑。預設 `FOOTBALL_DATA_PROVIDER=free`，server 會依序嘗試：

1. football-data.org World Cup matches
2. openfootball / football.json style static JSON
3. `mockWorldCupPredictions`

### football-data.org API Key

`FOOTBALL_DATA_API_KEY` 是可選欄位。若你有 football-data.org 免費 API Key，可以填入：

```text
FOOTBALL_DATA_PROVIDER=free
FOOTBALL_DATA_API_KEY=你的 football-data.org key
FOOTBALL_SEASON=2026
```

沒有 key、key 失效、免費方案沒有 World Cup 資料，或來源暫時無資料時，系統會自動 fallback 到 mock data，不會讓畫面空白。

### openfootball / football.json

若你有自己的靜態賽程 JSON，可以設定：

```text
OPENFOOTBALL_FIXTURES_URL=https://example.com/worldcup-2026.json
```

支援常見欄位如 `matches`、`rounds[].matches`、`homeTeam`、`awayTeam`、`date`、`utcDate`。

## Render 部署

Render 設定：

- Build Command: `npm install`
- Start Command: `npm start`

Environment Variables 可以完全不填，網站仍會正常顯示 fallback 賽程。

建議可填：

```text
FOOTBALL_DATA_PROVIDER=free
FOOTBALL_SEASON=2026
```

如果有 football-data.org 免費 key，再加：

```text
FOOTBALL_DATA_API_KEY=你的 football-data.org key
```

修改環境變數後，請在 Render 按 `Manual Deploy` → `Deploy latest commit`。

## 注意

目前不顯示即時比分。免費來源可能不含完整新聞、傷停、xG 或陣容資料，因此分析摘要會在資料不足時提示「部分資料為模擬估算」。這個模組適合做賽事研究頁面，不應被視為保證結果。
