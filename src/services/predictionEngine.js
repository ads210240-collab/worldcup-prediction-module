import { clamp } from "./sourceUtils.js";

const weights = {
  tournamentPerformance: 35,
  tournamentAttack: 20,
  tournamentDefense: 15,
  rankingElo: 15,
  sentiment: 10,
  bettingOdds: 5,
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

function tournamentPerformanceRate(stats) {
  const sample = stats?.tournament?.played || stats?.recent?.sampleSize || 0;
  if (!sample) return null;
  const record = stats.tournament?.record || stats.recent?.record || { wins: 0, draws: 0, losses: 0 };
  return clamp((record.wins * 3 + record.draws) / (sample * 3), 0, 1);
}

function attackRate(stats) {
  const tournament = stats?.tournament || stats?.recent;
  if (!tournament?.played && !tournament?.sampleSize) return null;
  return clamp((tournament.goalsForPerGame ?? tournament.goalsFor / Math.max(tournament.sampleSize, 1)) / 2.5, 0.05, 0.95);
}

function defenseRate(stats) {
  const tournament = stats?.tournament || stats?.recent;
  if (!tournament?.played && !tournament?.sampleSize) return null;
  const against = tournament.goalsAgainstPerGame ?? tournament.goalsAgainst / Math.max(tournament.sampleSize, 1);
  return clamp(1 - against / 2.5, 0.05, 0.95);
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
  const homePerformance = tournamentPerformanceRate(homeStats);
  const awayPerformance = tournamentPerformanceRate(awayStats);
  const homeAttack = attackRate(homeStats);
  const awayAttack = attackRate(awayStats);
  const homeDefense = defenseRate(homeStats);
  const awayDefense = defenseRate(awayStats);
  const market = oddsProbability(odds);
  const elo = eloRate(homeStats?.ranking?.elo, awayStats?.ranking?.elo);
  const fifa = rankingRate(homeStats?.ranking?.rank, awayStats?.ranking?.rank);
  const rankingElo = elo == null && fifa == null ? null : clamp(((elo ?? 0.5) * 0.65 + (fifa ?? 0.5) * 0.35), 0.1, 0.9);
  const sentiment = sentimentScore(newsItems);

  return {
    tournamentPerformance:
      homePerformance == null || awayPerformance == null ? null : clamp(0.5 + (homePerformance - awayPerformance) * 0.7, 0.15, 0.85),
    tournamentAttack: homeAttack == null || awayDefense == null ? null : clamp(0.5 + (homeAttack - awayDefense) * 0.45, 0.15, 0.85),
    tournamentDefense: homeDefense == null || awayAttack == null ? null : clamp(0.5 + (homeDefense - awayAttack) * 0.45, 0.15, 0.85),
    rankingElo,
    bettingOdds: market?.home ?? null,
    marketDraw: market?.draw ?? null,
    marketAway: market?.away ?? null,
    sentiment,
    signature: `${fixture.id}-${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`,
  };
}

function buildScoreBreakdownV2(signals) {
  const parts = {
    tournamentPerformance: scoreSource(signals.tournamentPerformance, weights.tournamentPerformance),
    tournamentAttack: scoreSource(signals.tournamentAttack, weights.tournamentAttack),
    tournamentDefense: scoreSource(signals.tournamentDefense, weights.tournamentDefense),
    rankingElo: scoreSource(signals.rankingElo, weights.rankingElo),
    sentiment: scoreSource(signals.sentiment, weights.sentiment),
    bettingOdds: scoreSource(signals.bettingOdds, weights.bettingOdds),
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
    ["tournamentPerformance", weights.tournamentPerformance],
    ["tournamentAttack", weights.tournamentAttack],
    ["tournamentDefense", weights.tournamentDefense],
    ["rankingElo", weights.rankingElo],
    ["sentiment", weights.sentiment],
    ["bettingOdds", weights.bettingOdds],
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
  const homeTournament = homeStats.tournament || homeStats.recent;
  const awayTournament = awayStats.tournament || awayStats.recent;
  const homeFor = homeTournament.played ? homeTournament.goalsForPerGame : 1.1;
  const awayFor = awayTournament.played ? awayTournament.goalsForPerGame : 1.0;
  const homeAgainst = homeTournament.played ? homeTournament.goalsAgainstPerGame : 1.0;
  const awayAgainst = awayTournament.played ? awayTournament.goalsAgainstPerGame : 1.1;
  const seed = hashNumber(`${fixture.id}-${fixture.date}`);

  return {
    homeLambda: clamp(0.85 + homeFor * 0.45 + awayAgainst * 0.28 + (probability.home - probability.away) / 120 + (seed % 7) / 100, 0.35, 3.1),
    awayLambda: clamp(0.75 + awayFor * 0.44 + homeAgainst * 0.28 + (probability.away - probability.home) / 130 + ((seed >> 3) % 7) / 100, 0.25, 2.9),
  };
}

function buildPredictedScores(context) {
  const { fixture, homeStats, awayStats } = context;
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
      note: describeScoreScenario({ fixture, homeStats, awayStats, item, index }),
    }));
}

function describeScoreScenario({ fixture, homeStats, awayStats, item, index }) {
  const [homeGoals, awayGoals] = item.score.split("-").map(Number);
  const homeAttack = homeStats.tournament?.goalsForPerGame ?? 0;
  const awayAttack = awayStats.tournament?.goalsForPerGame ?? 0;
  const homeDefense = homeStats.tournament?.goalsAgainstPerGame ?? 0;
  const awayDefense = awayStats.tournament?.goalsAgainstPerGame ?? 0;
  const highTotal = homeGoals + awayGoals >= 3;

  if (homeGoals > awayGoals) {
    const edge = homeAttack >= awayDefense ? "本屆進攻效率能延續" : "把握定位球或轉換進攻";
    return index === 0
      ? `${fixture.homeTeam} 若${edge}，並把失球控制在 ${awayGoals} 球附近，這會是最順的主勝劇本。`
      : `${fixture.awayTeam} 防線若被迫前壓，${fixture.homeTeam} 有機會靠反擊或二波進攻拉開比分。`;
  }

  if (awayGoals > homeGoals) {
    const edge = awayAttack >= homeDefense ? "本屆攻擊狀態持續" : "前場效率提升";
    return index === 0
      ? `${fixture.awayTeam} 若${edge}，同時限制 ${fixture.homeTeam} 的禁區機會，客隊小勝機率最高。`
      : `${fixture.homeTeam} 若先失球後壓上，${fixture.awayTeam} 可能留下反擊空間。`;
  }

  if (homeGoals === 0 && awayGoals === 0) {
    return "雙方若節奏偏慢、前段時間都不冒進，低比分和局會成為主要情境。";
  }

  if (highTotal) {
    return `兩隊本屆進攻都有一定產量，若早早出現進球，${item.score} 這種開放局面會更容易發生。`;
  }

  return `${fixture.homeTeam} 與 ${fixture.awayTeam} 若互有壓制但臨門一腳保守，和局路徑仍存在。`;
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
      form: breakdown.scoreBreakdownV2.tournamentPerformance,
      attack: breakdown.scoreBreakdownV2.tournamentAttack,
      defense: breakdown.scoreBreakdownV2.tournamentDefense,
      odds: breakdown.scoreBreakdownV2.bettingOdds,
      squad: breakdown.scoreBreakdownV2.rankingElo,
      headToHead: 0,
      sentiment: breakdown.scoreBreakdownV2.sentiment,
    },
    scoreBreakdownNotes: {
      tournamentPerformance: `${fixture.homeTeam}: ${homeStats.tournament.formText}；${fixture.awayTeam}: ${awayStats.tournament.formText}`,
      tournamentAttack: `${fixture.homeTeam} 場均進球 ${homeStats.tournament.goalsForPerGame}；${fixture.awayTeam} 場均失球 ${awayStats.tournament.goalsAgainstPerGame}`,
      tournamentDefense: `${fixture.homeTeam} 場均失球 ${homeStats.tournament.goalsAgainstPerGame}；${fixture.awayTeam} 場均進球 ${awayStats.tournament.goalsForPerGame}`,
      rankingElo:
        homeStats.ranking.elo && awayStats.ranking.elo
          ? `Elo ${homeStats.ranking.elo} vs ${awayStats.ranking.elo}；FIFA #${homeStats.ranking.rank} vs #${awayStats.ranking.rank}`
          : "Elo / 世界排名缺資料，此權重降低信心。",
      sentiment: newsItems.length ? `納入最近 24 小時 ${newsItems.length} 則新聞。` : "新聞樣本不足，此權重降低信心。",
      bettingOdds: odds?.markets?.home ? "採用市場主勝/和局/客勝資料。" : "市場資料暫缺，此權重不補分，只降低信心。",
      form: `${fixture.homeTeam}: ${homeStats.tournament.formText}；${fixture.awayTeam}: ${awayStats.tournament.formText}`,
      attack: "依本屆場均進球與對手場均失球估算攻擊效率。",
      defense: "依本屆場均失球與對手場均進球估算防守穩定度。",
      odds: odds?.markets?.home ? "採用市場 h2h 資料。" : "市場資料暫缺。",
      squad: "V2 以 Elo / 世界排名輔助評估基礎實力。",
      headToHead: "V2 不用固定歷史對戰分；缺資料時權重不補。",
    },
    keyReasons: [
      `${fixture.homeTeam} 本屆表現：${homeStats.tournament.formText}`,
      `${fixture.awayTeam} 本屆表現：${awayStats.tournament.formText}`,
      odds?.markets?.home ? "市場資料已納入低權重評估。" : "市場資料暫缺，信心分已保守下修。",
      `Elo/FIFA：${fixture.homeTeam} ${homeStats.ranking.elo || "缺"} / #${homeStats.ranking.rank || "缺"}，${fixture.awayTeam} ${awayStats.ranking.elo || "缺"} / #${awayStats.ranking.rank || "缺"}`,
      hasEstimation ? "此分析部分資料使用估算。" : "主要來源完整度良好。",
    ],
    hasEstimation,
    estimatedSources: breakdown.estimatedSources,
    signals,
  };
}

export { weights };
