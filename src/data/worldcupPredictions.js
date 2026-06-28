const SOURCE_MODE = process.env.FOOTBALL_DATA_PROVIDER || (process.env.API_FOOTBALL_KEY ? "api-football" : "mock");
const TAIWAN_TIME_ZONE = "Asia/Taipei";
const LIVE_CACHE_TTL_MS = 9.5 * 60 * 60 * 1000;
const API_FOOTBALL_BASE_URL = process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
const API_FOOTBALL_LEAGUE_ID = process.env.API_FOOTBALL_LEAGUE_ID || "1";
const API_FOOTBALL_SEASON = process.env.API_FOOTBALL_SEASON || "2026";

let liveScheduleCache = null;

const providerPlaceholders = {
  sportmonks: {
    enabled: Boolean(process.env.SPORTMONKS_API_KEY),
    envKey: "SPORTMONKS_API_KEY",
    note: "Reserved for fixtures, team stats, injuries, xG, standings and odds enrichment.",
  },
  apiFootball: {
    enabled: Boolean(process.env.API_FOOTBALL_KEY),
    envKey: "API_FOOTBALL_KEY",
    note: "Reserved for fixtures, odds, lineups, form, head-to-head and injuries.",
  },
  highlightly: {
    enabled: Boolean(process.env.HIGHLIGHTLY_API_KEY),
    envKey: "HIGHLIGHTLY_API_KEY",
    note: "Reserved for match previews, highlights and editorial signals.",
  },
  oddsApi: {
    enabled: Boolean(process.env.ODDS_API_KEY),
    envKey: "ODDS_API_KEY",
    note: "Reserved for bookmaker consensus, market movement and totals markets.",
  },
};

const scheduleIntegrationPlan = {
  supportsLiveScheduleRefresh: true,
  realtimeScoresEnabled: false,
  refreshTargets: ["fixtures", "kickoff_time", "venue", "team_pairing", "status_without_score"],
  recommendedProviders: ["Sportmonks", "API-Football", "Highlightly"],
  maxCacheHours: 9.5,
  note: "API-Football schedule refresh is implemented. The app updates fixtures without showing live scores, then falls back to mock data if no API key or provider data is available.",
};

const weights = {
  form: 25,
  attack: 20,
  defense: 15,
  odds: 15,
  squad: 10,
  headToHead: 5,
  sentiment: 10,
};

function calculateTotalScore(scoreBreakdown) {
  return Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
}

function buildMatch(match) {
  const totalScore = calculateTotalScore(match.scoreBreakdown);
  const scorePredictions = [...match.scorePredictions].sort((a, b) => b.probability - a.probability);
  return { ...match, scorePredictions, totalScore };
}

function formatTaipeiDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIWAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getTaipeiDateWindow() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: formatTaipeiDate(now),
    to: formatTaipeiDate(tomorrow),
  };
}

function normalizeProviderName(value) {
  return String(value || "").toLowerCase().replace(/[_\s]/g, "-");
}

function inferMatchTags(dateValue, index, probability, riskLevel) {
  const today = formatTaipeiDate(new Date());
  const tomorrow = formatTaipeiDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const matchDate = formatTaipeiDate(new Date(dateValue));
  const tags = [];

  if (matchDate === today) tags.push("today");
  if (matchDate === tomorrow) tags.push("tomorrow");
  if (index < 6 || probability >= 42) tags.push("hot");
  if (probability >= 54) tags.push("highConfidence");
  if (riskLevel === "高" || probability <= 38) tags.push("upsetRisk");

  return tags.length ? tags : ["hot"];
}

function buildLivePlaceholderMatch(fixture, index) {
  const fixtureInfo = fixture.fixture || {};
  const teams = fixture.teams || {};
  const homeTeam = teams.home?.name || "主隊未定";
  const awayTeam = teams.away?.name || "客隊未定";
  const date = fixtureInfo.date || new Date().toISOString();
  const status = fixtureInfo.status?.long || fixtureInfo.status?.short || "Scheduled";
  const homeLean = index % 3 === 0;
  const drawLean = index % 3 === 1;
  const homeProbability = homeLean ? 43 : drawLean ? 34 : 31;
  const drawProbability = drawLean ? 33 : 28;
  const awayProbability = 100 - homeProbability - drawProbability;
  const favorite = homeProbability >= awayProbability ? homeTeam : awayTeam;
  const riskLevel = Math.abs(homeProbability - awayProbability) <= 8 ? "高" : "中";
  const predictedScore = drawLean ? "1-1" : homeLean ? "2-1" : "1-2";

  return buildMatch({
    id: `api-football-${fixtureInfo.id || index}`,
    date,
    homeTeam,
    awayTeam,
    predictedScore,
    scorePredictions: [
      { score: predictedScore, probability: drawLean ? 30 : 32, note: "由即時賽程先產生的基礎預測，完整模型需串接賠率、傷停與新聞。" },
      { score: "1-1", probability: drawLean ? 27 : 22, note: "資料不足時，和局保留為風險情境。" },
      { score: homeLean ? "1-0" : "0-1", probability: 18, note: "若比賽節奏偏慢，低比分可能性上升。" },
    ],
    categoryTags: inferMatchTags(date, index, Math.max(homeProbability, awayProbability), riskLevel),
    marketView: "已串接即時賽程；賠率市場信心需另外接 Odds API 或 API-Football odds 權限。",
    recentForm: {
      home: "即時賽程已更新；近期戰績需接 team statistics endpoint 後補強。",
      away: "即時賽程已更新；近期戰績需接 team statistics endpoint 後補強。",
    },
    goals: { homeFor: 0, homeAgainst: 0, awayFor: 0, awayAgainst: 0 },
    expectedGoals: { homeXG: 0, homeXGA: 0, awayXG: 0, awayXGA: 0 },
    injuriesSuspensions: {
      home: "尚未串接傷停 API，請以賽前名單更新為準。",
      away: "尚未串接傷停 API，請以賽前名單更新為準。",
    },
    expertPrediction: "目前使用即時賽程建立基礎分析；新聞/專家預測需接 Highlightly、Sportmonks News 或其他新聞 API。",
    aiAnalysis: `${homeTeam} vs ${awayTeam} 已由 API-Football 即時賽程同步，狀態為 ${status}。目前不顯示即時比分；分析分數為資料不足時的保守模型。`,
    winProbability: { home: homeProbability, draw: drawProbability, away: awayProbability },
    recommendation: drawLean ? "保守觀望 / 和局風險" : `${favorite} 不敗`,
    confidence: Math.max(homeProbability, awayProbability) >= 54 ? "高" : "中",
    riskLevel,
    scoreBreakdown: {
      form: 15,
      attack: 12,
      defense: 11,
      odds: 6,
      squad: 6,
      headToHead: 2,
      sentiment: 5,
    },
    scoreBreakdownNotes: {
      form: "目前只接賽程，近期狀態需等 team statistics provider 補齊。",
      attack: "尚未接進球/xG endpoint，先用保守分數。",
      defense: "尚未接失球/xGA endpoint，先用保守分數。",
      odds: "尚未接 odds endpoint，市場信心不放大。",
      squad: "尚未接傷停/停賽資料，陣容分保守。",
      headToHead: "尚未接歷史對戰 endpoint。",
      sentiment: "尚未接 10 小時內新聞情緒。",
    },
    summary:
      `${homeTeam} vs ${awayTeam} 的賽程已由 API-Football 即時同步，開賽時間以台灣時間顯示。這版已解決手動更新賽程的問題，但目前只保證賽程來源是 API 更新，不包含即時比分。勝率、比分與分析仍是基礎保守模型，等後續接上賠率、傷停、新聞與 xG 後，才能達到完整的 10 小時內即時分析標準。`,
    keyReasons: [
      "賽程由 API-Football 即時 fixtures endpoint 回傳。",
      "不顯示即時比分，避免偏離你的需求。",
      "目前分析仍是保守模型，需補新聞/賠率/傷停 API 才能完整自動化。",
      "若 API 失敗，系統會 fallback 到 2026 賽程 mock。",
    ],
    sources: ["live:api-football-fixtures", `live:status:${status}`, "fallback:analysis-model"],
  });
}

async function fetchApiFootballFixtures() {
  if (!process.env.API_FOOTBALL_KEY) return null;

  const { from, to } = getTaipeiDateWindow();
  const url = new URL("/fixtures", API_FOOTBALL_BASE_URL);
  url.searchParams.set("league", API_FOOTBALL_LEAGUE_ID);
  url.searchParams.set("season", API_FOOTBALL_SEASON);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("timezone", TAIWAN_TIME_ZONE);

  const response = await fetch(url, {
    headers: {
      "x-apisports-key": process.env.API_FOOTBALL_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API-Football fixtures failed: ${response.status}`);
  }

  const payload = await response.json();
  const fixtures = Array.isArray(payload.response) ? payload.response : [];
  if (!fixtures.length) return null;

  const matches = fixtures
    .sort((a, b) => new Date(a.fixture?.date || 0) - new Date(b.fixture?.date || 0))
    .map((fixture, index) => buildLivePlaceholderMatch(fixture, index));

  return {
    provider: "api-football",
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LIVE_CACHE_TTL_MS).toISOString(),
    query: {
      league: API_FOOTBALL_LEAGUE_ID,
      season: API_FOOTBALL_SEASON,
      from,
      to,
      timezone: TAIWAN_TIME_ZONE,
    },
    matches,
  };
}

const mockMatches = [
  buildMatch({
    id: "wc-2026-arg-fra",
    date: "2026-06-27T00:00:00+08:00",
    homeTeam: "阿根廷",
    awayTeam: "法國",
    predictedScore: "2-1",
    scorePredictions: [
      { score: "2-1", probability: 34, note: "阿根廷控球與二次進攻較穩，法國仍有反擊進球機會。" },
      { score: "1-1", probability: 24, note: "強強對話若節奏放慢，和局機率會上升。" },
      { score: "1-0", probability: 18, note: "若阿根廷先進球後降低風險，比分可能被壓低。" },
    ],
    categoryTags: ["today", "hot", "highConfidence"],
    marketView: "主勝 2.36 / 和局 3.24 / 客勝 2.88，市場略偏阿根廷但尚未過熱。",
    recentForm: {
      home: "近 5 場 4 勝 1 和，壓迫效率穩定",
      away: "近 5 場 3 勝 1 和 1 敗，反擊品質仍高",
    },
    goals: {
      homeFor: 10,
      homeAgainst: 4,
      awayFor: 9,
      awayAgainst: 6,
    },
    expectedGoals: {
      homeXG: 1.84,
      homeXGA: 0.92,
      awayXG: 1.72,
      awayXGA: 1.18,
    },
    injuriesSuspensions: {
      home: "主力後腰輕傷但可替補待命",
      away: "一名邊後衛停賽，右路防守深度下降",
    },
    expertPrediction: "多數預測看好阿根廷小勝，建議避開過深讓分。",
    aiAnalysis: "阿根廷在中場控球與二次進攻的穩定度略優，法國仍有速度優勢但防線完整度較低。",
    winProbability: {
      home: 46,
      draw: 27,
      away: 27,
    },
    recommendation: "主勝 / 小讓分",
    confidence: "高",
    riskLevel: "中",
    scoreBreakdown: {
      form: 22,
      attack: 17,
      defense: 12,
      odds: 11,
      squad: 8,
      headToHead: 3,
      sentiment: 8,
    },
    scoreBreakdownNotes: {
      form: "阿根廷近 5 場 4 勝 1 和，狀態連續性優於法國。",
      attack: "兩隊都有高品質進攻，但阿根廷禁區前組織更穩。",
      defense: "阿根廷防守回收較完整，法國右路停賽拉低穩定度。",
      odds: "主勝賠率略降，市場偏支持主隊但尚未過熱。",
      squad: "阿根廷僅有輕傷疑慮，法國邊後衛停賽影響輪換。",
      headToHead: "歷史對戰差距有限，因此只給中性偏低分。",
      sentiment: "專家與網路預測多數偏阿根廷小勝。",
    },
    summary:
      "本場屬於強強對話，但阿根廷的近期狀態、控球節奏與防守回收品質更一致。法國前場速度仍是最大威脅，若阿根廷邊路壓上後留出空間，客隊有能力用一次轉換改變比賽。不過從 xG、xGA 與傷停結構來看，阿根廷在中場保護與禁區前沿限制射門方面較穩。市場賠率已反映主隊優勢，但主勝價格尚未到過熱區間，較適合以主勝或小讓分作為方向，避免追高大比分。",
    keyReasons: [
      "阿根廷近 5 場不敗，進攻端能持續製造高品質射門。",
      "法國右路防守深度受停賽影響，面對換位攻擊有風險。",
      "主勝賠率略降但未明顯過熱，市場信心偏正向。",
      "若臨場讓分升太深，保守投資人可改看主勝不敗或觀望。",
    ],
    sources: ["mock:sportmonks-fixtures", "mock:odds-consensus", "mock:expert-sentiment"],
  }),
  buildMatch({
    id: "wc-2026-bra-eng",
    date: "2026-06-27T03:00:00+08:00",
    homeTeam: "巴西",
    awayTeam: "英格蘭",
    predictedScore: "1-1",
    scorePredictions: [
      { score: "1-1", probability: 31, note: "雙方模型接近，低比分拉鋸最符合目前資料。" },
      { score: "1-2", probability: 20, note: "若英格蘭定位球或反擊奏效，客隊有小勝空間。" },
      { score: "2-1", probability: 19, note: "巴西邊路爆點恢復良好時，仍可拉出主勝路徑。" },
    ],
    categoryTags: ["today", "hot", "upsetRisk"],
    marketView: "主勝 2.52 / 和局 3.05 / 客勝 2.74，市場分歧明顯。",
    recentForm: {
      home: "近 5 場 2 勝 2 和 1 敗，終結效率起伏",
      away: "近 5 場 3 勝 2 和，防守紀律佳",
    },
    goals: {
      homeFor: 8,
      homeAgainst: 5,
      awayFor: 7,
      awayAgainst: 3,
    },
    expectedGoals: {
      homeXG: 1.55,
      homeXGA: 1.08,
      awayXG: 1.38,
      awayXGA: 0.86,
    },
    injuriesSuspensions: {
      home: "主力邊鋒剛復出，預估出場時間受控",
      away: "中衛組合完整，替補後腰有傷",
    },
    expertPrediction: "專家意見偏向低比分拉鋸，和局與小球支持度較高。",
    aiAnalysis: "巴西個人突破更具爆點，但英格蘭低位防守與定位球質量足以抵銷部分劣勢。",
    winProbability: {
      home: 35,
      draw: 33,
      away: 32,
    },
    recommendation: "和局 / 小球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: {
      form: 17,
      attack: 15,
      defense: 12,
      odds: 8,
      squad: 7,
      headToHead: 2,
      sentiment: 7,
    },
    scoreBreakdownNotes: {
      form: "巴西近期終結效率起伏，英格蘭不敗走勢較穩。",
      attack: "巴西單點突破更強，但英格蘭定位球效率可抵銷差距。",
      defense: "英格蘭防線紀律佳，巴西轉換防守仍有空檔。",
      odds: "勝負賠率接近，市場沒有清楚單邊訊號。",
      squad: "巴西邊鋒剛復出，英格蘭中後場較完整。",
      headToHead: "對戰參考價值有限，模型不把此項放大。",
      sentiment: "專家偏向低比分和局或小球，情緒支持不算強烈。",
    },
    summary:
      "巴西與英格蘭的差距不大，這使本場更像風險控管題，而不是單邊方向題。巴西有更高的單點突破上限，若邊鋒狀態恢復良好，能在英格蘭防線肋部創造空檔；但目前主力邊鋒剛復出，出場時間與連續衝刺品質都存在不確定。英格蘭近期失球控制較佳，定位球與反擊也具備偷分能力。賠率端沒有清楚一面倒訊號，代表市場對勝負分歧大，建議以和局、小球或保守觀望為主。",
    keyReasons: [
      "兩隊勝率模型接近，單押勝負的性價比有限。",
      "英格蘭防守穩定，但進攻創造力未必能壓制巴西。",
      "市場賠率分歧，沒有明確資金方向。",
      "適合小球或觀望，不適合追高熱門敘事。",
    ],
    sources: ["mock:api-football-form", "mock:odds-consensus", "mock:sentiment-scan"],
  }),
  buildMatch({
    id: "wc-2026-esp-usa",
    date: "2026-06-28T00:00:00+08:00",
    homeTeam: "西班牙",
    awayTeam: "美國",
    predictedScore: "2-0",
    scorePredictions: [
      { score: "2-0", probability: 38, note: "西班牙控球壓制與美國中場停賽，使零封路徑較清楚。" },
      { score: "2-1", probability: 22, note: "若美國反擊速度打穿邊路，仍有一球機會。" },
      { score: "1-0", probability: 17, note: "美國低位收縮成功時，西班牙可能小勝收場。" },
    ],
    categoryTags: ["tomorrow", "highConfidence"],
    marketView: "主勝 1.72 / 和局 3.58 / 客勝 4.80，市場明顯支持西班牙。",
    recentForm: {
      home: "近 5 場 4 勝 1 敗，控球壓制力佳",
      away: "近 5 場 2 勝 1 和 2 敗，面對高壓逼搶失誤偏多",
    },
    goals: {
      homeFor: 11,
      homeAgainst: 4,
      awayFor: 6,
      awayAgainst: 7,
    },
    expectedGoals: {
      homeXG: 1.96,
      homeXGA: 0.82,
      awayXG: 1.05,
      awayXGA: 1.42,
    },
    injuriesSuspensions: {
      home: "主力陣容完整，僅替補前鋒有傷",
      away: "主力中場累積黃牌停賽",
    },
    expertPrediction: "預測普遍看好西班牙掌控節奏，主勝支持度高。",
    aiAnalysis: "西班牙控球與前場壓迫能限制美國轉換速度，美國停賽也削弱出球穩定。",
    winProbability: {
      home: 58,
      draw: 24,
      away: 18,
    },
    recommendation: "主勝 / 西班牙 -0.75",
    confidence: "高",
    riskLevel: "低",
    scoreBreakdown: {
      form: 23,
      attack: 18,
      defense: 13,
      odds: 12,
      squad: 9,
      headToHead: 3,
      sentiment: 9,
    },
    scoreBreakdownNotes: {
      form: "西班牙近 5 場 4 勝，控球與壓迫表現穩定。",
      attack: "xG 接近 2.0，代表持續創造高品質機會。",
      defense: "xGA 低於 1，美國反擊會被壓縮到較少回合。",
      odds: "主勝低賠但符合實力差距，市場信心明確。",
      squad: "西班牙主力完整，美國主力中場停賽。",
      headToHead: "歷史樣本不多，僅作輔助參考。",
      sentiment: "專家預測與模型方向一致，主勝支持度高。",
    },
    summary:
      "西班牙是本輪相對清楚的高信心方向。球隊近期在控球、前場壓迫與失球控制上都優於美國，xG 接近 2.0 且 xGA 低於 1，代表攻守兩端都有穩定輸出。美國的反擊速度不能忽視，但主力中場停賽會削弱第一時間出球與抗壓能力，面對西班牙連續逼搶時容易被迫長傳。賠率雖然已偏向主隊，但仍符合實力差距，未達極端低賠。整體看好西班牙主勝，較積極者可評估小讓分。",
    keyReasons: [
      "西班牙控球壓制與前場逼搶能降低美國反擊頻率。",
      "美國主力中場停賽，出球穩定性下滑。",
      "主勝賠率低但合理，市場信心與模型方向一致。",
      "若賠率臨場跌破合理區間，建議降低投注比例。",
    ],
    sources: ["mock:sportmonks-team-stats", "mock:injury-feed", "mock:expert-consensus"],
  }),
  buildMatch({
    id: "wc-2026-ger-jpn",
    date: "2026-06-28T03:00:00+08:00",
    homeTeam: "德國",
    awayTeam: "日本",
    predictedScore: "2-2",
    scorePredictions: [
      { score: "2-2", probability: 27, note: "德國火力高但防線不穩，日本轉換可創造進球。" },
      { score: "2-1", probability: 24, note: "德國若能壓住失誤，主場熱門仍有小勝可能。" },
      { score: "1-2", probability: 18, note: "德國中衛傷疑若成真，日本爆冷路徑會升高。" },
    ],
    categoryTags: ["tomorrow", "upsetRisk"],
    marketView: "主勝 1.95 / 和局 3.42 / 客勝 3.68，主隊受熱但風險升高。",
    recentForm: {
      home: "近 5 場 3 勝 1 和 1 敗，進攻強但回防不穩",
      away: "近 5 場 3 勝 2 和，轉換速度與紀律佳",
    },
    goals: {
      homeFor: 12,
      homeAgainst: 8,
      awayFor: 10,
      awayAgainst: 5,
    },
    expectedGoals: {
      homeXG: 1.88,
      homeXGA: 1.35,
      awayXG: 1.44,
      awayXGA: 0.98,
    },
    injuriesSuspensions: {
      home: "一名主力中衛出戰成疑",
      away: "主力陣容大致完整",
    },
    expertPrediction: "部分預測提醒德國防線空間過大，日本有爆冷能力。",
    aiAnalysis: "德國進攻總量較高，但日本的反擊與邊路套上能放大德國中衛傷疑風險。",
    winProbability: {
      home: 42,
      draw: 29,
      away: 29,
    },
    recommendation: "雙方進球 / 大球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: {
      form: 19,
      attack: 18,
      defense: 8,
      odds: 9,
      squad: 7,
      headToHead: 2,
      sentiment: 8,
    },
    scoreBreakdownNotes: {
      form: "德國進攻狀態好，日本近況也穩，差距不明顯。",
      attack: "德國 xG 與進球數高，是主要優勢來源。",
      defense: "中衛傷疑加上回防空間大，防守分明顯偏低。",
      odds: "主勝受熱，但模型沒有給到足夠單邊支撐。",
      squad: "日本陣容完整度較好，德國後防健康度有疑慮。",
      headToHead: "過往對戰不足以支撐重倉主勝。",
      sentiment: "網路與專家風向提醒德國有爆冷風險。",
    },
    summary:
      "德國具備更高的進攻上限，近期進球數與 xG 都維持在高水準，但防守端的穩定性是主要疑慮。若主力中衛無法先發，德國在防線身後與定位球第二點的保護會更脆弱。日本狀態穩定，轉換速度快，且面對強隊時通常能維持紀律與跑動密度。市場仍偏熱德國主勝，但模型沒有給出足夠的單邊優勢。與其追主勝，不如看雙方進球或大球，並把本場列為冷門風險場。",
    keyReasons: [
      "德國攻擊火力強，但防守穩定分偏低。",
      "日本陣容完整且轉換效率高，具備爆冷條件。",
      "主勝受市場追捧，賠率可能已反映過多主隊敘事。",
      "更適合雙方進球或大球，不適合重倉主勝。",
    ],
    sources: ["mock:api-football-h2h", "mock:odds-movement", "mock:expert-risk-note"],
  }),
  buildMatch({
    id: "wc-2026-por-mar",
    date: "2026-06-28T06:00:00+08:00",
    homeTeam: "葡萄牙",
    awayTeam: "摩洛哥",
    predictedScore: "1-0",
    scorePredictions: [
      { score: "1-0", probability: 33, note: "葡萄牙優勢明確，但摩洛哥低位防守會壓低比分。" },
      { score: "2-0", probability: 23, note: "若葡萄牙早早破門，摩洛哥後段反撲空間會被放大。" },
      { score: "1-1", probability: 19, note: "摩洛哥定位球或反擊得手時，和局風險仍存在。" },
    ],
    categoryTags: ["hot", "highConfidence"],
    marketView: "主勝 1.86 / 和局 3.18 / 客勝 4.20，市場支持葡萄牙但總進球預期偏低。",
    recentForm: {
      home: "近 5 場 4 勝 1 敗，邊路創造力強",
      away: "近 5 場 2 勝 2 和 1 敗，低位防守韌性高",
    },
    goals: {
      homeFor: 9,
      homeAgainst: 3,
      awayFor: 5,
      awayAgainst: 4,
    },
    expectedGoals: {
      homeXG: 1.62,
      homeXGA: 0.76,
      awayXG: 0.92,
      awayXGA: 1.04,
    },
    injuriesSuspensions: {
      home: "主力邊後衛可回歸",
      away: "前場替補衝擊點受傷缺陣",
    },
    expertPrediction: "主流看法偏葡萄牙小勝，摩洛哥防守會壓低比賽節奏。",
    aiAnalysis: "葡萄牙防守完整度與控球耐心較佳，但摩洛哥低位防守會讓比分不易拉開。",
    winProbability: {
      home: 51,
      draw: 30,
      away: 19,
    },
    recommendation: "主勝 / 小球",
    confidence: "高",
    riskLevel: "中",
    scoreBreakdown: {
      form: 21,
      attack: 16,
      defense: 14,
      odds: 11,
      squad: 9,
      headToHead: 2,
      sentiment: 8,
    },
    scoreBreakdownNotes: {
      form: "葡萄牙近況較佳，摩洛哥防守韌性仍需尊重。",
      attack: "葡萄牙邊路創造力強，但摩洛哥會壓縮禁區空間。",
      defense: "葡萄牙失球控制好，防守穩定分接近滿分。",
      odds: "市場支持主勝，但總進球預期偏低。",
      squad: "葡萄牙主力邊後衛回歸，摩洛哥前場替補受傷。",
      headToHead: "歷史對戰參考權重低，避免過度解讀。",
      sentiment: "主流預測偏葡萄牙小勝，與模型方向一致。",
    },
    summary:
      "葡萄牙在攻守平衡上更佔優勢，尤其主力邊後衛回歸後，邊路推進與回防保護都更完整。摩洛哥的低位防守仍然有韌性，能迫使比賽進入慢節奏，也會壓低葡萄牙的射門空間，因此不宜期待大比分。從模型來看，葡萄牙防守穩定與陣容完整度給分高，摩洛哥前場替補衝擊點缺陣則降低後段反撲能力。市場支持主勝但沒有明顯過熱，較適合主勝搭配小球方向。",
    keyReasons: [
      "葡萄牙陣容回歸提升邊路攻防完整度。",
      "摩洛哥防守韌性強，但進攻替補深度受傷病影響。",
      "總進球預期偏低，主勝小球邏輯一致。",
      "若葡萄牙臨場輪換過多，信心應降至中等。",
    ],
    sources: ["mock:highlightly-preview", "mock:squad-availability", "mock:odds-consensus"],
  }),
];

const mockNewsByMatchId = {
  "wc-2026-arg-fra": {
    updatedAt: "2026-06-26T20:10:00+08:00",
    headline: "阿根廷中場輪換穩定，法國右路防線成賽前焦點",
    newsItems: [
      "阿根廷賽前訓練重點放在中場壓迫與邊路換位，主力框架未見大幅輪換。",
      "法國右路防守因停賽需要調整，市場對阿根廷小勝方向的討論升溫。",
      "多數分析仍提醒強強對話變數高，不建議追過深讓分。",
    ],
    instantAnalysis:
      "這組對戰目前新聞面與模型方向一致，阿根廷仍是較穩的一側，但法國反擊速度會讓勝負盤風險維持在中等。若臨場主勝賠率快速下修，代表市場可能已經過度集中，較適合降低部位或改看主勝不敗。",
  },
  "wc-2026-bra-eng": {
    updatedAt: "2026-06-26T20:05:00+08:00",
    headline: "巴西邊鋒復出狀態未明，英格蘭防守完整度較佳",
    newsItems: [
      "巴西主力邊鋒已恢復合練，但是否能踢滿仍是疑問。",
      "英格蘭中後場主力組合完整，定位球演練比重提高。",
      "市場勝負賠率拉鋸，和局與小球討論度偏高。",
    ],
    instantAnalysis:
      "目前新聞訊號支持低比分拉鋸。巴西上限較高，但關鍵球員狀態不確定；英格蘭防守穩定但主動創造力普通。若要操作，和局、小球比單押勝負更符合風險報酬。",
  },
  "wc-2026-esp-usa": {
    updatedAt: "2026-06-26T20:20:00+08:00",
    headline: "美國主力中場停賽，西班牙控球優勢更明確",
    newsItems: [
      "美國確認主力中場停賽，預計改由防守型球員先發。",
      "西班牙賽前演練高位逼搶，目標壓縮美國第一段出球。",
      "主勝市場維持穩定，未見異常劇烈波動。",
    ],
    instantAnalysis:
      "西班牙是目前新聞面與模型最一致的方向之一。美國少了中場出球點後，抗壓能力會下降；若西班牙早段取得領先，整場節奏會更容易被主隊控制。",
  },
  "wc-2026-ger-jpn": {
    updatedAt: "2026-06-26T20:18:00+08:00",
    headline: "德國後防傷疑未解除，日本反擊被視為冷門路徑",
    newsItems: [
      "德國主力中衛仍未完全參與高強度訓練，出賽狀態待確認。",
      "日本主力陣容大致完整，賽前重點演練快速轉換。",
      "市場仍偏德國主勝，但冷門討論度明顯增加。",
    ],
    instantAnalysis:
      "這場更適合視為風險提醒。德國攻擊火力充足，但後防不確定會放大日本反擊價值。若主勝賠率持續受熱，反而提高追熱門的風險。",
  },
  "wc-2026-por-mar": {
    updatedAt: "2026-06-26T20:12:00+08:00",
    headline: "葡萄牙邊後衛回歸，摩洛哥仍以低位防守為主",
    newsItems: [
      "葡萄牙主力邊後衛可回歸，邊路攻防完整度提升。",
      "摩洛哥前場替補衝擊點缺陣，後段追分選擇變少。",
      "市場看好葡萄牙，但總進球預期仍偏保守。",
    ],
    instantAnalysis:
      "葡萄牙主勝方向維持合理，但摩洛哥防守韌性會壓低比分。比起追大比分，主勝搭配小球或保守讓分更符合目前資料。",
  },
};

const verifiedTaiwanScheduleMatches = [
  buildMatch({
    id: "wc-2026-nor-fra",
    date: "2026-06-27T02:00:00+08:00",
    homeTeam: "挪威",
    awayTeam: "法國",
    predictedScore: "1-2",
    scorePredictions: [
      { score: "1-2", probability: 33, note: "法國整體陣容深度與前場個人能力較完整，挪威仍有定位球與高點威脅。" },
      { score: "0-2", probability: 22, note: "若法國早段取得領先，挪威被迫壓上後會留下反擊空間。" },
      { score: "1-1", probability: 19, note: "挪威若能降低節奏並守住禁區，和局路徑仍存在。" },
    ],
    categoryTags: ["today", "hot", "highConfidence"],
    marketView: "市場預期偏向法國不敗，客勝與小讓分討論度較高；挪威進球主要來自反擊與定位球情境。",
    recentForm: {
      home: "近 5 場 2 勝 1 和 2 敗，對強隊時防線承壓明顯",
      away: "近 5 場 3 勝 1 和 1 敗，前場轉換與板凳深度穩定",
    },
    goals: { homeFor: 7, homeAgainst: 7, awayFor: 10, awayAgainst: 5 },
    expectedGoals: { homeXG: 1.18, homeXGA: 1.45, awayXG: 1.82, awayXGA: 0.98 },
    injuriesSuspensions: {
      home: "主力陣容大致可用，但防線輪換深度普通",
      away: "主力框架完整，僅部分替補有出場時間管理",
    },
    expertPrediction: "多數賽前看法偏法國小勝，挪威具備進球能力但整體控場較弱。",
    aiAnalysis: "法國在攻擊選擇、轉換速度與中後場保護都較有優勢；挪威需要把比賽拖入身體對抗與定位球節奏，才有機會提高和局機率。",
    winProbability: { home: 24, draw: 27, away: 49 },
    recommendation: "法國勝 / 法國不敗",
    confidence: "高",
    riskLevel: "中",
    scoreBreakdown: { form: 20, attack: 17, defense: 12, odds: 12, squad: 9, headToHead: 3, sentiment: 8 },
    scoreBreakdownNotes: {
      form: "法國近期穩定性高於挪威，面對不同節奏都有調整能力。",
      attack: "法國前場創造力較高，挪威主要依賴高點與反擊。",
      defense: "法國防守保護較完整，挪威面對速度型攻擊較吃力。",
      odds: "市場信心偏法國，但客勝仍需留意熱門風險。",
      squad: "法國陣容深度較好，換人後仍能維持強度。",
      headToHead: "歷史對戰不是主要決策因素，僅小幅加權。",
      sentiment: "專家與網路情緒多數偏法國小勝。",
    },
    summary:
      "這場是台灣時間 06/27 凌晨 02:00 的焦點戰之一。法國整體實力、陣容深度與前場轉換速度都優於挪威，模型給出客隊較高勝率。挪威不是沒有機會，尤其在定位球、高點衝擊與禁區二點球上仍有威脅，但若比賽進入開放攻防，法國的速度與板凳深度會更有優勢。市場方向目前偏法國不敗，仍未到極端過熱。保守方向可看法國不敗，較積極者可評估法國小勝。",
    keyReasons: [
      "法國攻擊選擇與陣容深度明顯較好。",
      "挪威有定位球威脅，但防守轉身與橫移是風險。",
      "市場看法偏法國，與模型方向一致。",
      "若客勝賠率臨場過熱，可改走法國不敗。",
    ],
    sources: ["verified:fixture-search-2026-06-26", "mock:odds-consensus", "mock:expert-sentiment"],
  }),
  buildMatch({
    id: "wc-2026-sen-irq",
    date: "2026-06-27T02:00:00+08:00",
    homeTeam: "塞內加爾",
    awayTeam: "伊拉克",
    predictedScore: "2-0",
    scorePredictions: [
      { score: "2-0", probability: 35, note: "塞內加爾身體對抗與邊路速度較有優勢，零封路徑清楚。" },
      { score: "1-0", probability: 24, note: "若伊拉克低位防守成功，比賽可能被壓成小比分。" },
      { score: "2-1", probability: 18, note: "伊拉克若靠定位球得分，仍可能讓總進球上升。" },
    ],
    categoryTags: ["today", "highConfidence"],
    marketView: "市場偏向塞內加爾勝，讓分不宜追太深；小比分主勝討論度較高。",
    recentForm: {
      home: "近 5 場 3 勝 1 和 1 敗，防守與身體對抗穩定",
      away: "近 5 場 1 勝 2 和 2 敗，面對高壓時出球不穩",
    },
    goals: { homeFor: 8, homeAgainst: 4, awayFor: 5, awayAgainst: 8 },
    expectedGoals: { homeXG: 1.7, homeXGA: 0.86, awayXG: 0.92, awayXGA: 1.44 },
    injuriesSuspensions: {
      home: "主力框架完整，邊路速度點可用",
      away: "中場防守輪換較薄，後段體能是疑慮",
    },
    expertPrediction: "賽前看法普遍看好塞內加爾控制比賽節奏，伊拉克需要靠定位球製造變數。",
    aiAnalysis: "塞內加爾在防守穩定度與攻守轉換上都更可靠，伊拉克若無法守住前 30 分鐘，後續會很難抵擋邊路壓力。",
    winProbability: { home: 56, draw: 25, away: 19 },
    recommendation: "塞內加爾勝 / 小讓分",
    confidence: "高",
    riskLevel: "低",
    scoreBreakdown: { form: 22, attack: 16, defense: 14, odds: 12, squad: 8, headToHead: 2, sentiment: 8 },
    scoreBreakdownNotes: {
      form: "塞內加爾近期攻守平衡較好，伊拉克抗壓較不穩。",
      attack: "塞內加爾邊路速度與禁區衝擊較具威脅。",
      defense: "塞內加爾防守結構較完整，失球控制較佳。",
      odds: "市場偏主隊，讓分仍需控制不要追深。",
      squad: "塞內加爾主力可用度較高，伊拉克中場輪換較薄。",
      headToHead: "直接對戰參考有限。",
      sentiment: "專家預測多數支持塞內加爾小勝。",
    },
    summary:
      "塞內加爾 vs 伊拉克同樣在台灣時間 06/27 凌晨 02:00 開踢。模型明顯偏向塞內加爾，主因是防守穩定、邊路速度與對抗能力都較有優勢。伊拉克若能靠低位防守拖慢節奏，有機會把比分壓低，但長時間承受衝擊會讓體能與中場保護出現問題。這場比較適合主勝或小讓分方向，但不建議追過深讓分，因為小比分主勝仍是高機率劇本。",
    keyReasons: [
      "塞內加爾防守穩定分接近滿分。",
      "伊拉克面對高壓與身體對抗時出球風險偏高。",
      "市場支持主勝，但讓分不宜過深。",
      "適合保守主勝或小讓分，不宜追大比分。",
    ],
    sources: ["verified:fixture-search-2026-06-26", "mock:team-form", "mock:market-watch"],
  }),
  buildMatch({
    id: "wc-2026-cpv-ksa",
    date: "2026-06-27T07:00:00+08:00",
    homeTeam: "維德角",
    awayTeam: "沙烏地阿拉伯",
    predictedScore: "1-1",
    scorePredictions: [
      { score: "1-1", probability: 30, note: "雙方勝率接近，節奏可能偏保守。" },
      { score: "1-0", probability: 21, note: "維德角若靠防守反擊先進球，可能守住小勝。" },
      { score: "0-1", probability: 19, note: "沙烏地若控球效率提升，也有客勝路徑。" },
    ],
    categoryTags: ["today", "upsetRisk"],
    marketView: "市場分歧較明顯，和局與小球關注度高，勝負方向沒有明確共識。",
    recentForm: {
      home: "近 5 場 2 勝 2 和 1 敗，防守韌性尚可",
      away: "近 5 場 2 勝 1 和 2 敗，控球穩但終結效率普通",
    },
    goals: { homeFor: 6, homeAgainst: 5, awayFor: 6, awayAgainst: 6 },
    expectedGoals: { homeXG: 1.08, homeXGA: 1.12, awayXG: 1.05, awayXGA: 1.16 },
    injuriesSuspensions: {
      home: "主力陣容大致完整",
      away: "前場輪換可用，但進攻端效率仍需觀察",
    },
    expertPrediction: "多數看法認為本場接近五五波，和局與小球比單邊勝負更合理。",
    aiAnalysis: "兩隊差距不大，若沒有早段進球，比賽可能進入低節奏拉鋸。模型不建議重押勝負，保守觀望或小球更合適。",
    winProbability: { home: 34, draw: 33, away: 33 },
    recommendation: "和局 / 小球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: { form: 17, attack: 12, defense: 12, odds: 8, squad: 7, headToHead: 2, sentiment: 6 },
    scoreBreakdownNotes: {
      form: "兩隊近期狀態接近，沒有明顯單邊優勢。",
      attack: "雙方終結效率都普通，進球上限有限。",
      defense: "防守都具備韌性，但都不算壓倒性穩定。",
      odds: "市場分歧，勝負盤不夠乾淨。",
      squad: "陣容完整度差距不大。",
      headToHead: "直接對戰樣本有限。",
      sentiment: "網路情緒偏觀望，和局小球支持較多。",
    },
    summary:
      "維德角 vs 沙烏地阿拉伯在台灣時間 06/27 早上 07:00 開踢。這場模型分數不高，因為兩隊攻擊火力與防守穩定都接近，市場也沒有清楚方向。維德角可依靠防守反擊與身體對抗製造威脅，沙烏地則可能有較多控球時間，但終結效率仍是問題。若早段沒有進球，和局與小球會變得更合理。這場比較適合保守觀望，不宜重倉單邊。",
    keyReasons: [
      "雙方勝率接近，沒有明顯強勢方向。",
      "小球與和局比單邊勝負更符合模型。",
      "市場分歧代表風險較高。",
      "適合保守觀望或小注小球。",
    ],
    sources: ["verified:fixture-search-2026-06-26", "mock:odds-consensus", "mock:risk-note"],
  }),
  buildMatch({
    id: "wc-2026-uru-esp",
    date: "2026-06-27T07:00:00+08:00",
    homeTeam: "烏拉圭",
    awayTeam: "西班牙",
    predictedScore: "1-2",
    scorePredictions: [
      { score: "1-2", probability: 29, note: "西班牙控球較穩，但烏拉圭對抗與反擊足以進球。" },
      { score: "1-1", probability: 25, note: "若烏拉圭把節奏拉碎，和局機率會提高。" },
      { score: "0-1", probability: 18, note: "西班牙若控制風險，可能小勝收場。" },
    ],
    categoryTags: ["today", "hot"],
    marketView: "市場略偏西班牙，但烏拉圭硬度讓勝負盤風險不低；雙方進球討論度高。",
    recentForm: {
      home: "近 5 場 3 勝 1 和 1 敗，對抗強度與轉換速度佳",
      away: "近 5 場 4 勝 1 敗，控球壓制與前場壓迫穩定",
    },
    goals: { homeFor: 9, homeAgainst: 6, awayFor: 11, awayAgainst: 4 },
    expectedGoals: { homeXG: 1.38, homeXGA: 1.08, awayXG: 1.72, awayXGA: 0.88 },
    injuriesSuspensions: {
      home: "主力中後場可用，但犯規與牌風險偏高",
      away: "主力框架完整，邊路輪換深度佳",
    },
    expertPrediction: "多數看好西班牙控球優勢，但提醒烏拉圭的對抗與轉換會帶來高波動。",
    aiAnalysis: "西班牙更適合掌控比賽，但烏拉圭的壓迫與身體對抗會讓比賽不舒服。推薦方向偏西班牙不敗與雙方進球。",
    winProbability: { home: 29, draw: 30, away: 41 },
    recommendation: "西班牙不敗 / 雙方進球",
    confidence: "中",
    riskLevel: "中",
    scoreBreakdown: { form: 21, attack: 17, defense: 12, odds: 10, squad: 8, headToHead: 3, sentiment: 7 },
    scoreBreakdownNotes: {
      form: "兩隊狀態都好，西班牙穩定性略高。",
      attack: "西班牙創造力較好，烏拉圭反擊效率也不低。",
      defense: "西班牙失球控制較佳，但烏拉圭對抗會製造混亂。",
      odds: "市場略偏西班牙，但沒有到強烈單邊。",
      squad: "西班牙輪換深度較優。",
      headToHead: "歷史對戰只作輔助參考。",
      sentiment: "專家偏西班牙不敗，但普遍提醒烏拉圭風險。",
    },
    summary:
      "烏拉圭 vs 西班牙是台灣時間 06/27 早上 07:00 的熱門戰。西班牙有控球、壓迫與整體穩定度優勢，但烏拉圭的身體對抗、快速轉換與比賽硬度會讓勝負盤風險上升。模型給西班牙較高勝率，但不建議把它視為低風險主推。更合理的方向是西班牙不敗，或搭配雙方進球。若臨場西班牙賠率被壓太低，反而要注意市場過熱。",
    keyReasons: [
      "西班牙控球和 xGA 較佳，整體穩定度略優。",
      "烏拉圭反擊與身體對抗會拉高比賽波動。",
      "市場偏西班牙但不是無風險單邊。",
      "西班牙不敗比單押客勝更保守。",
    ],
    sources: ["verified:fixture-search-2026-06-26", "mock:expert-consensus", "mock:market-watch"],
  }),
  buildMatch({
    id: "wc-2026-egy-irn",
    date: "2026-06-27T10:00:00+08:00",
    homeTeam: "埃及",
    awayTeam: "伊朗",
    predictedScore: "1-1",
    scorePredictions: [
      { score: "1-1", probability: 32, note: "兩隊防守紀律都好，和局是最自然劇本。" },
      { score: "1-0", probability: 20, note: "埃及若靠個人能力先破門，可能守住小勝。" },
      { score: "0-1", probability: 18, note: "伊朗若定位球成功，客勝也有路徑。" },
    ],
    categoryTags: ["today", "upsetRisk"],
    marketView: "市場接近均勢，和局與小球是主要共識，勝負盤波動較高。",
    recentForm: {
      home: "近 5 場 2 勝 2 和 1 敗，防守紀律佳",
      away: "近 5 場 2 勝 2 和 1 敗，定位球與低位防守穩定",
    },
    goals: { homeFor: 6, homeAgainst: 4, awayFor: 5, awayAgainst: 4 },
    expectedGoals: { homeXG: 1.14, homeXGA: 0.96, awayXG: 1.02, awayXGA: 0.92 },
    injuriesSuspensions: {
      home: "主力前場可用，但進攻依賴少數核心",
      away: "防線完整，中場創造力普通",
    },
    expertPrediction: "多數預測偏低比分，雙方都不太可能冒進。",
    aiAnalysis: "這場更像耐心與失誤控制的比賽，單邊勝負優勢不足。若要介入，小球或和局比追勝負更合理。",
    winProbability: { home: 35, draw: 34, away: 31 },
    recommendation: "和局 / 小球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: { form: 18, attack: 12, defense: 14, odds: 8, squad: 7, headToHead: 2, sentiment: 7 },
    scoreBreakdownNotes: {
      form: "兩隊狀態接近，近期防守都比進攻可靠。",
      attack: "進攻創造力有限，較依賴個人能力與定位球。",
      defense: "雙方防守紀律都好，失球控制佳。",
      odds: "市場沒有明確單邊，勝負盤不乾淨。",
      squad: "陣容完整度差距有限。",
      headToHead: "歷史對戰影響不大。",
      sentiment: "預測情緒偏低比分與保守。",
    },
    summary:
      "埃及 vs 伊朗在台灣時間 06/27 早上 10:00 開踢。這場模型看不出明顯勝負優勢，兩隊都偏防守紀律、低風險推進與定位球威脅。埃及可能有較高的個人突破上限，伊朗則在低位防守與定位球執行上具備穩定度。若早段沒有意外進球，比賽很可能長時間停留在僵持狀態。推薦以和局、小球或保守觀望為主，不適合重倉勝負盤。",
    keyReasons: [
      "兩隊防守分高於攻擊分。",
      "市場接近均勢，和局風險很高。",
      "小球方向比勝負盤更合理。",
      "若臨場陣容偏保守，觀望價值更高。",
    ],
    sources: ["verified:fixture-search-2026-06-26", "mock:defense-profile", "mock:sentiment-scan"],
  }),
  buildMatch({
    id: "wc-2026-nzl-bel",
    date: "2026-06-27T10:00:00+08:00",
    homeTeam: "紐西蘭",
    awayTeam: "比利時",
    predictedScore: "0-2",
    scorePredictions: [
      { score: "0-2", probability: 36, note: "比利時進攻創造力與控球能力明顯較優。" },
      { score: "1-2", probability: 21, note: "紐西蘭若靠定位球得分，仍可能縮小差距。" },
      { score: "0-3", probability: 17, note: "若比利時早段打開比分，後續有擴大機會。" },
    ],
    categoryTags: ["today", "highConfidence"],
    marketView: "市場明顯偏比利時，客勝與讓分方向熱度高；需留意讓分過深。",
    recentForm: {
      home: "近 5 場 1 勝 1 和 3 敗，面對高強度壓迫較吃力",
      away: "近 5 場 3 勝 1 和 1 敗，進攻組織與個人能力穩定",
    },
    goals: { homeFor: 4, homeAgainst: 9, awayFor: 10, awayAgainst: 5 },
    expectedGoals: { homeXG: 0.78, homeXGA: 1.68, awayXG: 1.9, awayXGA: 0.94 },
    injuriesSuspensions: {
      home: "主力陣容可用，但後防深度不足",
      away: "主力攻擊線可用，輪換深度佳",
    },
    expertPrediction: "賽前普遍看好比利時取勝，紐西蘭主要威脅來自定位球。",
    aiAnalysis: "比利時在攻擊火力、控球與陣容深度都明顯占優。紐西蘭若無法把比賽拖慢，防線會持續承壓。",
    winProbability: { home: 15, draw: 22, away: 63 },
    recommendation: "比利時勝 / 比利時 -1",
    confidence: "高",
    riskLevel: "中",
    scoreBreakdown: { form: 23, attack: 18, defense: 13, odds: 13, squad: 9, headToHead: 2, sentiment: 9 },
    scoreBreakdownNotes: {
      form: "比利時近況與整體穩定性明顯較好。",
      attack: "比利時 xG 與進球能力都高於紐西蘭。",
      defense: "紐西蘭面對高強度進攻時失球風險偏高。",
      odds: "市場高度支持比利時，但讓分需控風險。",
      squad: "比利時陣容深度與換人選擇較佳。",
      headToHead: "直接對戰參考有限。",
      sentiment: "專家與網路情緒明顯偏比利時勝。",
    },
    summary:
      "紐西蘭 vs 比利時是台灣時間 06/27 早上 10:00 的高低差較明顯對戰。比利時在控球、攻擊火力與陣容深度都明顯優於紐西蘭，模型給出本輪最高的客勝機率。紐西蘭主要機會在定位球與防守反擊，但如果長時間被壓在半場，失球風險會逐步上升。方向上看好比利時勝，較積極可看小讓分；但若市場把讓分推太深，仍要避免追高。",
    keyReasons: [
      "比利時勝率與總分是本輪較高組合。",
      "紐西蘭後防面對高壓時風險偏高。",
      "市場與模型方向一致，但需避免讓分過熱。",
      "比利時勝比大比分更穩健。",
    ],
    sources: ["verified:fixture-search-2026-06-26", "mock:team-stats", "mock:expert-consensus"],
  }),
];

function createCompactVerifiedMatch({
  id,
  date,
  homeTeam,
  awayTeam,
  predictedScore,
  scorePredictions,
  categoryTags,
  winProbability,
  recommendation,
  confidence,
  riskLevel,
  scoreBreakdown,
  marketView,
  summary,
  keyReasons,
}) {
  const [homeGoals, awayGoals] = predictedScore.split("-").map(Number);
  const totalScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const favorite = winProbability.home > winProbability.away ? homeTeam : awayTeam;
  const underdog = winProbability.home > winProbability.away ? awayTeam : homeTeam;

  return buildMatch({
    id,
    date,
    homeTeam,
    awayTeam,
    predictedScore,
    scorePredictions,
    categoryTags,
    marketView,
    recentForm: {
      home: "依 2026 當屆賽程與近期賽前資訊建立的 mock 分析，正式版需由即時 API 更新。",
      away: "依 2026 當屆賽程與近期賽前資訊建立的 mock 分析，正式版需由即時 API 更新。",
    },
    goals: {
      homeFor: Math.max(4, homeGoals + 5),
      homeAgainst: Math.max(3, awayGoals + 4),
      awayFor: Math.max(4, awayGoals + 5),
      awayAgainst: Math.max(3, homeGoals + 4),
    },
    expectedGoals: {
      homeXG: Number((1.05 + homeGoals * 0.34 + winProbability.home / 180).toFixed(2)),
      homeXGA: Number((0.88 + awayGoals * 0.28 + winProbability.away / 240).toFixed(2)),
      awayXG: Number((1.05 + awayGoals * 0.34 + winProbability.away / 180).toFixed(2)),
      awayXGA: Number((0.88 + homeGoals * 0.28 + winProbability.home / 240).toFixed(2)),
    },
    injuriesSuspensions: {
      home: "未接正式傷停 API，需以賽前 10 小時內資料更新。",
      away: "未接正式傷停 API，需以賽前 10 小時內資料更新。",
    },
    expertPrediction: `${favorite} 在模型中略佔優勢，但仍需以最新賽前新聞、名單與市場變化校正。`,
    aiAnalysis: `${favorite} 的勝率與綜合分數高於 ${underdog}，但目前仍屬 mock 分析，不應視為即時投注建議。`,
    winProbability,
    recommendation,
    confidence,
    riskLevel,
    scoreBreakdown,
    scoreBreakdownNotes: {
      form: "依當屆賽程與近期表現方向估算，正式版需改接即時賽程/戰績 API。",
      attack: "以預測比分、近期攻擊印象與對戰強度估算。",
      defense: "以失球風險、對手攻擊壓力與比賽節奏估算。",
      odds: "目前是市場情境 mock，正式版需串接 odds provider。",
      squad: "目前未接傷停 API，因此只給保守評估。",
      headToHead: "歷史對戰權重低，避免過度影響模型。",
      sentiment: "新聞與網路情緒需接即時來源後更新。",
    },
    summary,
    keyReasons,
    sources: ["verified:fixture-search-2026-06-27", "mock:analysis-until-live-api", "mock:market-scenario"],
    totalScore,
  });
}

const verifiedTomorrowScheduleMatches = [
  createCompactVerifiedMatch({
    id: "wc-2026-pan-eng",
    date: "2026-06-28T02:00:00+08:00",
    homeTeam: "巴拿馬",
    awayTeam: "英格蘭",
    predictedScore: "0-2",
    scorePredictions: [
      { score: "0-2", probability: 37, note: "英格蘭整體實力與禁區壓制力較高。" },
      { score: "0-1", probability: 23, note: "若巴拿馬低位防守成功，比分可能被壓低。" },
      { score: "1-2", probability: 17, note: "巴拿馬定位球得分時仍可能咬住比分。" },
    ],
    categoryTags: ["tomorrow", "hot", "highConfidence"],
    winProbability: { home: 14, draw: 22, away: 64 },
    recommendation: "英格蘭勝 / 英格蘭 -1",
    confidence: "高",
    riskLevel: "中",
    scoreBreakdown: { form: 23, attack: 18, defense: 13, odds: 13, squad: 9, headToHead: 3, sentiment: 9 },
    marketView: "市場明顯偏英格蘭，熱門方向需避免追過深讓分。",
    summary:
      "巴拿馬 vs 英格蘭是台灣時間 06/28 凌晨 02:00 的明日賽程。英格蘭在陣容深度、控球和定位球品質都明顯佔優，模型給出較高勝率。巴拿馬的主要策略會是收縮防守、拖慢節奏並等待定位球機會，但若英格蘭早段進球，讓分方向會更有利。此場適合列為高信心推薦，但仍需留意熱門盤過熱。",
    keyReasons: ["英格蘭整體戰力與板凳深度優勢大。", "巴拿馬進攻創造力有限。", "市場偏英格蘭但讓分可能過熱。", "保守方向可看英格蘭勝。"],
  }),
  createCompactVerifiedMatch({
    id: "wc-2026-cro-gha",
    date: "2026-06-28T02:00:00+08:00",
    homeTeam: "克羅埃西亞",
    awayTeam: "迦納",
    predictedScore: "1-1",
    scorePredictions: [
      { score: "1-1", probability: 31, note: "兩隊都有中場對抗能力，和局路徑清楚。" },
      { score: "2-1", probability: 21, note: "克羅埃西亞若掌控節奏，有小勝機會。" },
      { score: "1-2", probability: 18, note: "迦納速度打出反擊時可能爆冷。" },
    ],
    categoryTags: ["tomorrow", "upsetRisk"],
    winProbability: { home: 36, draw: 32, away: 32 },
    recommendation: "和局 / 雙方進球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: { form: 18, attack: 14, defense: 12, odds: 8, squad: 7, headToHead: 2, sentiment: 7 },
    marketView: "市場接近均勢，和局與雙方進球更值得關注。",
    summary:
      "克羅埃西亞 vs 迦納同樣在台灣時間 06/28 凌晨 02:00 開踢。這場勝率接近，克羅埃西亞可能有較好的中場控制，迦納則有速度和反擊爆點。模型沒有給出明確單邊方向，若投注思維過度偏向名氣隊伍，風險會升高。比較合理的方向是和局、雙方進球或保守觀望。",
    keyReasons: ["勝率接近，單邊不乾淨。", "克羅埃西亞控場較好但速度防守有風險。", "迦納反擊具備爆冷條件。", "適合保守觀望或雙方進球。"],
  }),
  createCompactVerifiedMatch({
    id: "wc-2026-alg-aut",
    date: "2026-06-28T07:00:00+08:00",
    homeTeam: "阿爾及利亞",
    awayTeam: "奧地利",
    predictedScore: "1-1",
    scorePredictions: [
      { score: "1-1", probability: 30, note: "雙方攻守都偏均衡，低比分拉鋸機率高。" },
      { score: "1-2", probability: 22, note: "奧地利高壓奏效時可能拿下小勝。" },
      { score: "2-1", probability: 18, note: "阿爾及利亞若邊路突破成功，有主勝可能。" },
    ],
    categoryTags: ["tomorrow", "upsetRisk"],
    winProbability: { home: 32, draw: 33, away: 35 },
    recommendation: "和局 / 小球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: { form: 18, attack: 13, defense: 13, odds: 8, squad: 7, headToHead: 2, sentiment: 6 },
    marketView: "市場偏拉鋸，勝負盤不明朗。",
    summary:
      "阿爾及利亞 vs 奧地利在台灣時間 06/28 早上 07:00 開踢。奧地利有較清楚的高位壓迫結構，阿爾及利亞則具備邊路突破和身體對抗。模型認為雙方差距有限，和局和小球會比單押勝負更符合風險管理。若臨場新聞顯示任一方主力前場缺陣，進球預期還會再下修。",
    keyReasons: ["雙方勝率接近。", "進攻上限不算穩定。", "市場沒有清楚單邊訊號。", "小球與和局較合理。"],
  }),
  createCompactVerifiedMatch({
    id: "wc-2026-jor-arg",
    date: "2026-06-28T07:00:00+08:00",
    homeTeam: "約旦",
    awayTeam: "阿根廷",
    predictedScore: "0-3",
    scorePredictions: [
      { score: "0-3", probability: 34, note: "阿根廷控球與終結品質明顯高出一截。" },
      { score: "0-2", probability: 28, note: "若阿根廷控制消耗，可能穩健拿下。" },
      { score: "1-3", probability: 15, note: "約旦靠定位球得分時仍可能有一球。" },
    ],
    categoryTags: ["tomorrow", "hot", "highConfidence"],
    winProbability: { home: 8, draw: 17, away: 75 },
    recommendation: "阿根廷勝 / 阿根廷 -1.5",
    confidence: "高",
    riskLevel: "中",
    scoreBreakdown: { form: 24, attack: 19, defense: 14, odds: 14, squad: 10, headToHead: 3, sentiment: 9 },
    marketView: "市場高度偏阿根廷，最大風險是讓分過深。",
    summary:
      "約旦 vs 阿根廷是台灣時間 06/28 早上 07:00 的熱門賽事。阿根廷在控球、進攻組織、終結能力與陣容深度都明顯優於約旦，模型給出明日最高勝率之一。約旦主要機會來自定位球與阿根廷輪換後的防線空檔，但整體勝負方向相當明確。適合看阿根廷勝，讓分則需避免臨場過熱。",
    keyReasons: ["阿根廷整體實力差距明顯。", "約旦進攻創造力有限。", "市場與模型一致偏阿根廷。", "高信心但讓分需控風險。"],
  }),
  createCompactVerifiedMatch({
    id: "wc-2026-col-por",
    date: "2026-06-28T10:00:00+08:00",
    homeTeam: "哥倫比亞",
    awayTeam: "葡萄牙",
    predictedScore: "1-2",
    scorePredictions: [
      { score: "1-2", probability: 29, note: "葡萄牙攻擊選擇較多，哥倫比亞仍有反擊威脅。" },
      { score: "1-1", probability: 25, note: "若哥倫比亞壓低節奏，和局機率會上升。" },
      { score: "0-2", probability: 18, note: "葡萄牙若先進球，控場會更明顯。" },
    ],
    categoryTags: ["tomorrow", "hot"],
    winProbability: { home: 28, draw: 30, away: 42 },
    recommendation: "葡萄牙不敗 / 雙方進球",
    confidence: "中",
    riskLevel: "中",
    scoreBreakdown: { form: 20, attack: 17, defense: 12, odds: 10, squad: 8, headToHead: 2, sentiment: 8 },
    marketView: "市場略偏葡萄牙，但哥倫比亞反擊讓客勝不宜重倉。",
    summary:
      "哥倫比亞 vs 葡萄牙在台灣時間 06/28 早上 10:00 開踢，是明日熱門對戰之一。葡萄牙具備較完整的攻擊選擇與輪換深度，但哥倫比亞的反擊速度與身體對抗不容忽視。模型偏向葡萄牙不敗，而非重押客勝。若臨場葡萄牙賠率被追低，雙方進球或不敗方向更符合保守策略。",
    keyReasons: ["葡萄牙攻擊選擇較多。", "哥倫比亞反擊具威脅。", "客勝有優勢但非低風險。", "葡萄牙不敗較穩。"],
  }),
  createCompactVerifiedMatch({
    id: "wc-2026-cod-uzb",
    date: "2026-06-28T10:00:00+08:00",
    homeTeam: "剛果民主共和國",
    awayTeam: "烏茲別克",
    predictedScore: "1-1",
    scorePredictions: [
      { score: "1-1", probability: 31, note: "兩隊勝率接近，低比分和局最合理。" },
      { score: "2-1", probability: 20, note: "剛果民主共和國靠身體對抗可拉出主勝。" },
      { score: "1-2", probability: 19, note: "烏茲別克若轉換效率高，也有客勝路徑。" },
    ],
    categoryTags: ["tomorrow", "upsetRisk"],
    winProbability: { home: 34, draw: 33, away: 33 },
    recommendation: "和局 / 小球",
    confidence: "中",
    riskLevel: "高",
    scoreBreakdown: { form: 17, attack: 13, defense: 12, odds: 8, squad: 7, headToHead: 2, sentiment: 6 },
    marketView: "市場分歧大，和局與小球比勝負盤更乾淨。",
    summary:
      "剛果民主共和國 vs 烏茲別克在台灣時間 06/28 早上 10:00 開踢。兩隊整體勝率非常接近，剛果民主共和國有身體對抗與定位球優勢，烏茲別克則可能在轉換與紀律性上取得平衡。這場模型明確列為風險提醒，不適合重倉單邊。和局、小球或保守觀望會更接近目前資料結論。",
    keyReasons: ["勝率幾乎五五波。", "市場分歧明顯。", "小球方向較合理。", "適合列入冷門風險提醒。"],
  }),
];

const activeVerifiedMatches = [...verifiedTaiwanScheduleMatches, ...verifiedTomorrowScheduleMatches];

const verifiedNewsByMatchId = Object.fromEntries(
  activeVerifiedMatches.map((match) => [
    match.id,
    {
      updatedAt: "2026-06-26T21:45:00+08:00",
      headline: `${match.homeTeam} vs ${match.awayTeam} 賽前重點：${match.recommendation}`,
      newsItems: match.keyReasons.slice(0, 3),
      instantAnalysis: match.summary,
    },
  ]),
);

async function fetchLiveProviderData() {
  const provider = normalizeProviderName(SOURCE_MODE);
  if (provider === "mock") return null;

  if (liveScheduleCache && Date.now() < liveScheduleCache.expiresAtMs) {
    return liveScheduleCache.data;
  }

  if (provider === "api-football" || provider === "apifootball") {
    const data = await fetchApiFootballFixtures();
    if (!data) return null;

    liveScheduleCache = {
      data,
      expiresAtMs: Date.now() + LIVE_CACHE_TTL_MS,
    };
    return data;
  }

  return null;
}

export async function getWorldCupPredictions() {
  let liveData = null;
  let liveError = null;

  try {
    liveData = SOURCE_MODE !== "mock" ? await fetchLiveProviderData() : null;
  } catch (error) {
    liveError = error instanceof Error ? error.message : "Unknown live provider error";
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceMode: liveData ? liveData.provider : "mock",
    scheduleUpdateMode: liveData ? "provider" : "mock",
    liveData: {
      enabled: Boolean(liveData),
      provider: liveData?.provider || null,
      fetchedAt: liveData?.fetchedAt || null,
      expiresAt: liveData?.expiresAt || null,
      maxCacheHours: 9.5,
      error: liveError,
      fallbackReason: liveData ? null : liveError || "No live provider data available. Using verified mock fixtures.",
    },
    scheduleIntegrationPlan,
    model: {
      total: 100,
      weights,
    },
    providerPlaceholders,
    matches: liveData?.matches || activeVerifiedMatches,
  };
}

export async function getMatchNews(matchId) {
  const liveMatches = liveScheduleCache?.data?.matches || [];
  const match = [...liveMatches, ...activeVerifiedMatches].find((item) => item.id === matchId);
  const news = verifiedNewsByMatchId[matchId];

  if (!match || !news) {
    return {
      matchId,
      found: false,
      headline: "目前沒有這場賽事的新聞資料",
      newsItems: [],
      instantAnalysis: "請確認 matchId 是否存在，或等待正式新聞 API 串接。",
      sources: ["mock:news-unavailable"],
    };
  }

  return {
    matchId,
    found: true,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    updatedAt: news?.updatedAt || new Date().toISOString(),
    headline: news?.headline || `${match.homeTeam} vs ${match.awayTeam} 即時賽程已同步`,
    newsItems: news?.newsItems || [
      "賽程已由 live fixture provider 更新。",
      "新聞與專家分析尚未串接 10 小時內新聞 API。",
      "目前分析按鈕會使用賽程與基礎模型，後續可接 Highlightly 或 Sportmonks News。",
    ],
    instantAnalysis:
      news?.instantAnalysis ||
      `${match.homeTeam} vs ${match.awayTeam} 已進入即時賽程模式。若要讓新聞與分析也符合 10 小時內更新，需要再設定新聞資料源 API Key。`,
    sources: news ? ["mock:highlightly-news", "mock:expert-monitor", "mock:market-watch"] : ["live:fixture-provider", "pending:news-api"],
  };
}
