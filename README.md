# 世足分析預測

可部署的足球賽事分析平台。後端資料層已重構為獨立 services，會優先抓取免費/公開資料來源；只有當所有賽程來源都失敗或沒有資料時，才切換到 `mockWorldCupPredictions`。

## API

- `GET /api/worldcup/predictions`
- `GET /api/worldcup/news?matchId=...`

回傳格式維持前端合約，包含 `matches[].winProbability`、`recommendation`、`confidence`、`riskLevel`、`scoreBreakdown`、`summary`、`keyReasons`、`sources`。

## Data Layer 架構

```text
src/services/
  cacheService.js
  fixturesService.js
  teamStatsService.js
  newsService.js
  oddsService.js
  predictionEngine.js
```

### 1. fixturesService

用途：抓取今日、明日、已結束、即將開始比賽。

目前來源順序：

1. football-data.org
2. ESPN public scoreboard
3. openfootball / football.json style static JSON
4. mockWorldCupPredictions，只有全部失敗才用

快取：30 分鐘。

### 2. teamStatsService

用途：依 fixtures 計算最近戰績、主客場、進球、失球，並加入手動 FIFA Ranking / Elo seed。

快取：6 小時。

限制：免費來源若沒有完整歷史賽事，只能用已抓到的已結束比賽與 ranking seed 估算。

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

用途：即時計算：

- 勝率
- 三組預測比分
- AI 信心
- 風險評級
- AI 摘要

摘要根據：

- 最近戰績
- 攻防能力
- 世界排名 / Elo
- 最近 24 小時新聞
- 市場盤口

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

- fixturesService 會即時嘗試 football-data.org、ESPN public scoreboard、openfootball/static JSON。
- newsService 會即時嘗試 ESPN、BBC Sport、Goal.com、Yahoo Sports、Google News RSS。
- oddsService 在有 `THE_ODDS_API_KEY` 時會抓 The Odds API。

## 目前限制

- 2026 World Cup 賽程是否能抓到，取決於免費來源是否已開放該賽事資料。
- ESPN public scoreboard 是公開端點，未保證長期穩定。
- 免費資料通常不含完整傷停、xG、歷史對戰與完整新聞內文。
- 沒有 The Odds API key 時不會有盤口，只會顯示「目前沒有可用盤口資料」。

## 未來改成付費 API

只需替換或擴充：

- 賽程：`src/services/fixturesService.js`
- 球隊資料：`src/services/teamStatsService.js`
- 新聞：`src/services/newsService.js`
- 盤口：`src/services/oddsService.js`

`predictionEngine.js` 與前端合約不用重寫。
