import { cacheTtl, withCache } from "./cacheService.js";
import { fetchJsonWithMeta, buildSourceStatus, summarizeStatuses, uniqueBy } from "./sourceUtils.js";
import { formatTaipeiDate, getMatchDayTag, getTaipeiDateWindow, toTaipeiIsoFromDateAndTime } from "./timeService.js";
import { mockWorldCupPredictions } from "./mockData.js";
import { fetchEspnScoreboard } from "./espnScoreboardService.js";
import { fetchFootballDataMatches } from "./footballDataService.js";
import { translateTeamName } from "./translationService.js";

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

async function fetchFootballDataFixtures() {
  const { yesterday, tomorrow } = getTaipeiDateWindow();
  const { fixtures, metas } = await fetchFootballDataMatches({ dateFrom: yesterday, dateTo: tomorrow });
  return {
    fixtures: fixtures.map(normalizeFixture),
    meta: metas[metas.length - 1] || {},
  };
}

async function fetchEspnFixtures() {
  const { espnDates } = getTaipeiDateWindow();
  const fixtures = [];
  const errors = [];
  let latestMeta = {};

  for (const date of espnDates) {
    try {
      const result = await fetchEspnScoreboard(date);
      fixtures.push(...result.fixtures.map(normalizeFixture));
      latestMeta = result.meta;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "ESPN scoreboard failed");
      latestMeta = { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs };
    }
  }

  if (!fixtures.length && errors.length) {
    throw new Error(errors.join(" | "));
  }

  return { fixtures, meta: latestMeta };
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
  const { data, meta } = await fetchJsonWithMeta(OPENFOOTBALL_FIXTURES_URL);
  const fixtures = normalizeOpenFootballFixtures(data)
    .map(normalizeOpenFootballMatch)
    .filter((fixture) => {
      const date = formatTaipeiDate(new Date(fixture.date));
      return date >= yesterday && date <= tomorrow;
    });
  return { fixtures, meta };
}

function buildMockFixtureFallback() {
  return mockWorldCupPredictions.map((fixture, index) =>
    normalizeFixture({
      ...fixture,
      id: `${fixture.id}-${index}`,
      homeTeam: translateTeamName(fixture.homeTeam),
      awayTeam: translateTeamName(fixture.awayTeam),
      source: "mockWorldCupPredictions",
      sourceUrl: "",
      importance: 50,
    }),
  );
}

export async function getFixtures() {
  return withCache("fixtures:v2", cacheTtl.fixtures, async () => {
    const sourceAttempts = [
      ["ESPN Scoreboard", fetchEspnFixtures],
      ["football-data.org", fetchFootballDataFixtures],
      ["openfootball / football.json", fetchOpenFootballFixtures],
    ];

    const statuses = [];
    const fixtures = [];

    for (const [source, fetcher] of sourceAttempts) {
      try {
        const { fixtures: sourceFixtures, meta } = await fetcher();
        statuses.push(buildSourceStatus({ source, ok: sourceFixtures.length > 0, count: sourceFixtures.length, meta }));
        fixtures.push(...sourceFixtures);
      } catch (error) {
        statuses.push(
          buildSourceStatus({
            source,
            ok: false,
            error: error instanceof Error ? error.message : "failed",
            meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
          }),
        );
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
