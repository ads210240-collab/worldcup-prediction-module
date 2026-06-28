import { cacheTtl, withCache } from "./cacheService.js";
import { fetchJson, summarizeStatuses, uniqueBy } from "./sourceUtils.js";
import { formatTaipeiDate, getMatchDayTag, getTaipeiDateWindow, toTaipeiIsoFromDateAndTime } from "./timeService.js";
import { mockWorldCupPredictions } from "./mockData.js";

const FOOTBALL_DATA_BASE_URL = process.env.FOOTBALL_DATA_BASE_URL || "https://api.football-data.org/v4";
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || "";
const FOOTBALL_SEASON = process.env.FOOTBALL_SEASON || "2026";
const ESPN_SOCCER_LEAGUE = process.env.ESPN_SOCCER_LEAGUE || "fifa.world";
const OPENFOOTBALL_FIXTURES_URL =
  process.env.OPENFOOTBALL_FIXTURES_URL ||
  "https://raw.githubusercontent.com/openfootball/worldcup/master/2026--canada-mexico-usa/worldcup.json";

function statusTags(fixture) {
  const tags = new Set();
  const dayTag = getMatchDayTag(fixture.date);
  const status = String(fixture.status || "").toUpperCase();
  const state = String(fixture.providerMeta?.state || "").toLowerCase();

  if (dayTag === "today" || dayTag === "tomorrow") tags.add(dayTag);
  if (status === "FINISHED" || status.includes("FULL_TIME") || status.includes("FINAL") || state === "post") {
    tags.add("finished");
  }
  if (status === "SCHEDULED" || status === "TIMED" || status.includes("SCHEDULED") || status.includes("PRE") || state === "pre") {
    tags.add("upcoming");
  }
  if (status.includes("IN_PROGRESS") || status.includes("LIVE") || state === "in") tags.add("live");
  if (fixture.importance >= 70) tags.add("hot");
  return [...tags];
}

function normalizeFixture(fixture) {
  const normalized = {
    ...fixture,
    categoryTags: fixture.categoryTags?.length ? fixture.categoryTags : statusTags(fixture),
  };

  if (!normalized.categoryTags.includes("hot") && normalized.importance >= 70) {
    normalized.categoryTags.push("hot");
  }

  return normalized;
}

function normalizeFootballDataMatch(match) {
  const homeTeam = match.homeTeam?.shortName || match.homeTeam?.name || "主隊未定";
  const awayTeam = match.awayTeam?.shortName || match.awayTeam?.name || "客隊未定";
  const homeScore = match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? null;
  const awayScore = match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? null;

  return normalizeFixture({
    id: `football-data-${match.id}`,
    date: match.utcDate,
    homeTeam,
    awayTeam,
    status: match.status || "SCHEDULED",
    score: { home: homeScore, away: awayScore },
    venue: match.venue || "",
    competition: match.competition?.name || "World Cup",
    source: "football-data.org",
    sourceUrl: "https://www.football-data.org/",
    providerMeta: {
      homeTeamId: match.homeTeam?.id,
      awayTeamId: match.awayTeam?.id,
      matchday: match.matchday,
      stage: match.stage,
    },
    importance: match.status === "FINISHED" ? 55 : 80,
  });
}

async function fetchFootballDataFixtures() {
  const { yesterday, tomorrow } = getTaipeiDateWindow();
  const headers = FOOTBALL_DATA_API_KEY ? { "X-Auth-Token": FOOTBALL_DATA_API_KEY } : {};
  const urls = [
    `${FOOTBALL_DATA_BASE_URL}/competitions/WC/matches?season=${FOOTBALL_SEASON}&dateFrom=${yesterday}&dateTo=${tomorrow}`,
    `${FOOTBALL_DATA_BASE_URL}/matches?dateFrom=${yesterday}&dateTo=${tomorrow}`,
  ];

  const fixtures = [];
  const errors = [];

  for (const url of urls) {
    try {
      const payload = await fetchJson(url, { headers });
      if (Array.isArray(payload.matches)) {
        fixtures.push(...payload.matches.map(normalizeFootballDataMatch));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "football-data.org failed");
    }
  }

  if (!fixtures.length && errors.length) {
    throw new Error(errors.join(" | "));
  }

  return fixtures;
}

function normalizeEspnCompetition(event) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((team) => team.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((team) => team.homeAway === "away") || competitors[1] || {};

  return normalizeFixture({
    id: `espn-${event.id}`,
    date: event.date,
    homeTeam: home.team?.displayName || home.team?.shortDisplayName || "主隊未定",
    awayTeam: away.team?.displayName || away.team?.shortDisplayName || "客隊未定",
    status: event.status?.type?.name || event.status?.type?.state || "SCHEDULED",
    score: {
      home: home.score == null ? null : Number(home.score),
      away: away.score == null ? null : Number(away.score),
    },
    venue: competition.venue?.fullName || "",
    competition: event.league?.name || "ESPN Soccer",
    source: "ESPN Scoreboard",
    sourceUrl: "https://www.espn.com/soccer/",
    providerMeta: {
      state: event.status?.type?.state,
      detail: event.status?.type?.detail,
      shortDetail: event.status?.type?.shortDetail,
    },
    importance: 75,
  });
}

async function fetchEspnFixtures() {
  const { espnDates } = getTaipeiDateWindow();
  const fixtures = [];
  const errors = [];

  for (const date of espnDates) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SOCCER_LEAGUE}/scoreboard?dates=${date}`;
    try {
      const payload = await fetchJson(url);
      if (Array.isArray(payload.events)) {
        fixtures.push(...payload.events.map(normalizeEspnCompetition));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "ESPN scoreboard failed");
    }
  }

  if (!fixtures.length && errors.length) {
    throw new Error(errors.join(" | "));
  }

  return fixtures;
}

function normalizeOpenFootballFixtures(payload) {
  const rounds = payload?.rounds || payload?.matches || payload?.games || [];
  if (Array.isArray(rounds) && rounds[0]?.matches) {
    return rounds.flatMap((round) => round.matches);
  }
  return Array.isArray(rounds) ? rounds : [];
}

function normalizeOpenFootballMatch(match, index) {
  const dateValue = match.utcDate || match.date || match.kickoff || toTaipeiIsoFromDateAndTime(formatTaipeiDate(new Date()), "00:00:00");
  const homeTeam = match.homeTeam?.name || match.homeTeam || match.home || match.team1 || "主隊未定";
  const awayTeam = match.awayTeam?.name || match.awayTeam || match.away || match.team2 || "客隊未定";

  return normalizeFixture({
    id: `openfootball-${String(match.id || `${homeTeam}-${awayTeam}-${index}`).replace(/\s+/g, "-").toLowerCase()}`,
    date: dateValue,
    homeTeam,
    awayTeam,
    status: match.status || "SCHEDULED",
    score: {
      home: match.score?.ft?.[0] ?? match.score1 ?? null,
      away: match.score?.ft?.[1] ?? match.score2 ?? null,
    },
    venue: match.venue || "",
    competition: "World Cup",
    source: "openfootball / football.json",
    sourceUrl: OPENFOOTBALL_FIXTURES_URL,
    providerMeta: { round: match.round || match.group || "" },
    importance: 65,
  });
}

async function fetchOpenFootballFixtures() {
  const { yesterday, tomorrow } = getTaipeiDateWindow();
  const payload = await fetchJson(OPENFOOTBALL_FIXTURES_URL);
  return normalizeOpenFootballFixtures(payload)
    .map(normalizeOpenFootballMatch)
    .filter((fixture) => {
      const date = formatTaipeiDate(new Date(fixture.date));
      return date >= yesterday && date <= tomorrow;
    });
}

function buildMockFixtureFallback() {
  return mockWorldCupPredictions.map((fixture, index) =>
    normalizeFixture({
      ...fixture,
      id: `${fixture.id}-${index}`,
      source: "mockWorldCupPredictions",
      sourceUrl: "",
      importance: 50,
    }),
  );
}

export async function getFixtures() {
  return withCache("fixtures:v2", cacheTtl.fixtures, async () => {
    const sourceAttempts = [
      ["football-data.org", fetchFootballDataFixtures],
      ["ESPN Scoreboard", fetchEspnFixtures],
      ["openfootball / football.json", fetchOpenFootballFixtures],
    ];

    const statuses = [];
    const fixtures = [];

    for (const [source, fetcher] of sourceAttempts) {
      try {
        const sourceFixtures = await fetcher();
        statuses.push({ source, ok: sourceFixtures.length > 0, count: sourceFixtures.length });
        fixtures.push(...sourceFixtures);
      } catch (error) {
        statuses.push({ source, ok: false, error: error instanceof Error ? error.message : "failed" });
      }
    }

    const dedupedFixtures = uniqueBy(fixtures, (fixture) => `${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (dedupedFixtures.length) {
      return {
        fixtures: dedupedFixtures,
        isFallback: false,
        sources: [...new Set(dedupedFixtures.map((fixture) => fixture.source).filter(Boolean))],
        sourceStatuses: statuses,
        fallbackReason: null,
      };
    }

    return {
      fixtures: buildMockFixtureFallback(),
      isFallback: true,
      sources: ["mockWorldCupPredictions"],
      sourceStatuses: statuses,
      fallbackReason: `目前資料來源暫時無法取得，即時資料已切換為模擬資料。${summarizeStatuses(statuses)}`,
    };
  });
}
