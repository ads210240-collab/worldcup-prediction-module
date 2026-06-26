# 世足分析預測

一個 mock-first 的世足賽事分析預測模組，包含賽程、勝率、三組預測比分、評分拆解、風險提醒、即時新聞與賽前分析按鈕。

## 功能

- `GET /api/worldcup/predictions`
- `GET /api/worldcup/news?matchId=...`
- 世足預測 tabs：今日賽事、明日賽事、熱門對戰、高信心推薦、冷門風險提醒
- 每場賽事顯示台灣時間、預測比分、勝率條、綜合評分、推薦方向、摘要分析
- 展開更多可查看評分拆解與資料欄位
- 保留 Sportmonks、API-Football、Highlightly、Odds API 的 API Key 串接位置

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
FOOTBALL_DATA_PROVIDER=mock
SPORTMONKS_API_KEY=
API_FOOTBALL_KEY=
HIGHLIGHTLY_API_KEY=
ODDS_API_KEY=
```

目前預設使用 mock data。之後若要串接真實賽程，只需在 `src/data/worldcupPredictions.js` 補上 provider fetch 與 schema normalize。

## 部署

建議使用可執行 Node server 的平台，例如 Render、Railway 或 Fly.io。

Render 設定：

- Build Command: `npm install`
- Start Command: `npm start`

不建議直接用 GitHub Pages，因為此專案包含 API route。
