import { cacheTtl, withCache } from "./cacheService.js";
import { rankingSeeds } from "./mockData.js";

function getRanking(teamName) {
  return rankingSeeds[teamName] || { rank: 50, elo: 1700 };
}

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
    const completedFixtures = fixtures.filter((fixture) => fixture.status === "FINISHED" || fixture.providerMeta?.state === "post");
    const teams = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]))];

    const statsByTeam = Object.fromEntries(
      teams.map((teamName) => {
        const recent = summarizeRecentMatches(teamName, completedFixtures);
        const ranking = getRanking(teamName);
        return [
          teamName,
          {
            teamName,
            recent,
            ranking,
            homeAway: {
              home: recent.homeMatches,
              away: recent.awayMatches,
            },
            source: recent.sampleSize ? "fixtures-derived" : "ranking-estimate",
            limitations: recent.sampleSize < 5 ? ["最近五場樣本不足，部分攻防資料為估算"] : [],
          },
        ];
      }),
    );

    return {
      statsByTeam,
      sourceStatuses: [
        {
          source: "fixtures-derived team form",
          ok: completedFixtures.length > 0,
          count: completedFixtures.length,
        },
        {
          source: "manual FIFA ranking / Elo seed",
          ok: true,
          count: teams.length,
        },
      ],
    };
  });
}
