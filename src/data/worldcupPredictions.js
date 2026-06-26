const SOURCE_MODE = process.env.FOOTBALL_DATA_PROVIDER || "mock";

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
  note: "This module is prepared to update schedules without consuming live score events. Add an API key and normalize fixtures into the matches schema.",
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

async function fetchLiveProviderData() {
  // Future integration point:
  // 1. Select provider by FOOTBALL_DATA_PROVIDER.
  // 2. Read the matching API key from providerPlaceholders.
  // 3. Normalize fixtures, odds, injuries, xG and sentiment into the response schema below.
  // 4. Reuse weights to generate totalScore and scoreBreakdown consistently.
  return null;
}

export async function getWorldCupPredictions() {
  const liveData = SOURCE_MODE !== "mock" ? await fetchLiveProviderData() : null;
  return {
    generatedAt: new Date().toISOString(),
    sourceMode: liveData ? SOURCE_MODE : "mock",
    scheduleUpdateMode: liveData ? "provider" : "mock",
    scheduleIntegrationPlan,
    model: {
      total: 100,
      weights,
    },
    providerPlaceholders,
    matches: liveData?.matches || mockMatches,
  };
}

export async function getMatchNews(matchId) {
  const match = mockMatches.find((item) => item.id === matchId);
  const news = mockNewsByMatchId[matchId];

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
    ...news,
    sources: ["mock:highlightly-news", "mock:expert-monitor", "mock:market-watch"],
  };
}
