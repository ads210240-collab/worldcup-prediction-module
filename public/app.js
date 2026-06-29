const tabLabels = {
  today: {
    title: "今日賽事",
    hint: "依今日開賽與市場關注度整理。",
  },
  tomorrow: {
    title: "明日賽事",
    hint: "提前檢視隔日盤勢、傷停與模型分數。",
  },
  hot: {
    title: "熱門對戰",
    hint: "市場討論度與隊伍關注度較高的焦點戰。",
  },
  highConfidence: {
    title: "高信心推薦",
    hint: "模型分數、資料面與市場方向較一致的場次。",
  },
  upsetRisk: {
    title: "冷門風險提醒",
    hint: "熱門方向可能過熱或勝率接近的高波動場次。",
  },
};

const scoreLabels = {
  tournamentPerformance: ["本屆賽事表現", 35],
  tournamentAttack: ["本屆攻擊效率", 20],
  tournamentDefense: ["本屆防守穩定度", 15],
  rankingElo: ["Elo / 世界排名", 15],
  sentiment: ["新聞與陣容情緒", 10],
};

let predictions = [];
let activeTab = "today";

const matchGrid = document.querySelector("#matchGrid");
const loadingState = document.querySelector("#loadingState");
const activeTabTitle = document.querySelector("#activeTabTitle");
const activeTabHint = document.querySelector("#activeTabHint");
const refreshButton = document.querySelector("#refreshButton");
const template = document.querySelector("#matchCardTemplate");
const liveStatus = document.querySelector("#liveStatus");
const debugPanel = document.querySelector("#debugPanel");

const flagCodes = {
  Argentina: "ar",
  Australia: "au",
  Belgium: "be",
  Brazil: "br",
  Cameroon: "cm",
  Canada: "ca",
  Chile: "cl",
  Colombia: "co",
  Croatia: "hr",
  Curaçao: "cw",
  Czechia: "cz",
  Denmark: "dk",
  Ecuador: "ec",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Ghana: "gh",
  Haiti: "ht",
  Iran: "ir",
  Iraq: "iq",
  Italy: "it",
  IvoryCoast: "ci",
  IvoryCoastSpaced: "ci",
  Japan: "jp",
  Mexico: "mx",
  Morocco: "ma",
  Netherlands: "nl",
  Norway: "no",
  Portugal: "pt",
  Scotland: "gb-sct",
  Senegal: "sn",
  SouthAfrica: "za",
  SouthKorea: "kr",
  Spain: "es",
  Sweden: "se",
  Tunisia: "tn",
  Uruguay: "uy",
  USA: "us",
  Wales: "gb-wls",
  阿根廷: "ar",
  澳洲: "au",
  比利時: "be",
  巴西: "br",
  喀麥隆: "cm",
  加拿大: "ca",
  智利: "cl",
  哥倫比亞: "co",
  克羅埃西亞: "hr",
  庫拉索: "cw",
  捷克: "cz",
  丹麥: "dk",
  厄瓜多: "ec",
  英格蘭: "gb-eng",
  法國: "fr",
  德國: "de",
  迦納: "gh",
  海地: "ht",
  伊朗: "ir",
  伊拉克: "iq",
  義大利: "it",
  象牙海岸: "ci",
  日本: "jp",
  墨西哥: "mx",
  摩洛哥: "ma",
  荷蘭: "nl",
  挪威: "no",
  葡萄牙: "pt",
  蘇格蘭: "gb-sct",
  塞內加爾: "sn",
  南非: "za",
  南韓: "kr",
  韓國: "kr",
  西班牙: "es",
  瑞典: "se",
  突尼西亞: "tn",
  烏拉圭: "uy",
  美國: "us",
  威爾斯: "gb-wls",
};

function formatDate(value) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  })
    .formatToParts(new Date(value))
    .reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return `台灣時間 ${parts.month}/${parts.day} ${parts.weekday} ${parts.hour}:${parts.minute}`;
}

function createScorePredictions(match) {
  return match.scorePredictions
    .map(
      (prediction, index) => `
        <div class="score-prediction-item">
          <div>
            <span>#${index + 1}</span>
            <strong>${prediction.score}</strong>
          </div>
          <div class="score-probability">
            <strong>${prediction.probability}%</strong>
            <span>${prediction.note}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function createRecommendedPlay(match) {
  const totalPlay = (match.overUnder?.over25 ?? 0) >= (match.overUnder?.under25 ?? 0) ? "大球 2.5" : "小球 2.5";
  const scorePlay = String(match.predictedScore || "").replace("-", ":");
  const primaryPlay = String(match.recommendation || "")
    .split("/")
    .map((item) => item.trim())
    .find((item) => item && !/^BTTS$/i.test(item));
  return [primaryPlay, `比分 ${scorePlay}`, totalPlay].filter(Boolean).join(" / ");
}

function getFlagCode(teamName) {
  const normalized = String(teamName || "").replace(/[\s-]/g, "");
  return flagCodes[teamName] || flagCodes[normalized] || "";
}

function renderTeamFlag(element, teamName) {
  const flagCode = getFlagCode(teamName);
  element.classList.toggle("has-flag", Boolean(flagCode));
  element.innerHTML = flagCode
    ? `<img src="https://flagcdn.com/w160/${flagCode}.png" alt="${teamName} 國旗" loading="lazy" />`
    : `<span>${String(teamName || "隊").slice(0, 2)}</span>`;
}

function formatDateTime(value) {
  if (!value) return "尚未更新";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(value))
    .reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function renderLiveStatus(data) {
  const health = data.dataLayer?.sourceHealth || {};
  const statusRows = [
    health.fixtures === "updated" ? "✅ 賽程已更新" : "⚠️ 賽程未取得",
    health.news === "updated" ? "✅ 新聞已更新" : "⚠️ 新聞未取得",
  ];
  const isLive = Boolean(data.liveData?.enabled);
  liveStatus.classList.toggle("is-live", isLive);
  liveStatus.innerHTML = `
    <strong>${isLive ? "資料狀態" : "Fallback 模擬資料"}</strong>
    <span>${statusRows.join("　")} · 更新 ${formatDateTime(data.liveData?.fetchedAt)}</span>
  `;
}

function renderDebugPanel(data) {
  const grid = debugPanel.querySelector(".debug-grid");
  const statuses = Object.entries(data.dataLayer?.sourceStatuses || {}).flatMap(([group, items]) =>
    items.map((item) => ({ ...item, group })),
  );

  grid.innerHTML = statuses
    .map(
      (item) => `
        <div class="debug-item ${item.ok ? "ok" : "failed"}">
          <div>
            <strong>${item.source}</strong>
            <span>${item.group}</span>
          </div>
          <dl>
            <div><dt>Status</dt><dd>${item.ok ? "Success" : "Failed"}</dd></div>
            <div><dt>HTTP</dt><dd>${item.httpStatus || "-"}</dd></div>
            <div><dt>Cache</dt><dd>${item.cacheHit ? "Hit" : "Miss"}</dd></div>
            <div><dt>Time</dt><dd>${item.responseTimeMs == null ? "-" : `${item.responseTimeMs}ms`}</dd></div>
            <div><dt>Updated</dt><dd>${formatDateTime(item.lastUpdatedAt || item.cachedAt)}</dd></div>
          </dl>
          ${item.error ? `<p>${item.error}</p>` : ""}
        </div>
      `,
    )
    .join("");
}

function getRiskClass(riskLevel) {
  if (riskLevel === "高") return "high";
  if (riskLevel === "中") return "medium";
  return "low";
}

function createProbabilityRows(match) {
  const labels = [
    ["主勝", match.winProbability.home, "home", "👑"],
    ["和局", match.winProbability.draw, "draw", "🤝"],
    ["客勝", match.winProbability.away, "away", "🏆"],
  ];

  return labels
    .map(
      ([label, value, type, icon]) => `
        <div class="probability-line">
          <span class="probability-icon ${type}">${icon}</span>
          <span>${label}</span>
          <strong>${value}%</strong>
        </div>
      `,
    )
    .join("");
}

function createBreakdown(match) {
  return Object.entries(scoreLabels)
    .map(([key, [label, max]]) => {
      const value = match.scoreBreakdownV2?.[key] ?? 0;
      const width = Math.round((value / max) * 100);
      return `
        <div class="breakdown-line">
          <span>${label}</span>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style="width: ${width}%"></div>
          </div>
          <strong>${value}/${max}</strong>
          <p>${match.scoreBreakdownNotes[key]}</p>
        </div>
      `;
    })
    .join("");
}

function createBreakdownSummary(match) {
  const topScore = match.scorePredictions?.[0]?.score || match.predictedScore;
  const secondScore = match.scorePredictions?.[1]?.score;
  const totalPlay = (match.overUnder?.over25 ?? 0) >= (match.overUnder?.under25 ?? 0) ? "大球 2.5" : "小球 2.5";
  const handicap = match.asianHandicap && !match.asianHandicap.includes("不建議") ? match.asianHandicap : "讓球盤保守觀望";
  const comboAdvice =
    match.riskLevel === "高"
      ? "不建議重串，可用小注比分方向或單場觀察。"
      : `串關可優先搭配「${totalPlay}」與「${handicap}」。`;
  const scoreAdvice = secondScore ? `比分可用 ${topScore} 為主劇本，${secondScore} 作為保守備案。` : `比分可用 ${topScore} 為主劇本。`;

  return `
    <strong>投注組合建議</strong>
    <p>${comboAdvice} ${scoreAdvice} 若只想保守參考，建議以「${createRecommendedPlay(match)}」為主，不要把精確比分當成唯一買點。</p>
  `;
}

function createV2Metrics(match) {
  return `
    <div>
      <span>大小球 2.5</span>
      <strong>大球 ${match.overUnder?.over25 ?? "-"}% / 小球 ${match.overUnder?.under25 ?? "-"}%</strong>
    </div>
  `;
}

function renderNewsPanel(panel, data) {
  panel.hidden = false;
  panel.innerHTML = `
    <div class="news-panel-header">
      <span>即時新聞 / 賽前分析</span>
      <strong>${formatDate(data.updatedAt)}</strong>
    </div>
    <h4>${data.headline}</h4>
    <ul>
      ${data.newsItems.map((item) => `<li>${item}</li>`).join("")}
    </ul>
    <p>${data.instantAnalysis}</p>
    <small>Sources: ${data.sources.join(", ")}</small>
  `;
}

async function loadMatchNews(match, panel, button) {
  button.disabled = true;
  button.textContent = "讀取中";

  try {
    const response = await fetch(`/api/worldcup/news?matchId=${encodeURIComponent(match.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`News API failed: ${response.status}`);
    renderNewsPanel(panel, await response.json());
  } catch (error) {
    panel.hidden = false;
    panel.innerHTML = `<p>目前無法載入這場賽事的即時新聞，請稍後再試。</p>`;
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "即時新聞";
  }
}

function createDataGrid(match) {
  const home = match.tournamentStats.home;
  const away = match.tournamentStats.away;
  const items = [
    ["本屆戰績", match.matchResultsView || `${match.homeTeam}: ${home.formText}<br>${match.awayTeam}: ${away.formText}`],
    ["本屆進球 / 失球", `${match.homeTeam}: ${home.goalsFor}/${home.goalsAgainst}，淨勝 ${home.goalDifference}<br>${match.awayTeam}: ${away.goalsFor}/${away.goalsAgainst}，淨勝 ${away.goalDifference}`],
    ["場均進球 / 場均失球", `${match.homeTeam}: ${home.goalsForPerGame}/${home.goalsAgainstPerGame}<br>${match.awayTeam}: ${away.goalsForPerGame}/${away.goalsAgainstPerGame}`],
    ["本屆階段 / 狀態", `${match.homeTeam}: ${home.phase}，${home.advancementStatus}<br>${match.awayTeam}: ${away.phase}，${away.advancementStatus}`],
    ["Elo / 世界排名", match.rankingView || match.marketView],
    ["新聞摘要", match.expertPrediction],
    ["AI 綜合分析", `${match.aiAnalysis}<br>analysisMode: ${match.analysisMode || "rule-based"}`],
  ];

  return items
    .map(
      ([title, value]) => `
        <div class="data-tile">
          <span>${title}</span>
          <p>${value}</p>
        </div>
      `,
    )
    .join("");
}

function renderMatches() {
  const label = tabLabels[activeTab];
  activeTabTitle.textContent = label.title;
  activeTabHint.textContent = label.hint;

  const filtered = predictions.filter((match) => match.categoryTags.includes(activeTab));
  matchGrid.innerHTML = "";

  filtered.forEach((match) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".match-date").textContent = formatDate(match.date);
    node.querySelector(".risk-pill").textContent = `風險 ${match.riskLevel}`;
    node.querySelector(".risk-pill").classList.add(getRiskClass(match.riskLevel));
    node.querySelector(".home-team").textContent = match.homeTeam;
    node.querySelector(".away-team").textContent = match.awayTeam;
    renderTeamFlag(node.querySelector(".home-mark"), match.homeTeam);
    renderTeamFlag(node.querySelector(".away-mark"), match.awayTeam);
    const topWinProbability = Math.max(match.winProbability.home, match.winProbability.draw, match.winProbability.away);
    node.querySelector(".total-score strong").textContent = `${topWinProbability}%`;
    node.querySelector(".predicted-score").textContent = match.predictedScore;
    node.querySelector(".score-prediction-list").innerHTML = createScorePredictions(match);
    node.querySelector(".over-under-card").innerHTML = createV2Metrics(match);
    node.querySelector(".probability-bars").innerHTML = createProbabilityRows(match);
    node.querySelector(".recommendation-card strong").textContent = createRecommendedPlay(match);
    const estimationNotice = node.querySelector(".estimation-notice");
    estimationNotice.hidden = !match.hasEstimation;
    const newsPanel = node.querySelector(".news-panel");
    node.querySelector(".news-button").addEventListener("click", (event) => {
      loadMatchNews(match, newsPanel, event.currentTarget);
    });
    node.querySelector(".analysis-button").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "更新中";
      await loadPredictions();
      event.currentTarget.textContent = "更新分析";
      event.currentTarget.disabled = false;
    });
    node.querySelector(".breakdown-summary").innerHTML = createBreakdownSummary(match);
    node.querySelector(".data-grid").innerHTML = createDataGrid(match);
    matchGrid.appendChild(node);
  });
}

async function loadPredictions() {
  loadingState.hidden = false;
  matchGrid.hidden = true;
  refreshButton.disabled = true;

  try {
    const response = await fetch("/api/worldcup/predictions", { cache: "no-store" });
    if (!response.ok) throw new Error(`API failed: ${response.status}`);
    const data = await response.json();
    predictions = data.matches;
    renderLiveStatus(data);
    renderDebugPanel(data);
    renderMatches();
  } catch (error) {
    loadingState.textContent = "目前無法載入 API 資料，請確認本機 server 是否啟動。";
    console.error(error);
  } finally {
    loadingState.hidden = true;
    matchGrid.hidden = false;
    refreshButton.disabled = false;
  }
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeTab = button.dataset.tab;
    renderMatches();
  });
});

refreshButton.addEventListener("click", loadPredictions);

loadPredictions();
