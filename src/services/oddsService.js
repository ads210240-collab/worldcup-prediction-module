import { cacheTtl, withCache } from "./cacheService.js";
import { fetchJson } from "./sourceUtils.js";

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.FOOTBALL_ODDS_API_KEY || "";
const ODDS_SPORT_KEY = process.env.ODDS_SPORT_KEY || "soccer_fifa_world_cup";

function normalizeOddsEvent(event) {
  const firstBookmaker = event.bookmakers?.[0];
  const h2h = firstBookmaker?.markets?.find((market) => market.key === "h2h");
  const outcomes = h2h?.outcomes || [];

  return {
    id: event.id,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
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
  const normalizedHome = fixture.homeTeam.toLowerCase();
  const normalizedAway = fixture.awayTeam.toLowerCase();
  return odds.find((event) => {
    const home = String(event.homeTeam || "").toLowerCase();
    const away = String(event.awayTeam || "").toLowerCase();
    return (
      (home.includes(normalizedHome) || normalizedHome.includes(home)) &&
      (away.includes(normalizedAway) || normalizedAway.includes(away))
    );
  });
}

export async function getOdds(fixtures) {
  return withCache("odds:v2", cacheTtl.odds, async () => {
    if (!ODDS_API_KEY) {
      return {
        oddsByMatchId: Object.fromEntries(fixtures.map((fixture) => [fixture.id, null])),
        message: "目前沒有可用盤口資料",
        sources: [],
        sourceStatuses: [{ source: "The Odds API", ok: false, error: "missing optional API key" }],
      };
    }

    try {
      const url = `https://api.the-odds-api.com/v4/sports/${ODDS_SPORT_KEY}/odds/?apiKey=${ODDS_API_KEY}&regions=us,uk,eu&markets=h2h&oddsFormat=decimal`;
      const payload = await fetchJson(url);
      const normalized = Array.isArray(payload) ? payload.map(normalizeOddsEvent) : [];
      const oddsByMatchId = Object.fromEntries(fixtures.map((fixture) => [fixture.id, matchOddsToFixture(normalized, fixture) || null]));
      return {
        oddsByMatchId,
        message: normalized.length ? null : "目前沒有可用盤口資料",
        sources: normalized.length ? ["The Odds API"] : [],
        sourceStatuses: [{ source: "The Odds API", ok: normalized.length > 0, count: normalized.length }],
      };
    } catch (error) {
      return {
        oddsByMatchId: Object.fromEntries(fixtures.map((fixture) => [fixture.id, null])),
        message: "目前沒有可用盤口資料",
        sources: [],
        sourceStatuses: [{ source: "The Odds API", ok: false, error: error instanceof Error ? error.message : "failed" }],
      };
    }
  });
}
