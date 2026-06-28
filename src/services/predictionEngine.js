import { clamp } from "./sourceUtils.js";

const weights = {
  form: 25,
  attack: 20,
  defense: 15,
  odds: 15,
  squad: 10,
  headToHead: 5,
  sentiment: 10,
};

function rankingEdge(homeStats, awayStats) {
  const homeElo = homeStats?.ranking?.elo || 1700;
  const awayElo = awayStats?.ranking?.elo || 1700;
  return clamp((homeElo - awayElo) / 400, -1, 1);
}

function formScore(stats) {
  const record = stats?.recent?.record || { wins: 0, draws: 0, losses: 0 };
  const sample = stats?.recent?.sampleSize || 0;
  if (!sample) return 0.5;
  return clamp((record.wins * 3 + record.draws) / (sample * 3), 0, 1);
}

function impliedOddsProbability(odds) {
  if (!odds?.markets?.home || !odds?.markets?.draw || !odds?.markets?.away) return null;
  const raw = {
    home: 1 / odds.markets.home,
    draw: 1 / odds.markets.draw,
    away: 1 / odds.markets.away,
  };
  const total = raw.home + raw.draw + raw.away;
  return {
    home: Math.round((raw.home / total) * 100),
    draw: Math.round((raw.draw / total) * 100),
    away: Math.round((raw.away / total) * 100),
  };
}

function sentimentScore(newsItems) {
  if (!newsItems?.length) return 0.5;
  const text = newsItems.map((item) => `${item.title} ${item.description}`).join(" ").toLowerCase();
  const positiveWords = ["win", "boost", "return", "fit", "strong", "confident", "advantage", "form"];
  const negativeWords = ["injury", "doubt", "suspended", "risk", "concern", "loss", "out", "struggle"];
  const positive = positiveWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const negative = negativeWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  return clamp(0.5 + (positive - negative) * 0.08, 0.25, 0.75);
}

function buildScoreBreakdown({ homeStats, awayStats, odds, newsItems }) {
  const homeForm = formScore(homeStats);
  const awayForm = formScore(awayStats);
  const edge = rankingEdge(homeStats, awayStats);
  const sentiment = sentimentScore(newsItems);
  const hasOdds = Boolean(odds?.markets?.home);

  return {
    form: Math.round(clamp(0.55 + (homeForm - awayForm) * 0.5, 0.2, 1) * weights.form),
    attack: Math.round(clamp(0.55 + edge * 0.2, 0.25, 1) * weights.attack),
    defense: Math.round(clamp(0.55 + edge * 0.15, 0.25, 1) * weights.defense),
    odds: Math.round((hasOdds ? 0.72 : clamp(0.55 + Math.abs(edge) * 0.25, 0.35, 0.9)) * weights.odds),
    squad: Math.round(0.62 * weights.squad),
    headToHead: Math.round(0.5 * weights.headToHead),
    sentiment: Math.round(sentiment * weights.sentiment),
  };
}

function buildProbabilities({ homeStats, awayStats, odds, newsItems }) {
  const market = impliedOddsProbability(odds);
  if (market) return market;

  const edge = rankingEdge(homeStats, awayStats);
  const homeForm = formScore(homeStats);
  const awayForm = formScore(awayStats);
  const sentiment = sentimentScore(newsItems) - 0.5;
  const home = clamp(Math.round(37 + edge * 22 + (homeForm - awayForm) * 18 + sentiment * 12), 12, 72);
  const away = clamp(Math.round(33 - edge * 18 + (awayForm - homeForm) * 16 - sentiment * 8), 10, 68);
  const draw = clamp(100 - home - away, 18, 36);
  const adjustedAway = 100 - home - draw;
  return { home, draw, away: adjustedAway };
}

function buildPredictedScores(probability) {
  if (probability.draw >= probability.home && probability.draw >= probability.away) {
    return [
      { score: "1-1", probability: 31, note: "雙方勝率接近，模型優先保留和局情境。" },
      { score: "0-0", probability: 18, note: "若節奏偏慢，低比分拉鋸機率提高。" },
      { score: probability.home > probability.away ? "1-0" : "0-1", probability: 17, note: "一球差仍是主要風險情境。" },
    ];
  }

  const homeLean = probability.home > probability.away;
  return [
    { score: homeLean ? "2-1" : "1-2", probability: 32, note: "較高勝率方具備一球差取勝路徑。" },
    { score: homeLean ? "1-0" : "0-1", probability: 22, note: "若防守端表現穩定，低比分小勝成立。" },
    { score: "1-1", probability: 20, note: "新聞或陣容不確定時，和局仍需納入。" },
  ];
}

function confidence(probability, score, newsItems, odds) {
  const top = Math.max(probability.home, probability.draw, probability.away);
  if (top >= 58 && score >= 75 && (newsItems.length || odds)) return "高";
  if (top >= 44 && score >= 62) return "中";
  return "低";
}

function riskLevel(probability, hasMarket, newsItems) {
  const gap = Math.abs(probability.home - probability.away);
  if (gap <= 8 || (!hasMarket && !newsItems.length)) return "高";
  if (gap <= 18) return "中";
  return "低";
}

function buildSummary({ fixture, homeStats, awayStats, odds, newsItems, probability, predictedScore }) {
  const favorite =
    probability.home >= probability.away && probability.home >= probability.draw
      ? fixture.homeTeam
      : probability.away >= probability.home && probability.away >= probability.draw
        ? fixture.awayTeam
        : "雙方";
  const oddsText = odds?.markets?.home
    ? `盤口端目前可見主勝 ${odds.markets.home}、和局 ${odds.markets.draw}、客勝 ${odds.markets.away}，可作為市場共識參考。`
    : "目前沒有可用盤口資料，因此市場面不放大權重。";
  const newsText = newsItems.length
    ? `最近 24 小時新聞共納入 ${newsItems.length} 則，主要來源包含 ${[...new Set(newsItems.map((item) => item.source))].join("、")}。`
    : "最近 24 小時沒有抓到足夠相關新聞，新聞情緒採中性處理。";

  return `${fixture.homeTeam} vs ${fixture.awayTeam} 的分析以最新賽程、最近戰績、排名/Elo、新聞與盤口資料即時計算。${fixture.homeTeam} 近期狀態為 ${homeStats.recent.formText}；${fixture.awayTeam} 近期狀態為 ${awayStats.recent.formText}。排名/Elo 顯示 ${favorite} 在基礎實力面較有優勢，模型推估比分區間以 ${predictedScore} 與一球差為主。${oddsText}${newsText} 風險提醒是免費資料可能缺少完整傷停與 xG，因此若臨場名單或新聞出現變化，信心等級需要下修。`;
}

export function buildPrediction({ fixture, homeStats, awayStats, newsItems = [], odds = null }) {
  const scoreBreakdown = buildScoreBreakdown({ homeStats, awayStats, odds, newsItems });
  const totalScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const winProbability = buildProbabilities({ homeStats, awayStats, odds, newsItems });
  const scorePredictions = buildPredictedScores(winProbability);
  const predictedScore = scorePredictions[0].score;
  const hasMarket = Boolean(odds?.markets?.home);
  const confidenceLevel = confidence(winProbability, totalScore, newsItems, odds);
  const risk = riskLevel(winProbability, hasMarket, newsItems);
  const recommendation =
    winProbability.draw >= winProbability.home && winProbability.draw >= winProbability.away
      ? "和局 / 保守觀望"
      : winProbability.home > winProbability.away
        ? `${fixture.homeTeam} 不敗`
        : `${fixture.awayTeam} 不敗`;

  const summary = buildSummary({
    fixture,
    homeStats,
    awayStats,
    odds,
    newsItems,
    probability: winProbability,
    predictedScore,
  });

  return {
    predictedScore,
    scorePredictions,
    winProbability,
    recommendation,
    confidence: confidenceLevel,
    riskLevel: risk,
    totalScore,
    scoreBreakdown,
    scoreBreakdownNotes: {
      form: `${fixture.homeTeam}: ${homeStats.recent.formText}；${fixture.awayTeam}: ${awayStats.recent.formText}`,
      attack: "依最近進球、排名/Elo 與對手強度估算攻擊上限。",
      defense: "依最近失球、賽程狀態與排名/Elo 估算防守穩定度。",
      odds: hasMarket ? "採用 The Odds API h2h 盤口作為市場訊號。" : "目前沒有可用盤口資料，改用排名/Elo 作為市場替代訊號。",
      squad: "免費來源未穩定提供完整傷停，陣容完整度採保守中性值。",
      headToHead: "免費來源未穩定提供完整歷史對戰，權重維持低檔。",
      sentiment: newsItems.length ? "採最近 24 小時 RSS / Google News 新聞標題與摘要估算。" : "新聞不足，情緒維持中性。",
    },
    summary,
    keyReasons: [
      `${fixture.homeTeam} 近期：${homeStats.recent.formText}`,
      `${fixture.awayTeam} 近期：${awayStats.recent.formText}`,
      hasMarket ? "已納入 The Odds API 主勝/和局/客勝市場資訊。" : "目前沒有可用盤口資料。",
      newsItems.length ? `已納入最近 24 小時 ${newsItems.length} 則新聞訊號。` : "新聞樣本不足，需留意臨場資訊。",
    ],
  };
}

export { weights };
