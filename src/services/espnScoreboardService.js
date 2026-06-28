import { fetchJsonWithMeta } from "./sourceUtils.js";
import { translateTeamName } from "./translationService.js";

const ESPN_SOCCER_LEAGUE = process.env.ESPN_SOCCER_LEAGUE || "fifa.world";

export function normalizeEspnCompetition(event) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((team) => team.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((team) => team.homeAway === "away") || competitors[1] || {};

  return {
    id: `espn-${event.id}`,
    date: event.date,
    homeTeam: translateTeamName(home.team?.displayName || home.team?.shortDisplayName || "主隊未定"),
    awayTeam: translateTeamName(away.team?.displayName || away.team?.shortDisplayName || "客隊未定"),
    originalHomeTeam: home.team?.displayName || home.team?.shortDisplayName || "",
    originalAwayTeam: away.team?.displayName || away.team?.shortDisplayName || "",
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
  };
}

export async function fetchEspnScoreboard(date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SOCCER_LEAGUE}/scoreboard?dates=${date}`;
  const { data, meta } = await fetchJsonWithMeta(url);
  return {
    fixtures: Array.isArray(data.events) ? data.events.map(normalizeEspnCompetition) : [],
    meta,
  };
}
