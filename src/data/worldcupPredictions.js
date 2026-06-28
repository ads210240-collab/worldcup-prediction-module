import { getFixtures } from "../services/fixturesService.js";
import { getNews } from "../services/newsService.js";
import { getOdds } from "../services/oddsService.js";
import { buildPrediction, weights } from "../services/predictionEngine.js";
import { getTeamStats } from "../services/teamStatsService.js";
import { generateAiAnalysis } from "../services/aiAnalysisService.js";

let lastPredictionPayload = null;

function buildCategoryTags(fixture, prediction) {
  const tags = new Set(fixture.categoryTags || []);
  const topProbability = Math.max(prediction.winProbability.home, prediction.winProbability.draw, prediction.winProbability.away);
  if (fixture.importance >= 70 || topProbability >= 44) tags.add("hot");
  if (prediction.confidence === "高") tags.add("highConfidence");
  if (prediction.riskLevel === "高") tags.add("upsetRisk");
  if (!tags.size) tags.add("hot");
  return [...tags];
}

function buildMarketView(odds, homeStats, awayStats) {
  if (!odds?.markets?.home) {
    return `目前沒有可用盤口資料。排名/Elo：${homeStats.teamName} #${homeStats.ranking.rank} / Elo ${homeStats.ranking.elo}；${awayStats.teamName} #${awayStats.ranking.rank} / Elo ${awayStats.ranking.elo}。`;
  }

  return `The Odds API：主勝 ${odds.markets.home} / 和局 ${odds.markets.draw} / 客勝 ${odds.markets.away}，bookmaker: ${odds.bookmaker || "unknown"}。`;
}

function buildExpectedGoals(homeStats, awayStats) {
  const homeFor = homeStats.tournament.goalsFor || 0;
  const awayFor = awayStats.tournament.goalsFor || 0;
  const homeAgainst = homeStats.tournament.goalsAgainst || 0;
  const awayAgainst = awayStats.tournament.goalsAgainst || 0;
  const homeSample = Math.max(homeStats.tournament.played, 1);
  const awaySample = Math.max(awayStats.tournament.played, 1);

  return {
    homeXG: Number(Math.max(0.8, homeFor / homeSample || homeStats.ranking.elo / 1200).toFixed(2)),
    homeXGA: Number(Math.max(0.7, homeAgainst / homeSample || awayStats.ranking.elo / 1500).toFixed(2)),
    awayXG: Number(Math.max(0.8, awayFor / awaySample || awayStats.ranking.elo / 1200).toFixed(2)),
    awayXGA: Number(Math.max(0.7, awayAgainst / awaySample || homeStats.ranking.elo / 1500).toFixed(2)),
  };
}

function summarizeForCard(summary) {
  const text = String(summary || "").replace(/\s+/g, " ").trim();
  if (text.length <= 120) return text;
  return `${text.slice(0, 116)}...`;
}

async function buildMatchResponse(fixture, context) {
  const homeStats = context.stats.statsByTeam[fixture.homeTeam];
  const awayStats = context.stats.statsByTeam[fixture.awayTeam];
  const newsItems = context.news.newsByMatchId[fixture.id] || [];
  const odds = context.odds.oddsByMatchId[fixture.id] || null;
  const prediction = buildPrediction({ fixture, homeStats, awayStats, newsItems, odds });
  const aiAnalysis = await generateAiAnalysis({ fixture, homeStats, awayStats, newsItems, odds, prediction });
  const sources = [
    fixture.source,
    homeStats.source,
    awayStats.source,
    ...newsItems.map((item) => item.source),
    ...(odds ? [odds.source] : []),
  ].filter(Boolean);

  return {
    id: fixture.id,
    date: fixture.date,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    status: fixture.status,
    currentScore: fixture.score,
    predictedScore: prediction.predictedScore,
    scorePredictions: prediction.scorePredictions,
    winProbability: prediction.winProbability,
    overUnder: prediction.overUnder,
    btts: prediction.btts,
    asianHandicap: prediction.asianHandicap,
    recommendation: prediction.recommendation,
    confidence: prediction.confidence,
    confidenceScore: prediction.confidenceScore,
    riskLevel: prediction.riskLevel,
    riskScore: prediction.riskScore,
    totalScore: prediction.totalScore,
    scoreBreakdown: prediction.scoreBreakdown,
    scoreBreakdownV2: prediction.scoreBreakdownV2,
    scoreBreakdownNotes: prediction.scoreBreakdownNotes,
    categoryTags: buildCategoryTags(fixture, prediction),
    marketView: buildMarketView(odds, homeStats, awayStats),
    tournamentStats: {
      home: homeStats.tournament,
      away: awayStats.tournament,
    },
    recentForm: {
      home: homeStats.tournament.formText,
      away: awayStats.tournament.formText,
    },
    goals: {
      homeFor: homeStats.tournament.goalsFor,
      homeAgainst: homeStats.tournament.goalsAgainst,
      awayFor: awayStats.tournament.goalsFor,
      awayAgainst: awayStats.tournament.goalsAgainst,
    },
    expectedGoals: buildExpectedGoals(homeStats, awayStats),
    injuriesSuspensions: {
      home: homeStats.limitations.length ? homeStats.limitations.join("；") : "免費來源未回傳明確傷停",
      away: awayStats.limitations.length ? awayStats.limitations.join("；") : "免費來源未回傳明確傷停",
    },
    expertPrediction: newsItems[0]?.title || "最近 24 小時未取得足夠相關新聞，使用資料模型產生分析。",
    aiAnalysis: aiAnalysis.summary,
    analysisMode: aiAnalysis.analysisMode,
    summary: aiAnalysis.summary,
    shortSummary: summarizeForCard(aiAnalysis.summary),
    keyReasons: prediction.keyReasons,
    hasEstimation: prediction.hasEstimation,
    estimatedSources: prediction.estimatedSources,
    sources: [...new Set(sources.length ? sources : ["mockWorldCupPredictions"])],
  };
}

export async function getWorldCupPredictions() {
  const fixturesResult = await getFixtures();
  const fixtureSources = [...new Set(fixturesResult.sources || [])];
  const stats = await getTeamStats(fixturesResult.fixtures);
  const news = await getNews(fixturesResult.fixtures);
  const odds = await getOdds(fixturesResult.fixtures);
  const context = { stats, news, odds };
  const matches = await Promise.all(fixturesResult.fixtures.map((fixture) => buildMatchResponse(fixture, context)));
  const sourceHealth = {
    fixtures: fixturesResult.sourceStatuses.some((status) => status.ok) ? "updated" : "failed",
    news: news.sourceStatuses.some((status) => status.ok) ? "updated" : "failed",
    odds: odds.sourceStatuses.some((status) => status.ok) ? "updated" : "missing",
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceMode: fixturesResult.isFallback ? "fallback-mock" : "live-free",
    scheduleUpdateMode: fixturesResult.isFallback ? "mock" : "free-provider",
    dataLayer: {
      architecture: ["fixturesService", "teamStatsService", "newsService", "oddsService", "predictionEngine", "cacheService"],
      fixtureCache: fixturesResult.cache,
      teamStatsCache: stats.cache,
      newsCache: news.cache,
      oddsCache: odds.cache,
      sourceStatuses: {
        fixtures: fixturesResult.sourceStatuses,
        teamStats: stats.sourceStatuses,
        news: news.sourceStatuses,
        odds: odds.sourceStatuses,
        aiAnalysis: [
          {
            source: process.env.OPENAI_API_KEY ? "OpenAI Responses API" : "Rule-based AI analysis",
            ok: true,
            count: matches.length,
            httpStatus: null,
            responseTimeMs: null,
            cacheHit: false,
            cachedAt: null,
            expiresAt: null,
            lastUpdatedAt: new Date().toISOString(),
            error: null,
          },
        ],
      },
      debug: {
        message: matches.some((match) => match.hasEstimation) ? "此分析部分資料使用估算。" : "資料來源完整度良好。",
        sources: [
          ...fixturesResult.sourceStatuses,
          ...stats.sourceStatuses,
          ...news.sourceStatuses,
          ...odds.sourceStatuses,
        ],
      },
      sourceHealth,
      fallbackActive: fixturesResult.isFallback,
      fallbackMessage: fixturesResult.isFallback ? "目前資料來源暫時無法取得，即時資料已切換為模擬資料" : null,
      limitations: [
        "免費新聞來源以 RSS / Google News 搜尋為主，可能不含完整授權內文。",
        "免費模式不保證完整傷停、xG 與歷史對戰。",
        "盤口需要 The Odds API 免費 key；沒有 key 時只顯示目前沒有可用盤口資料。",
        "Prediction Engine V2 會在缺來源時降低 confidence，不用固定值補分。",
      ],
    },
    liveData: {
      enabled: !fixturesResult.isFallback,
      provider: fixtureSources.join(", ") || null,
      fetchedAt: fixturesResult.cache?.cachedAt || null,
      expiresAt: fixturesResult.cache?.expiresAt || null,
      maxCacheHours: 0.5,
      error: null,
      fallbackReason: fixturesResult.fallbackReason,
    },
    model: {
      total: 100,
      weights,
    },
    matches,
  };

  lastPredictionPayload = payload;
  return payload;
}

export async function getMatchNews(matchId) {
  const payload = lastPredictionPayload || (await getWorldCupPredictions());
  const match = payload.matches.find((item) => item.id === matchId);

  if (!match) {
    return {
      matchId,
      found: false,
      headline: "目前沒有這場賽事的新聞資料",
      newsItems: [],
      instantAnalysis: "請確認 matchId 是否存在。",
      sources: ["newsService"],
    };
  }

  const fixturesResult = await getFixtures();
  const news = await getNews(fixturesResult.fixtures);
  const items = news.newsByMatchId[matchId] || [];

  return {
    matchId,
    found: true,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    updatedAt: news.cache?.cachedAt || new Date().toISOString(),
    headline: items[0]?.title || `${match.homeTeam} vs ${match.awayTeam} 即時新聞整理`,
    newsItems: items.length ? items.map((item) => item.title).slice(0, 5) : ["最近 24 小時沒有抓到足夠相關新聞，暫以 AI 分析摘要補足。"],
    instantAnalysis: match.summary,
    sources: [...new Set(items.map((item) => item.source).concat(items.length ? [] : ["newsService:no_recent_news"]))],
  };
}
