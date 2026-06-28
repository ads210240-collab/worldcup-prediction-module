# 世足分析預測・Prediction Engine V2

可部署的足球賽事分析平台。V2 將資料來源、快取、新聞、盤口、Elo/FIFA、AI 分析與預測引擎拆成可替換 service。系統會優先抓取免費/公開資料來源；只有當所有賽程來源都失敗或沒有資料時，才切換到 `mockWorldCupPredictions`。

## API

- `GET /api/worldcup/predictions`
- `GET /api/worldcup/news?matchId=...`

回傳格式維持前端合約，包含 `matches[].winProbability`、`recommendation`、`confidence`、`riskLevel`、`scoreBreakdown`、`summary`、`keyReasons`、`sources`。V2 額外提供 `scoreBreakdownV2`、`overUnder`、`btts`、`asianHandicap`、`riskScore`、`confidenceScore`、`analysisMode` 與 Debug metadata。

## Data Layer 架構

```text
src/services/
  cacheService.js
  fixturesService.js
  teamStatsService.js
  newsService.js
  oddsService.js
  fifaRankingService.js
  worldEloService.js
  aiAnalysisService.js
  translationService.js
  predictionEngine.js
```

### 1. fixturesService

用途：抓取今日、明日、已結束、即將開始比賽。

目前來源順序：

1. ESPN Scoreboard
2. football-data.org
3. openfootball / football.json style static JSON
4. mockWorldCupPredictions，只有全部失敗才用

快取：30 分鐘。

### 2. teamStatsService

用途：依 fixtures 計算最近戰績、主客場、進球、失球，並合併 FIFA Ranking 與 World Football Elo。

快取：6 小時。

限制：免費來源若沒有完整歷史賽事，只能用已抓到的已結束比賽與 ranking/Elo seed 估算；估算會降低 confidence，且 UI 會顯示「此分析部分資料使用估算」。

### 3. newsService

用途：抓取最近 24 小時足球新聞。

目前來源：

- ESPN RSS
- BBC Sport RSS
- Goal.com RSS
- Yahoo Sports RSS
- Google News RSS

快取：30 分鐘。

限制：RSS 通常只提供標題與摘要，不保證完整文章內容。

### 4. oddsService

用途：抓取主勝、和局、客勝。

目前來源：

- The Odds API，使用免費額度，但需要 `THE_ODDS_API_KEY`

快取：15 分鐘。

若沒有 key 或沒有盤口資料，API 不會失敗，會回：

```text
目前沒有可用盤口資料
```

### 5. predictionEngine

Prediction Engine V2 權重：

- 近期五場：30%
- Betting Odds：20%
- World Football Elo：20%
- FIFA Ranking：10%
- 新聞情緒：10%
- 主客場：10%

缺少來源時不會用固定值補分，會降低 usable weight 與 confidence。

用途：即時計算：

- 勝率
- 三組預測比分
- Over 2.5 / Under 2.5
- BTTS
- Asian Handicap 建議
- AI 信心
- 風險評級
- AI 摘要與 `analysisMode`

比分使用 Poisson 進球模型，依每場近期戰績、Elo/FIFA、新聞、盤口與主客場重新排序，不使用固定比分模板。

### 6. aiAnalysisService

若有 `OPENAI_API_KEY`，使用 OpenAI Responses API 生成 150-300 字繁中分析，`analysisMode=llm`。

若沒有 key，使用 rule-based analysis engine，`analysisMode=rule-based`。

### 7. translationService

ESPN/football-data 回來的英文隊名會轉台灣繁中顯示；新聞標題與摘要會做隊名替換與基礎足球詞彙翻譯。

## 快取策略

- 賽程：30 分鐘
- 新聞：30 分鐘
- 盤口：15 分鐘
- 球隊資料：6 小時

## 環境變數

不設定任何 key 也能啟動，但資料源不足時會顯示 fallback 警示。

```text
FOOTBALL_DATA_PROVIDER=free
FOOTBALL_DATA_API_KEY=
FOOTBALL_SEASON=2026
OPENFOOTBALL_FIXTURES_URL=
ESPN_SOCCER_LEAGUE=fifa.world
THE_ODDS_API_KEY=
ODDS_SPORT_KEY=soccer_fifa_world_cup
WORLD_ELO_URL=https://www.eloratings.net
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

新聞 RSS 可選覆蓋：

```text
ESPN_SOCCER_RSS_URL=https://www.espn.com/espn/rss/soccer/news
BBC_SPORT_RSS_URL=https://feeds.bbci.co.uk/sport/football/rss.xml
GOAL_RSS_URL=https://www.goal.com/feeds/en/news
YAHOO_SPORTS_RSS_URL=https://sports.yahoo.com/soccer/rss.xml
GOOGLE_NEWS_RSS_URL=https://news.google.com/rss/search?q=football%20world%20cup%20when:1d&hl=en-US&gl=US&ceid=US:en
```

## 本機啟動

```bash
npm install
npm start
```

預設網址：

```text
http://127.0.0.1:5173
```

## Render 部署

- Build Command: `npm install`
- Start Command: `npm start`

Environment Variables 可先不填。若要盤口，加入：

```text
THE_ODDS_API_KEY=你的 The Odds API key
```

若 football-data.org 可用，加入：

```text
FOOTBALL_DATA_API_KEY=你的 football-data.org key
FOOTBALL_SEASON=2026
```

## 目前真正即時的資料

- fixturesService 會即時嘗試 ESPN public scoreboard、football-data.org、openfootball/static JSON。
- newsService 會即時嘗試 ESPN、BBC Sport、Goal.com、Yahoo Sports、Google News RSS。
- oddsService 在有 `THE_ODDS_API_KEY` 時會抓 The Odds API。
- aiAnalysisService 在有 `OPENAI_API_KEY` 時會用 LLM；沒有 key 時用 rule-based。

## 目前限制

- 2026 World Cup 賽程是否能抓到，取決於免費來源是否已開放該賽事資料。
- ESPN public scoreboard 是公開端點，未保證長期穩定。
- World Football Elo 免費頁面若 HTML 結構改變，可能解析不到，會退回 seed 並降低信心。
- 免費資料通常不含完整傷停、xG、歷史對戰與完整新聞內文。
- 沒有 The Odds API key 時不會有盤口，只會顯示「目前沒有可用盤口資料」。

## 未來改成付費 API

只需替換或擴充：

- 賽程：`src/services/fixturesService.js`
- 球隊資料：`src/services/teamStatsService.js`
- FIFA Ranking：`src/services/fifaRankingService.js`
- World Football Elo：`src/services/worldEloService.js`
- 新聞：`src/services/newsService.js`
- 盤口：`src/services/oddsService.js`
- AI 摘要：`src/services/aiAnalysisService.js`

`predictionEngine.js` 與前端合約不用重寫。
