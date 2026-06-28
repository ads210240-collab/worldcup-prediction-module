# 世足分析預測

一個世足賽事分析預測模組，支援 API-Football 即時賽程更新，並包含勝率、三組預測比分、評分拆解、風險提醒、新聞與賽前分析按鈕。

## 功能

- `GET /api/worldcup/predictions`
- `GET /api/worldcup/news?matchId=...`
- 世足預測 tabs：今日賽事、明日賽事、熱門對戰、高信心推薦、冷門風險提醒
- 每場賽事顯示台灣時間、預測比分、勝率條、綜合評分、推薦方向、摘要分析
- 展開更多可查看評分拆解與資料欄位
- API-Football fixtures 即時賽程串接
- 保留 Sportmonks、Highlightly、Odds API 的 API Key 串接位置

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
FOOTBALL_DATA_PROVIDER=api-football
API_FOOTBALL_KEY=
API_FOOTBALL_LEAGUE_ID=1
API_FOOTBALL_SEASON=2026
SPORTMONKS_API_KEY=
HIGHLIGHTLY_API_KEY=
ODDS_API_KEY=
```

若 Render 有設定 `API_FOOTBALL_KEY`，系統會優先使用 API-Football fixtures 更新賽程，並以台灣時間查詢今天到明天的 2026 World Cup fixtures。資料會在 server 記憶體快取 9.5 小時；若 API 失敗或沒有資料，會 fallback 到內建 2026 mock fixtures。

目前即時比分不會顯示。新聞、賠率、傷停、xG 與完整專家情緒仍需額外資料源，例如 Highlightly、Sportmonks News、Odds API 或 API-Football 對應權限。

## 部署

建議使用可執行 Node server 的平台，例如 Render、Railway 或 Fly.io。

Render 設定：

- Build Command: `npm install`
- Start Command: `npm start`

不建議直接用 GitHub Pages，因為此專案包含 API route。
