import { clamp } from "./sourceUtils.js";

const weights = {
  recentFive: 30,
  bettingOdds: 20,
  worldElo: 20,
  fifaRanking: 10,
  sentiment: 10,
  homeAway: 10,
};

function hashNumber(input) {
  let hash = 2166136261;
  const text = String(input);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function formRate(stats) {
  const sample = stats?.recent?.sampleSize || 0;
  if (!sample) return null;
  const record = stats.recent.record || { wins: 0, draws: 0, losses: 0 };
  return clamp((record.wins * 3 + record.draws) / (sample * 3), 0, 1);
}

function homeAwayRate(stats, side) {
  const recent = stats?.recent;
  if (!recent?.sampleSize) return null;
  const sideMatches = side === "home" ? recent.homeMatches : recent.awayMatches;
  return clamp(0.45 + sideMatches / Math.max(recent.sampleSize, 1) * 0.2, 0.35, 0.75);
}

function sentimentScore(newsItems) {
  if (!newsItems?.length) return null;
  const text = newsItems.map((item) => `${item.title} ${item.description}`).join(" ").toLowerCase();
  const positiveWords = ["勝利", "回歸", "強", "優勢", "狀態", "fit", "strong", "confident", "boost", "return"];
  const negativeWords = ["傷勢", "停賽", "風險", "敗", "出賽成疑", "injury", "doubt", "suspended", "concern", "risk"];
  const positive = positiveWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const negative = negativeWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  return clamp(0.5 + (positive - negative) * 0.06, 0.2, 0.8);
}

function oddsProbability(odds) {
  if (!odds?.markets?.home || !odds?.markets?.draw || !odds?.markets?.away) return null;
  const raw = {
    home: 1 / odds.markets.home,
    draw: 1 / odds.markets.draw,
    away: 1 / odds.markets.away,
  };
  const total = raw.home + raw.draw + raw.away;
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total,
  };
}

function scoreSource(value, weight, direction = 1) {
  if (value == null || Number.isNaN(value)) {
    return { score: 0, usableWeight: 0, estimated: true };
  }
  return {
    score: clamp(value * direction, 0, 1) * weight,
    usableWeight: weight,
    estimated: false,
  };
}

function rankingRate(homeRank, awayRank) {
  if (!homeRank || !awayRank) return null;
  return clamp(0.5 + (awayRank - homeRank) / 120, 0.1, 0.9);
}

function eloRate(homeElo, awayElo) {
  if (!homeElo || !awayElo) return null;
  return 1 / (1 + 10 ** (-(homeElo - awayElo) / 400));
}

function buildSignals({ fixture, homeStats, awayStats, odds, newsItems }) {
  const homeForm = formRate(homeStats);
  const awayForm = formRate(awayStats);
  const market = oddsProbability(odds);
  const elo = eloRate(homeStats?.ranking?.elo, awayStats?.ranking?.elo);
  const fifa = rankingRate(homeStats?.ranking?.rank, awayStats?.ranking?.rank);
  const sentiment = sentimentScore(newsItems);
  const homeAway = (() => {
    const home = homeAwayRate(homeStats, "home");
    const away = homeAwayRate(awayStats, "away");
    if (home == null || away == null) return null;
    return clamp(0.5 + (home - away) * 0.55, 0.25, 0.75);
  })();

  return {
    recentFive: homeForm == null || awayForm == null ? null : clamp(0.5 + (homeForm - awayForm) * 0.7, 0.15, 0.85),
    bettingOdds: market?.home ?? null,
    marketDraw: market?.draw ?? null,
    marketAway: market?.away ?? null,
    worldElo: elo,
    fifaRanking: fifa,
    sentiment,
    homeAway,
    signature: `${fixture.id}-${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`,
  };
}

function buildScoreBreakdownV2(signals) {
  const parts = {
    recentFive: scoreSource(signals.recentFive, weights.recentFive),
    bettingOdds: scoreSource(signals.bettingOdds, weights.bettingOdds),
    worldElo: scoreSource(signals.worldElo, weights.worldElo),
    fifaRanking: scoreSource(signals.fifaRanking, weights.fifaRanking),
    sentiment: scoreSource(signals.sentiment, weights.sentiment),
    homeAway: scoreSource(signals.homeAway, weights.homeAway),
  };

  const usableWeight = Object.values(parts).reduce((sum, item) => sum + item.usableWeight, 0);
  const rawScore = Object.values(parts).reduce((sum, item) => sum + item.score, 0);
  const totalScore = usableWeight ? Math.round((rawScore / usableWeight) * 100) : 0;

  return {
    scoreBreakdownV2: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, Math.round(value.score)])),
    usableWeight,
    totalScore,
    estimatedSources: Object.entries(parts)
      .filter(([, value]) => value.estimated)
      .map(([key]) => key),
  };
}

function buildProbabilities(signals) {
  const sourceWeights = [
    ["recentFive", weights.recentFive],
    ["bettingOdds", weights.bettingOdds],
    ["worldElo", weights.worldElo],
    ["fifaRanking", weights.fifaRanking],
    ["sentiment", weights.sentiment],
    ["homeAway", weights.homeAway],
  ];

  let weightedHome = 0;
  let used = 0;
  for (const [key, weight] of sourceWeights) {
    if (signals[key] != null) {
      weightedHome += signals[key] * weight;
      used += weight;
    }
  }

  const homeBase = used ? weightedHome / used : 0.5;
  const variance = (hashNumber(signals.signature) % 13) / 1000;
  const home = clamp(homeBase + variance - 0.006, 0.12, 0.74);
  const drawBase = signals.marketDraw ?? clamp(0.29 - Math.abs(home - 0.5) * 0.2 + ((hashNumber(`${signals.signature}-draw`) % 9) - 4) / 1000, 0.18, 0.34);
  const awayRaw = clamp(1 - home - drawBase, 0.1, 0.72);
  const total = home + drawBase + awayRaw;

  return {
    home: Math.round((home / total) * 100),
    draw: Math.round((drawBase / total) * 100),
    away: 100 - Math.round((home / total) * 100) - Math.round((drawBase / total) * 100),
  };
}

function poisson(lambda, goals) {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return (Math.E ** -lambda * lambda ** goals) / factorial;
}

function buildGoalModel({ fixture, homeStats, awayStats, probability }) {
  const homeFor = homeStats.recent.sampleSize ? homeStats.recent.goalsFor / homeStats.recent.sampleSize : 1.1;
  const awayFor = awayStats.recent.sampleSize ? awayStats.recent.goalsFor / awayStats.recent.sampleSize : 1.0;
  const homeAgainst = homeStats.recent.sampleSize ? homeStats.recent.goalsAgainst / homeStats.recent.sampleSize : 1.0;
  const awayAgainst = awayStats.recent.sampleSize ? awayStats.recent.goalsAgainst / awayStats.recent.sampleSize : 1.1;
  const seed = hashNumber(`${fixture.id}-${fixture.date}`);

  return {
    homeLambda: clamp(0.85 + homeFor * 0.45 + awayAgainst * 0.28 + (probability.home - probability.away) / 120 + (seed % 7) / 100, 0.35, 3.1),
    awayLambda: clamp(0.75 + awayFor * 0.44 + homeAgainst * 0.28 + (probability.away - probability.home) / 130 + ((seed >> 3) % 7) / 100, 0.25, 2.9),
  };
}

function buildPredictedScores(context) {
  const { homeLambda, awayLambda } = buildGoalModel(context);
  const rows = [];

  for (let home = 0; home <= 5; home += 1) {
    for (let away = 0; away <= 5; away += 1) {
      rows.push({
        score: `${home}-${away}`,
        raw: poisson(homeLambda, home) * poisson(awayLambda, away),
      });
    }
  }

  const total = rows.reduce((sum, item) => sum + item.raw, 0);
  return rows
    .map((item) => ({ ...item, probability: Math.max(1, Math.round((item.raw / total) * 100)) }))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, 3)
    .map((item, index) => ({
      score: item.score,
      probability: item.probability,
      note: index === 0 ? "Poisson 進球模型最高機率比分。" : "依攻防、Elo、近況重新排序的替代比分。",
    }));
}

function buildMarketProps({ homeStats, awayStats, fixture, probability }) {
  const { homeLambda, awayLambda } = buildGoalModel({ fixture, homeStats, awayStats, probability });
  let over = 0;
  let btts = 0;

  for (let home = 0; home <= 6; home += 1) {
    for (let away = 0; away <= 6; away += 1) {
      const value = poisson(homeLambda, home) * poisson(awayLambda, away);
      if (home + away > 2.5) over += value;
      if (home > 0 && away > 0) btts += value;
    }
  }

  const under = 1 - over;
  const spread = probability.home - probability.away;
  const asianHandicap =
    Math.abs(spread) <= 8 ? "不建議深讓，保守觀望" : spread > 0 ? `${fixture.homeTeam} -0.25 / 不敗` : `${fixture.awayTeam} -0.25 / 不敗`;

  return {
    over25: Math.round(over * 100),
    under25: Math.round(under * 100),
    btts: Math.round(btts * 100),
    asianHandicap,
  };
}

function confidenceScore({ probability, usableWeight, estimatedSources, odds, newsItems }) {
  const top = Math.max(probability.home, probability.draw, probability.away);
  const sourcePenalty = (100 - usableWeight) * 0.45 + estimatedSources.length * 5;
  const marketBonus = odds?.markets?.home ? 8 : 0;
  const newsBonus = newsItems.length ? 4 : -5;
  return Math.round(clamp(top + usableWeight * 0.35 + marketBonus + newsBonus - sourcePenalty, 8, 92));
}

function confidenceLabel(score) {
  if (score >= 70) return "高";
  if (score >= 48) return "中";
  return "低";
}

function riskScore({ probability, estimatedSources, confidence }) {
  const gap = Math.abs(probability.home - probability.away);
  return Math.round(clamp(100 - gap * 1.4 + estimatedSources.length * 8 - confidence * 0.28, 8, 95));
}

function riskLabel(score) {
  if (score >= 68) return "高";
  if (score >= 42) return "中";
  return "低";
}

function recommendation({ fixture, probability, marketProps }) {
  const top = Math.max(probability.home, probability.draw, probability.away);
  if (top === probability.draw || Math.abs(probability.home - probability.away) <= 6) return `保守觀望 / ${marketProps.under25 >= marketProps.over25 ? "Under 2.5" : "BTTS"}`;
  return probability.home > probability.away ? `${fixture.homeTeam} 不敗 / ${marketProps.asianHandicap}` : `${fixture.awayTeam} 不敗 / ${marketProps.asianHandicap}`;
}

export function buildPrediction({ fixture, homeStats, awayStats, newsItems = [], odds = null }) {
  const signals = buildSignals({ fixture, homeStats, awayStats, odds, newsItems });
  const breakdown = buildScoreBreakdownV2(signals);
  const winProbability = buildProbabilities(signals);
  const scorePredictions = buildPredictedScores({ fixture, homeStats, awayStats, probability: winProbability });
  const marketProps = buildMarketProps({ fixture, homeStats, awayStats, probability: winProbability });
  const confidence = confidenceScore({ probability: winProbability, usableWeight: breakdown.usableWeight, estimatedSources: breakdown.estimatedSources, odds, newsItems });
  const risk = riskScore({ probability: winProbability, estimatedSources: breakdown.estimatedSources, confidence });
  const hasEstimation = breakdown.estimatedSources.length > 0 || homeStats.dataQuality?.estimated || awayStats.dataQuality?.estimated;

  return {
    predictedScore: scorePredictions[0].score,
    scorePredictions,
    winProbability,
    overUnder: {
      over25: marketProps.over25,
      under25: marketProps.under25,
    },
    btts: marketProps.btts,
    asianHandicap: marketProps.asianHandicap,
    recommendation: recommendation({ fixture, probability: winProbability, marketProps }),
    confidence: confidenceLabel(confidence),
    confidenceScore: confidence,
    riskLevel: riskLabel(risk),
    riskScore: risk,
    totalScore: breakdown.totalScore,
    scoreBreakdownV2: breakdown.scoreBreakdownV2,
    scoreBreakdown: {
      form: breakdown.scoreBreakdownV2.recentFive,
      attack: breakdown.scoreBreakdownV2.worldElo,
      defense: breakdown.scoreBreakdownV2.fifaRanking,
      odds: breakdown.scoreBreakdownV2.bettingOdds,
      squad: breakdown.scoreBreakdownV2.homeAway,
      headToHead: 0,
      sentiment: breakdown.scoreBreakdownV2.sentiment,
    },
    scoreBreakdownNotes: {
      recentFive: `${fixture.homeTeam}: ${homeStats.recent.formText}；${fixture.awayTeam}: ${awayStats.recent.formText}`,
      bettingOdds: odds?.markets?.home ? "採用 The Odds API 主勝/和局/客勝。" : "缺少盤口來源，此權重不以固定值補分。",
      worldElo: homeStats.ranking.elo && awayStats.ranking.elo ? `Elo ${homeStats.ranking.elo} vs ${awayStats.ranking.elo}` : "Elo 缺資料，此權重降低信心。",
      fifaRanking: homeStats.ranking.rank && awayStats.ranking.rank ? `FIFA #${homeStats.ranking.rank} vs #${awayStats.ranking.rank}` : "FIFA Ranking 缺資料，此權重降低信心。",
      sentiment: newsItems.length ? `納入最近 24 小時 ${newsItems.length} 則新聞。` : "新聞樣本不足，此權重降低信心。",
      homeAway: "依主客場樣本重新估算，不使用固定中性分。",
      form: `${fixture.homeTeam}: ${homeStats.recent.formText}；${fixture.awayTeam}: ${awayStats.recent.formText}`,
      attack: "V2 以 World Football Elo 對應攻防強度。",
      defense: "V2 以 FIFA Ranking 對應基礎穩定度。",
      odds: odds?.markets?.home ? "採用 The Odds API h2h 盤口。" : "目前沒有可用盤口資料。",
      squad: "V2 以主客場表現取代固定陣容分。",
      headToHead: "V2 不用固定歷史對戰分；缺資料時權重不補。",
    },
    keyReasons: [
      `${fixture.homeTeam} 近況：${homeStats.recent.formText}`,
      `${fixture.awayTeam} 近況：${awayStats.recent.formText}`,
      odds?.markets?.home ? `盤口：主勝 ${odds.markets.home} / 和 ${odds.markets.draw} / 客勝 ${odds.markets.away}` : "目前沒有可用盤口資料，信心分會下修。",
      `Elo/FIFA：${fixture.homeTeam} ${homeStats.ranking.elo || "缺"} / #${homeStats.ranking.rank || "缺"}，${fixture.awayTeam} ${awayStats.ranking.elo || "缺"} / #${awayStats.ranking.rank || "缺"}`,
      hasEstimation ? "此分析部分資料使用估算。" : "主要來源完整度良好。",
    ],
    hasEstimation,
    estimatedSources: breakdown.estimatedSources,
    signals,
  };
}

export { weights };
