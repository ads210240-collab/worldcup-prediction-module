import { fetchJsonWithMeta } from "./sourceUtils.js";
import { translateTeamName } from "./translationService.js";

const FOOTBALL_DATA_BASE_URL = process.env.FOOTBALL_DATA_BASE_URL || "https://api.football-data.org/v4";
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || "";
const FOOTBALL_SEASON = process.env.FOOTBALL_SEASON || "2026";

export function normalizeFootballDataMatch(match) {
  const homeTeam = match.homeTeam?.shortName || match.homeTeam?.name || "主隊未定";
  const awayTeam = match.awayTeam?.shortName || match.awayTeam?.name || "客隊未定";
  const homeScore = match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? null;
  const awayScore = match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? null;

  return {
    id: `football-data-${match.id}`,
    date: match.utcDate,
    homeTeam: translateTeamName(homeTeam),
    awayTeam: translateTeamName(awayTeam),
    originalHomeTeam: homeTeam,
    originalAwayTeam: awayTeam,
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
  };
}

export async function fetchFootballDataMatches({ dateFrom, dateTo }) {
  const headers = FOOTBALL_DATA_API_KEY ? { "X-Auth-Token": FOOTBALL_DATA_API_KEY } : {};
  const urls = [
    `${FOOTBALL_DATA_BASE_URL}/competitions/WC/matches?season=${FOOTBALL_SEASON}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    `${FOOTBALL_DATA_BASE_URL}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
  ];

  const fixtures = [];
  const metas = [];

  for (const url of urls) {
    const { data, meta } = await fetchJsonWithMeta(url, { headers });
    metas.push(meta);
    if (Array.isArray(data.matches)) {
      fixtures.push(...data.matches.map(normalizeFootballDataMatch));
    }
  }

  return { fixtures, metas };
}
