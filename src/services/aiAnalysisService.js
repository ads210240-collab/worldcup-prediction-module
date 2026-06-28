const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function trimToRange(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 300) return normalized;
  return `${normalized.slice(0, 296)}...`;
}

function buildRuleAnalysis({ fixture, homeStats, awayStats, newsItems, odds, prediction }) {
  const oddsText = odds?.markets?.home
    ? `盤口目前為主勝 ${odds.markets.home}、和局 ${odds.markets.draw}、客勝 ${odds.markets.away}，市場訊號已納入模型。`
    : "目前沒有可用盤口資料，因此盤口權重不以固定數值補上，信心分已下修。";
  const newsText = newsItems.length
    ? `最近 24 小時納入 ${newsItems.length} 則新聞，包含 ${[...new Set(newsItems.map((item) => item.source))].join("、")}。`
    : "最近 24 小時新聞樣本不足，新聞情緒不強行補分。";
  const favorite =
    prediction.winProbability.home >= prediction.winProbability.away && prediction.winProbability.home >= prediction.winProbability.draw
      ? fixture.homeTeam
      : prediction.winProbability.away >= prediction.winProbability.home && prediction.winProbability.away >= prediction.winProbability.draw
        ? fixture.awayTeam
        : "雙方";

  return trimToRange(
    `${fixture.homeTeam} vs ${fixture.awayTeam} 的 V2 分析由近五場、盤口、World Football Elo、FIFA Ranking、新聞情緒與主客場表現重新計算。${fixture.homeTeam} 近期為 ${homeStats.recent.formText}，${fixture.awayTeam} 近期為 ${awayStats.recent.formText}。Elo/FIFA 顯示 ${favorite} 目前基礎面較有支撐，模型給出 ${prediction.predictedScore} 為最高機率比分，Over 2.5 為 ${prediction.overUnder.over25}%、BTTS 為 ${prediction.btts}%。${oddsText}${newsText} 風險在於免費來源可能缺少完整傷停與即時陣容，${prediction.hasEstimation ? "此分析部分資料使用估算，" : ""}若臨場名單或盤口快速變動，應降低信心並重新整理。`,
  );
}

async function buildLlmAnalysis(context) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: "你是台灣繁體中文足球賽事研究分析師。請輸出 150 到 300 字，語氣專業、保守，不像賭博下注。",
        },
        {
          role: "user",
          content: JSON.stringify(context),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI analysis failed: ${response.status}`);
  const data = await response.json();
  const output = data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join(" ");
  return trimToRange(output);
}

export async function generateAiAnalysis(context) {
  if (OPENAI_API_KEY) {
    try {
      return {
        analysisMode: "llm",
        summary: await buildLlmAnalysis(context),
      };
    } catch (error) {
      return {
        analysisMode: "rule-based",
        summary: buildRuleAnalysis(context),
        error: error instanceof Error ? error.message : "OpenAI analysis failed",
      };
    }
  }

  return {
    analysisMode: "rule-based",
    summary: buildRuleAnalysis(context),
  };
}
