import { cacheTtl, withCache } from "./cacheService.js";
import { buildSourceStatus, fetchJsonWithMeta } from "./sourceUtils.js";
import { getTeamAliases, translateTeamName } from "./translationService.js";

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.FOOTBALL_ODDS_API_KEY || "";
const ODDS_SPORT_KEY = process.env.ODDS_SPORT_KEY || "soccer_fifa_world_cup";

function normalizeOddsEvent(event) {
  const firstBookmaker = event.bookmakers?.[0];
  const h2h = firstBookmaker?.markets?.find((market) => market.key === "h2h");
  const outcomes = h2h?.outcomes || [];

  return {
    id: event.id,
    homeTeam: translateTeamName(event.home_team),
    awayTeam: translateTeamName(event.away_team),
    originalHomeTeam: event.home_team,
    originalAwayTeam: event.away_team,
    commenceTime: event.commence_time,
    bookmaker: firstBookmaker?.title || "",
    markets: {
      home: outcomes.find((outcome) => outcome.name === event.home_team)?.price ?? null,
      draw: outcomes.find((outcome) => outcome.name?.toLowerCase() === "draw")?.price ?? null,
      away: outcomes.find((outcome) => outcome.name === event.away_team)?.price ?? null,
    },
    source: "The Odds API",
  };
}

function matchOddsToFixture(odds, fixture) {
  const homeAliases = getTeamAliases(fixture.homeTeam).concat(getTeamAliases(fixture.originalHomeTeam));
  const awayAliases = getTeamAliases(fixture.awayTeam).concat(getTeamAliases(fixture.originalAwayTeam));
  return odds.find((event) => {
    const home = getTeamAliases(event.homeTeam).concat(getTeamAliases(event.originalHomeTeam));
    const away = getTeamAliases(event.awayTeam).concat(getTeamAliases(event.originalAwayTeam));
    return home.some((alias) => homeAliases.some((target) => alias.includes(target) || target.includes(alias))) &&
      away.some((alias) => awayAliases.some((target) => alias.includes(target) || target.includes(alias)));
  });
}

export async function getOdds(fixtures) {
  return withCache("odds:v2", cacheTtl.odds, async () => {
    if (!ODDS_API_KEY) {
      return {
        oddsByMatchId: Object.fromEntries(fixtures.map((fixture) => [fixture.id, null])),
        message: "目前沒有可用盤口資料",
        sources: [],
        sourceStatuses: [buildSourceStatus({ source: "The Odds API", ok: false, error: "missing optional API key" })],
      };
    }

    try {
      const url = `https://api.the-odds-api.com/v4/sports/${ODDS_SPORT_KEY}/odds/?apiKey=${ODDS_API_KEY}&regions=us,uk,eu&markets=h2h&oddsFormat=decimal`;
      const { data, meta } = await fetchJsonWithMeta(url);
      const normalized = Array.isArray(data) ? data.map(normalizeOddsEvent) : [];
      const oddsByMatchId = Object.fromEntries(fixtures.map((fixture) => [fixture.id, matchOddsToFixture(normalized, fixture) || null]));
      return {
        oddsByMatchId,
        message: normalized.length ? null : "目前沒有可用盤口資料",
        sources: normalized.length ? ["The Odds API"] : [],
        sourceStatuses: [buildSourceStatus({ source: "The Odds API", ok: normalized.length > 0, count: normalized.length, meta })],
      };
    } catch (error) {
      return {
        oddsByMatchId: Object.fromEntries(fixtures.map((fixture) => [fixture.id, null])),
        message: "目前沒有可用盤口資料",
        sources: [],
        sourceStatuses: [
          buildSourceStatus({
            source: "The Odds API",
            ok: false,
            error: error instanceof Error ? error.message : "failed",
            meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
          }),
        ],
      };
    }
  });
}
