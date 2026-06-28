import { cacheTtl, withCache } from "./cacheService.js";
import { buildSourceStatus } from "./sourceUtils.js";
import { getFifaRankings } from "./fifaRankingService.js";
import { getWorldEloRatings } from "./worldEloService.js";
import { fetchFootballDataMatches } from "./footballDataService.js";
import { formatTaipeiDate } from "./timeService.js";

function summarizeRecentMatches(teamName, completedFixtures) {
  const matches = completedFixtures
    .filter((fixture) => fixture.homeTeam === teamName || fixture.awayTeam === teamName)
    .slice(-5);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let homeMatches = 0;
  let awayMatches = 0;

  for (const match of matches) {
    const isHome = match.homeTeam === teamName;
    const own = isHome ? match.score.home : match.score.away;
    const against = isHome ? match.score.away : match.score.home;
    if (own == null || against == null) continue;

    if (isHome) homeMatches += 1;
    else awayMatches += 1;

    goalsFor += own;
    goalsAgainst += against;

    if (own > against) wins += 1;
    else if (own === against) draws += 1;
    else losses += 1;
  }

  return {
    sampleSize: matches.length,
    record: { wins, draws, losses },
    goalsFor,
    goalsAgainst,
    homeMatches,
    awayMatches,
    formText: matches.length
      ? `近 ${matches.length} 場 ${wins} 勝 ${draws} 和 ${losses} 敗，進 ${goalsFor} 球、失 ${goalsAgainst} 球`
      : "免費來源暫無最近五場完整戰績，使用排名與賽程脈絡估算",
  };
}

export async function getTeamStats(fixtures) {
  return withCache("team-stats:v2", cacheTtl.teamStats, async () => {
    const sourceStatuses = [];
    let supplementalFixtures = [];

    try {
      const today = new Date();
      const from = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
      const { fixtures: footballDataFixtures, metas } = await fetchFootballDataMatches({
        dateFrom: formatTaipeiDate(from),
        dateTo: formatTaipeiDate(today),
      });
      supplementalFixtures = footballDataFixtures;
      sourceStatuses.push(
        buildSourceStatus({
          source: "football-data.org team recent matches",
          ok: footballDataFixtures.length > 0,
          count: footballDataFixtures.length,
          meta: metas[metas.length - 1] || {},
        }),
      );
    } catch (error) {
      sourceStatuses.push(
        buildSourceStatus({
          source: "football-data.org team recent matches",
          ok: false,
          error: error instanceof Error ? error.message : "failed",
          meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
        }),
      );
    }

    const completedFixtures = [...fixtures, ...supplementalFixtures].filter((fixture) => {
      const status = String(fixture.status || "").toUpperCase();
      return status === "FINISHED" || status.includes("FULL_TIME") || status.includes("FINAL") || fixture.providerMeta?.state === "post";
    });
    const teams = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]))];
    const fifa = await getFifaRankings([...teams]);
    const elo = await getWorldEloRatings([...teams]);

    const statsByTeam = Object.fromEntries(
      teams.map((teamName) => {
        const recent = summarizeRecentMatches(teamName, completedFixtures);
        const fifaRanking = fifa.rankingsByTeam[teamName] || { rank: null, estimated: true };
        const eloRating = elo.eloByTeam[teamName] || { elo: null, estimated: true };
        const estimated = recent.sampleSize < 5 || fifaRanking.estimated || eloRating.estimated;
        return [
          teamName,
          {
            teamName,
            recent,
            ranking: {
              rank: fifaRanking.rank || 80,
              elo: eloRating.elo || 1500,
              fifaSource: fifaRanking.source,
              eloSource: eloRating.source,
              fifaEstimated: Boolean(fifaRanking.estimated),
              eloEstimated: Boolean(eloRating.estimated),
            },
            homeAway: {
              home: recent.homeMatches,
              away: recent.awayMatches,
            },
            source: recent.sampleSize ? "fixtures-derived" : "ranking-estimate",
            dataQuality: {
              estimated,
              recentSampleSize: recent.sampleSize,
              missingSources: [
                recent.sampleSize < 5 ? "recent-five" : "",
                fifaRanking.estimated ? "fifa-ranking" : "",
                eloRating.estimated ? "world-elo" : "",
              ].filter(Boolean),
            },
            limitations: [
              recent.sampleSize < 5 ? "最近五場樣本不足，部分攻防資料為估算" : "",
              fifaRanking.estimated ? "FIFA Ranking 使用 seed 或手動維護資料" : "",
              eloRating.estimated ? "World Football Elo 使用 seed 或解析失敗後估算" : "",
            ].filter(Boolean),
          },
        ];
      }),
    );

    return {
      statsByTeam,
      sourceStatuses: [
        ...sourceStatuses,
        buildSourceStatus({
          source: "fixtures-derived team form",
          ok: completedFixtures.length > 0,
          count: completedFixtures.length,
        }),
        buildSourceStatus({
          source: "home/away split",
          ok: true,
          count: teams.length,
        }),
        ...fifa.sourceStatuses,
        ...elo.sourceStatuses,
      ],
    };
  });
}
