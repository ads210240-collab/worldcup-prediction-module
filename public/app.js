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
  form: ["近期狀態", 25],
  attack: ["攻擊火力", 20],
  defense: ["防守穩定", 15],
  odds: ["賠率市場信心", 15],
  squad: ["陣容完整度", 10],
  headToHead: ["歷史對戰", 5],
  sentiment: ["專家/網路情緒", 10],
};

let predictions = [];
let activeTab = "today";

const matchGrid = document.querySelector("#matchGrid");
const loadingState = document.querySelector("#loadingState");
const sourceMode = document.querySelector("#sourceMode");
const activeTabTitle = document.querySelector("#activeTabTitle");
const activeTabHint = document.querySelector("#activeTabHint");
const refreshButton = document.querySelector("#refreshButton");
const template = document.querySelector("#matchCardTemplate");

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

function getRiskClass(riskLevel) {
  if (riskLevel === "高") return "high";
  if (riskLevel === "中") return "medium";
  return "low";
}

function createProbabilityRows(match) {
  const labels = [
    ["主勝", match.winProbability.home],
    ["和局", match.winProbability.draw],
    ["客勝", match.winProbability.away],
  ];

  return labels
    .map(
      ([label, value]) => `
        <div class="probability-line">
          <span>${label}</span>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style="width: ${value}%"></div>
          </div>
          <strong>${value}%</strong>
        </div>
      `,
    )
    .join("");
}

function createBreakdown(match) {
  return Object.entries(scoreLabels)
    .map(([key, [label, max]]) => {
      const value = match.scoreBreakdown[key];
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
  return `
    <strong>評分拆解摘要</strong>
    <p>${match.summary}</p>
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
  const items = [
    ["賠率 / 市場看法", match.marketView],
    ["近期戰績", `${match.homeTeam}: ${match.recentForm.home}<br>${match.awayTeam}: ${match.recentForm.away}`],
    ["進球 / 失球", `${match.homeTeam}: ${match.goals.homeFor}/${match.goals.homeAgainst}<br>${match.awayTeam}: ${match.goals.awayFor}/${match.goals.awayAgainst}`],
    ["xG / xGA", `${match.homeTeam}: ${match.expectedGoals.homeXG}/${match.expectedGoals.homeXGA}<br>${match.awayTeam}: ${match.expectedGoals.awayXG}/${match.expectedGoals.awayXGA}`],
    ["傷兵或停賽", `${match.homeTeam}: ${match.injuriesSuspensions.home}<br>${match.awayTeam}: ${match.injuriesSuspensions.away}`],
    ["專家預測摘要", match.expertPrediction],
    ["AI 綜合分析", match.aiAnalysis],
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
    node.querySelector(".match-title").textContent = `${match.homeTeam} vs ${match.awayTeam}`;
    node.querySelector(".total-score strong").textContent = match.totalScore;
    node.querySelector(".predicted-score").textContent = match.predictedScore;
    node.querySelector(".score-prediction-list").innerHTML = createScorePredictions(match);
    node.querySelector(".probability-bars").innerHTML = createProbabilityRows(match);
    node.querySelector(".recommendation").textContent = match.recommendation;
    node.querySelector(".confidence").textContent = match.confidence;
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
    node.querySelector(".summary").textContent = match.summary;
    node.querySelector(".reason-list").innerHTML = match.keyReasons.map((reason) => `<li>${reason}</li>`).join("");
    node.querySelector(".breakdown").innerHTML = createBreakdown(match);
    node.querySelector(".breakdown-summary").innerHTML = createBreakdownSummary(match);
    node.querySelector(".data-grid").innerHTML = createDataGrid(match);
    node.querySelector(".sources").textContent = `Sources: ${match.sources.join(", ")}`;
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
    sourceMode.textContent = data.sourceMode === "mock" ? "Mock Data" : data.sourceMode;
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
